/**
 * 面向模型的控制中心工具：把设置页能做的事变成 Agent 可以自己调用的工具。
 *
 * 权限分级（需求：只有「改规则」需要用户审批）：
 * - **自行可用**：MCP 增删改启停、技能增删改、跨客户端扫描与导入、记忆、插件设置、备份与恢复——
 *   这些都是「用户已授权的配置动作」，模型可以直接做，做完在会话里说明即可；
 * - **必须审批**：`control_center_rule_write` / `control_center_rule_delete` 通过
 *   `tools/pre-execute` 瀑布返回 `{ kind: 'ask' }` 交给平台的审批通道，用户在对话里同意后才执行。
 *   规则是「用户对 AI 的指令」，让 AI 悄悄改自己的约束是唯一不可接受的一类写入。
 *
 * 审批档位由用户在「规则」页自己选（`settings.rules.approval`，见 settings.js 的 `RULE_APPROVALS`）：
 * - `ask` 每次询问：闸门**自己弹一个四按钮的框**（见 {@link RULE_APPROVAL_CHOICES}），用户选什么就做什么；
 * - `allow` 始终允许：直接放行；
 * - `deny-always` 禁止且不再询问：一律拒绝。
 *
 * 为什么不用平台那张审批卡片：它的按钮是平台写死的两个（拒绝 / 允许一次，见 `dsh-client-ui-approval`），
 * 插件改不了；而「本轮对话中始终允许 / 此工作区内始终允许 / 禁止且不再询问」在平台侧也没有对应的
 * outcome（`dsh-user-approval` 的 OUTCOMES 里只有 `allowed-once` 算授予）。所以闸门改走平台的
 * 「提问」通道（`ctx.userQuestions.ask`，与 `ask_user_question` 同一张卡片），人答完由插件自己记状态；
 * **通道不可用时退回平台的审批通道**（原来的 `{ kind: 'ask' }` 那条路），不会因为弹框失败就悄悄放行。
 *
 * 退回时那个「预设关闭了审批」的回报是必要的：平台在 approval=never 下会在弹窗前直接判 rejected，
 * 理由却写成 `the user rejected tool …`，看着像用户拒绝、实际用户根本没被问过。
 *
 * @module dsh-control-center/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { RULES_DIR, projectRulesDir } from './paths.js'
import { readSettings, writeSettings } from './settings.js'
import { listRules, readRule, writeRule, deleteRule, setRuleEnabled, listSkills, writeSkill, deleteSkill, readMcp, writeMcp, normalizeServer } from './store.js'
import { deleteMemory, listMemories, readMemory, writeMemory } from './memory.js'
import { createBackup, deleteBackup, listBackups, applyRestore, analyzeBackup, planRestore, listSections } from './backup.js'
import { scanAll, importItems } from './scan.js'
import { readFile } from 'node:fs/promises'

/** 需要用户在对话里审批的工具名（规则写入）。 */
export const APPROVAL_REQUIRED = ['control_center_rule_write', 'control_center_rule_delete']

/**
 * 「每次询问」时弹框上的按钮，顺序即按钮顺序。
 *
 * `needsCwd: true` 的那一项只在知道会话工作目录时才出现——「此工作区内始终允许」没有工作区就没有
 * 意义（会话还没绑定 cwd 时不该给用户一个按了也没用的按钮）。
 */
export const RULE_APPROVAL_CHOICES = [
  { label: '本轮对话中始终允许', description: '这一轮对话里不再问；重启 DSH 桌面后重新开始询问。' },
  { label: '此工作区内始终允许', description: '这个工作区里以后都不再问；可在「规则」页清除。', needsCwd: true },
  { label: '禁止一次', description: '只拒绝这一次，下次照样问你。' },
  { label: '禁止且不再询问', description: '把「规则」页的审批档位改成「禁止且不再询问」。' },
]

/** 弹框按钮 → 闸门动作（文案与行为在这里对齐，测试直接对着它断言）。 */
export const RULE_APPROVAL_ACTIONS = {
  '本轮对话中始终允许': 'allow-session',
  '此工作区内始终允许': 'allow-workspace',
  '禁止一次': 'deny-once',
  '禁止且不再询问': 'deny-always',
}

/** 「本轮对话中始终允许」的记忆：进程内有效（重启 DSH 桌面即失效），键是会话对象。 */
const sessionAllows = new WeakSet()

/**
 * 用平台的「提问」通道弹一个四按钮的审批框。
 *
 * @param ctx - 工具所在的插件上下文。
 * @param exec - `tools/pre-execute` 拿到的执行描述。
 * @param cwd - 会话工作目录（空字符串 = 不知道）。
 * @returns `{ action }`：`RULE_APPROVAL_ACTIONS` 里的值，或 `'skipped'` / `'unknown'`；
 *   `undefined` = 这个通道不可用，调用方应退回平台的审批通道。
 */
async function askRuleApproval(ctx, exec, cwd) {
  // ctx.get 可能不存在（测试里的假 ctx），必须可选调用。
  const questions = ctx.get?.('userQuestions')
  if (typeof questions?.ask !== 'function' || exec.agent === undefined) return undefined
  const verb = exec.name === 'control_center_rule_delete' ? '删除' : '写入'
  // 平台把工具参数放在 exec.arguments 上（没有 exec.args）；写入用 name，删除用 file。
  // 取不到名字时退回「规则」，免得弹框标题空着。
  const params = exec.arguments
  const told = [params?.name, params?.file].find((value) => typeof value === 'string' && value.trim() !== '')
  const target = told === undefined ? '规则' : `「${told.trim()}」`
  const options = RULE_APPROVAL_CHOICES.filter((choice) => choice.needsCwd !== true || cwd !== '').map(
    ({ label, description }) => ({ label, description }),
  )
  let answer
  try {
    answer = await questions.ask({
      agent: exec.agent,
      signal: exec.signal,
      questions: [
        {
          id: 'rule-approval',
          header: `控制中心：AI 想${verb}${target}`,
          question: `是否允许 AI ${verb}${target}？`,
          options,
        },
      ],
    })
  } catch {
    // 没有 answerer、调用方不是活的根 agent……都表示这条路走不通，交给调用方退回平台审批。
    return undefined
  }
  const reply = answer?.answers?.[0]
  if (reply === undefined || reply.skipped === true) return { action: 'skipped' }
  const selected = Array.isArray(reply.selected) ? reply.selected[0] : undefined
  const action = RULE_APPROVAL_ACTIONS[selected]
  if (action !== undefined) return { action }
  return { action: 'unknown', custom: typeof reply.custom === 'string' ? reply.custom : '' }
}

/** 文本型输出：所有工具都返回人/模型都能直接读的一段文本。 */
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

/** 规则作用域的公共参数。 */
const SCOPE_PARAMS = {
  scope: {
    type: 'string',
    enum: ['global', 'project'],
    description: 'global = 全局规则（对所有工作区生效）；project = 项目规则（只对该工作区生效）。缺省 global。',
  },
  workspace: {
    type: 'string',
    description: '项目规则的绝对路径（scope=project 时必填）。通常就是当前会话的工作目录。',
  },
}

/** 把规则作用域参数解成 store 认识的形状。 */
function scopeOf(args) {
  return args.scope === 'project' ? { scope: 'project', workspace: String(args.workspace ?? '').trim() } : undefined
}

/** 规则的一行简介。 */
function ruleLine(rule) {
  const mode = rule.mode === 'always' ? '强加载' : '按需'
  const on = rule.enabled === false ? '停用' : '启用'
  const description = rule.description === '' ? '' : ` — ${rule.description}`
  return `- ${rule.name}（${rule.file}｜${mode}｜${on}｜${(rule.bytes / 1024).toFixed(1)} KB）${description}`
}

/** 解析传入的 `KEY=VALUE` / 对象两种环境变量写法。 */
function toRecord(value) {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value
  const out = {}
  for (const line of String(value).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index <= 0) continue
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return out
}

/**
 * 注册全部控制中心工具与规则审批闸门。
 *
 * @param ctx - 已具备 `tools` 服务的上下文。
 * @param runtime - 插件运行时（MCP 管理器、技能失效回调）。
 * @returns disposer 数组的清理函数。
 */
export function registerTools(ctx, runtime) {
  const disposers = []
  /**
   * 统一的注册入口。
   *
   * `opts.mutating(args)` 判定本次调用是否落盘：是则执行完 bump 版本号，让开着的控制中心
   * 轮询到变化、自动刷新，不跟 Agent 的改动脱节。读操作（list/get/scan/overview）不 bump。
   */
  const add = (tool, opts = {}) => {
    const execute =
      opts.mutating === undefined
        ? tool.execute
        : async (args, exec) => {
            const result = await tool.execute(args, exec)
            if (opts.mutating(args)) runtime.bumpRevision?.()
            return result
          }
    disposers.push(ctx.tools.register(defineTool({ ...tool, execute })))
  }

  /* ─────────────────────────── 概览 ─────────────────────────── */

  add({
    name: 'control_center_overview',
    description: [
      '看一眼 DSH 控制中心里各类配置的现状：规则（全局/项目）、记忆、MCP 服务器、技能、备份。',
      '需要改动任何配置之前先调它，避免凭猜测下手。',
    ].join(''),
    parameters: {
      workspace: { type: 'string', description: '要看项目规则的工作区绝对路径（通常是当前会话工作目录）。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const workspace = String(args.workspace ?? '').trim()
      const settings = await readSettings()
      const [globalRules, projectRules, memories, mcp, skills, backups] = await Promise.all([
        listRules(),
        workspace === '' ? Promise.resolve([]) : listRules({ scope: 'project', workspace }),
        listMemories(),
        readMcp(),
        listSkills(),
        listBackups(),
      ])
      const lines = [
        `数据根目录：${RULES_DIR.replace(/[\\/]rules$/, '')}`,
        `全局规则 ${globalRules.length} 条（${globalRules.filter((rule) => rule.enabled !== false).length} 条启用）：`,
        ...globalRules.map(ruleLine),
      ]
      if (workspace !== '') {
        lines.push(`项目规则目录：${projectRulesDir(workspace)}（${projectRules.length} 条）：`)
        lines.push(...projectRules.map(ruleLine))
      }
      lines.push(`记忆 ${memories.length} 条（注入${settings.memory.enabled && settings.memory.inject ? '开启' : '关闭'}）`)
      lines.push(`MCP 服务器 ${mcp.servers.length} 个：${mcp.servers.map((server) => `${server.name}(${server.enabled === false ? '停用' : '启用'})`).join('、') || '（无）'}`)
      lines.push(`技能 ${skills.length} 个：${skills.map((skill) => skill.id).join('、') || '（无）'}`)
      lines.push(`备份产物 ${backups.length} 份`)
      return lines.join('\n')
    },
  })

  /* ─────────────────────────── 规则 ─────────────────────────── */

  add({
    name: 'control_center_rule_list',
    description: '列出规则（global = 全局规则；project = 某个工作区的项目规则）。只读，不需要审批。',
    parameters: {
      ...SCOPE_PARAMS,
      includeBody: { type: 'boolean', description: '是否连正文一起返回（默认只给名称/描述/模式/大小）。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const rules = await listRules(scopeOf(args))
      if (rules.length === 0) return '（没有规则）'
      const lines = rules.map(ruleLine)
      if (args.includeBody === true) {
        for (const rule of rules) {
          const full = await readRule(rule.file, scopeOf(args))
          if (full !== undefined) lines.push('', `### ${full.name}`, full.body)
        }
      }
      return lines.join('\n')
    },
  })

  add({
    name: 'control_center_rule_write',
    description: [
      '新建或覆盖一条规则。规则是**用户对 AI 的约束**，因此这个调用必须由用户在对话里点同意才会执行；',
      '被拒绝时不要重试，改为把想加的内容说给用户听，让他自己决定。',
      'scope=global 写全局规则；scope=project + workspace 写该工作区的项目规则。',
    ].join(''),    parameters: {
      ...SCOPE_PARAMS,
      file: { type: 'string', description: '要覆盖的规则文件名（如 `01-代码治理.md`）；留空表示新建。' },
      name: { type: 'string', required: true, description: '规则名称。' },
      mode: { type: 'string', required: true, enum: ['always', 'ondemand'], description: 'always = 正文注入每个会话（强加载）；ondemand = 只给名称+描述+绝对路径，模型按需读取。' },
      body: { type: 'string', required: true, description: '规则正文（Markdown）。' },
      description: { type: 'string', description: '一句话说明这条规则管什么。' },
      enabled: { type: 'boolean', description: '是否启用，默认 true。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const scope = scopeOf(args)
      const rule = await writeRule(
        {
          file: args.file,
          name: args.name,
          mode: args.mode,
          body: args.body,
          description: args.description ?? '',
          enabled: args.enabled !== false,
        },
        scope,
      )
      return `已保存${scope === undefined ? '全局' : '项目'}规则「${rule.name}」→ ${rule.path}`
    },
  }, { mutating: () => true })

  add({
    name: 'control_center_rule_delete',
    description: '删除一条规则（物理删除）。同样需要用户在对话里同意。',
    parameters: {
      ...SCOPE_PARAMS,
      file: { type: 'string', required: true, description: '要删除的规则文件名。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const scope = scopeOf(args)
      await deleteRule(String(args.file), scope)
      return `已删除规则 ${args.file}`
    },
  }, { mutating: () => true })

  /* ─────────────────────────── MCP ─────────────────────────── */

  add({
    name: 'control_center_mcp',
    description: [
      '管理 MCP 服务器（本插件管的 `~/.dsh/mcp.json`）。改完立即挂载，不需要重启。',
      'action：list / add / update / remove / enable / disable / reload。',
      'add 与 update 需要 name 与 transport（stdio 要 command，streamable-http 要 url）。',
    ].join(''),
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'update', 'remove', 'enable', 'disable', 'reload'] },
      name: { type: 'string', description: '服务器名（工具会以 mcp__<名称>__<工具> 出现）。' },
      transport: { type: 'string', enum: ['stdio', 'streamable-http'], description: '传输方式，默认 stdio。' },
      command: { type: 'string', description: 'stdio 的启动命令，如 npx / uvx / 绝对路径。' },
      args: { type: 'array', description: 'stdio 的启动参数。', items: { type: 'string' } },
      env: { type: 'string', description: 'stdio 的环境变量，一行一个 KEY=VALUE。' },
      cwd: { type: 'string', description: 'stdio 的工作目录（可选）。' },
      url: { type: 'string', description: 'streamable-http 的服务地址。' },
      headers: { type: 'string', description: 'streamable-http 的请求头，一行一个 KEY=VALUE。' },
      toolCallTimeoutMs: { type: 'integer', description: '单次调用超时（毫秒）。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const { servers } = await readMcp()
      const name = String(args.name ?? '').trim()
      switch (args.action) {
        case 'list':
          return servers.length === 0
            ? '（没有登记 MCP 服务器）'
            : servers
                .map((server) => {
                  const how = server.transport === 'stdio' ? `${server.command} ${(server.args ?? []).join(' ')}` : server.url
                  return `- ${server.name}（${server.transport}｜${server.enabled === false ? '停用' : '启用'}）${how}`
                })
                .join('\n')
        case 'add':
        case 'update': {
          if (name === '') throw new Error('必须提供 name')
          const incoming = servers.find((server) => server.name === name)
          const transport = args.transport ?? incoming?.transport ?? 'stdio'
          const candidate = normalizeServer({
            name,
            enabled: incoming?.enabled !== false,
            transport,
            command: args.command ?? incoming?.command,
            args: args.args ?? incoming?.args,
            env: toRecord(args.env) ?? incoming?.env,
            cwd: args.cwd ?? incoming?.cwd,
            url: args.url ?? incoming?.url,
            headers: toRecord(args.headers) ?? incoming?.headers,
            toolCallTimeoutMs: args.toolCallTimeoutMs ?? incoming?.toolCallTimeoutMs,
          })
          await writeMcp([...servers.filter((server) => server.name !== name), candidate])
          await runtime.mcp.sync()
          return `${args.action === 'add' ? '已添加' : '已更新'} MCP 服务器 ${name}（${transport}），已尝试立即挂载。`
        }
        case 'remove': {
          if (name === '') throw new Error('必须提供 name')
          await writeMcp(servers.filter((server) => server.name !== name))
          await runtime.mcp.sync()
          return `已删除 MCP 服务器 ${name}`
        }
        case 'enable':
        case 'disable': {
          if (name === '') throw new Error('必须提供 name')
          if (!servers.some((server) => server.name === name)) throw new Error(`MCP 服务器 ${name} 不存在`)
          await writeMcp(servers.map((server) => (server.name === name ? { ...server, enabled: args.action === 'enable' } : server)))
          await runtime.mcp.sync()
          return `已${args.action === 'enable' ? '启用' : '停用'} MCP 服务器 ${name}`
        }
        default: {
          await runtime.mcp.sync()
          return '已按 mcp.json 重新挂载。'
        }
      }
    },
  }, { mutating: (args) => !['list', 'reload'].includes(args.action) })

  /* ─────────────────────────── 技能 / 记忆 ─────────────────────────── */

  add({
    name: 'control_center_skill',
    description: '管理技能（`~/.dsh/skills`）。action：list / save / remove。技能名必须 kebab-case，描述必填。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'save', 'remove'] },
      id: { type: 'string', description: '技能名（kebab-case）。' },
      description: { type: 'string', description: '技能描述（模型靠它判断何时加载，save 时必填）。' },
      whenToUse: { type: 'string', description: '更细的触发条件。' },
      body: { type: 'string', description: '技能正文（Markdown）。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (args.action === 'list') {
        const skills = await listSkills()
        return skills.length === 0
          ? '（没有技能）'
          : skills.map((skill) => `- ${skill.id}（${skill.kind}｜${(skill.bytes / 1024).toFixed(1)} KB）${skill.description}`).join('\n')
      }
      if (args.action === 'remove') {
        await deleteSkill(String(args.id ?? ''))
        runtime.invalidateSkills()
        return `已删除技能 ${args.id}`
      }
      const saved = await writeSkill({
        id: String(args.id ?? ''),
        description: String(args.description ?? ''),
        whenToUse: args.whenToUse,
        body: String(args.body ?? ''),
      })
      runtime.invalidateSkills()
      return `已保存技能 ${saved.id} → ${saved.path}`
    },
  }, { mutating: (args) => args.action !== 'list' })

  add({
    name: 'control_center_memory',
    description: '管理长期记忆。action：list / save / remove / enable / disable / pin / unpin。记忆是「事实」，规则才是「指令」。',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'save', 'remove', 'enable', 'disable', 'pin', 'unpin'] },
      file: { type: 'string', description: '记忆文件名（覆盖/删除/改状态时用）。' },
      name: { type: 'string', description: '记忆标题（save 时必填）。' },
      description: { type: 'string', description: '一句话描述。' },
      body: { type: 'string', description: '记忆内容（save 时必填）。' },
      scope: { type: 'string', enum: ['global', 'workspace'], description: 'global = 每个会话都注入；workspace = 仅指定目录。' },
      workspace: { type: 'string', description: 'scope=workspace 时的项目目录绝对路径。' },
      tags: { type: 'array', description: '标签。', items: { type: 'string' } },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (args.action === 'list') {
        const memories = await listMemories()
        return memories.length === 0
          ? '（没有记忆）'
          : memories
              .map((memory) => `- ${memory.name}（${memory.file}｜${memory.scope === 'workspace' ? `项目 ${memory.workspace}` : '全局'}｜${memory.enabled === false ? '停用' : '启用'}${memory.pinned ? '｜置顶' : ''}）${memory.description}`)
              .join('\n')
      }
      if (args.action === 'remove') {
        await deleteMemory(String(args.file ?? ''))
        return `已删除记忆 ${args.file}`
      }
      if (args.action === 'save') {
        const saved = await writeMemory({
          file: args.file,
          name: String(args.name ?? ''),
          description: String(args.description ?? ''),
          body: String(args.body ?? ''),
          scope: args.scope === 'workspace' ? 'workspace' : 'global',
          workspace: args.workspace,
          tags: args.tags,
        })
        return `已保存记忆「${saved.name}」→ ${saved.path}`
      }
      const current = await readMemory(String(args.file ?? ''))
      if (current === undefined) throw new Error(`记忆 ${args.file} 不存在`)
      const next = {
        ...current,
        file: current.file,
        enabled: args.action === 'enable' ? true : args.action === 'disable' ? false : current.enabled,
        pinned: args.action === 'pin' ? true : args.action === 'unpin' ? false : current.pinned,
      }
      await writeMemory(next, current.updatedAt || undefined)
      return `已更新记忆 ${current.name} 的状态`
    },
  }, { mutating: (args) => args.action !== 'list' })

  /* ─────────────────────────── 导入 ─────────────────────────── */

  add({
    name: 'control_center_import',
    description: [
      '扫描本机其他 AI 客户端（Codex / Claude Code / Cursor / Trae / Kimi / CC Switch 等二十多个）的 MCP 与技能，并导入 DSH。',
      'action=scan 先看有什么（只读）；action=apply 提交导入。扫描绝不修改别的客户端文件。',
      'apply 需要 servers / skills 数组，每项形如 {source, name}，source 与 name 都取自 scan 的结果。',
    ].join(''),
    parameters: {
      action: { type: 'string', required: true, enum: ['scan', 'apply'] },
      overwrite: { type: 'boolean', description: 'apply 时是否覆盖 DSH 里的同名项（默认不覆盖）。' },
      servers: {
        type: 'array',
        description: 'apply：要导入的 MCP 服务器。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', required: true },
            name: { type: 'string', required: true },
          },
        },
      },
      skills: {
        type: 'array',
        description: 'apply：要导入的技能。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source: { type: 'string', required: true },
            name: { type: 'string', required: true },
          },
        },
      },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const settings = await readSettings()
      if (args.action === 'scan') {
        const result = await scanAll(settings)
        const lines = []
        for (const source of result.sources) {
          if (!source.present) continue
          lines.push(`${source.label}（${source.id}）：`)
          for (const item of source.mcp) {
            lines.push(`  MCP  ${item.name}${item.error === undefined ? '' : `（不可导入：${item.error}）`}`)
          }
          for (const item of source.skills) lines.push(`  技能 ${item.name}`)
        }
        if (lines.length === 0) return '本机没找到其他客户端的可导入内容。'
        lines.push('', `合计：MCP ${result.totals.mcp} 个、技能 ${result.totals.skills} 个。用 action=apply 提交导入。`)
        return lines.join('\n')
      }
      const result = await importItems(
        { servers: args.servers ?? [], skills: args.skills ?? [], overwrite: args.overwrite === true },
        settings,
      )
      if (result.mcp.imported.length > 0) await runtime.mcp.sync()
      if (result.skills.imported.length > 0) runtime.invalidateSkills()
      const lines = [
        `MCP：新增 ${result.mcp.imported.length}、跳过 ${result.mcp.skipped.length}、失败 ${result.mcp.failed.length}`,
        `技能：新增 ${result.skills.imported.length}、跳过 ${result.skills.skipped.length}、失败 ${result.skills.failed.length}`,
      ]
      for (const item of [...result.mcp.skipped, ...result.skills.skipped]) lines.push(`跳过 ${item.name}：${item.reason}`)
      for (const item of [...result.mcp.failed, ...result.skills.failed]) lines.push(`失败 ${item.name}：${item.error}`)
      for (const item of [...result.mcp.imported, ...result.skills.imported]) lines.push(`导入 ${item.name}（来自 ${item.from}）`)
      return lines.join('\n')
    },
  }, { mutating: (args) => args.action === 'apply' })

  /* ─────────────────────────── 设置 ─────────────────────────── */

  add({
    name: 'control_center_settings',
    description: '读写本插件自己的设置（提示词优化开关与路由、记忆注入开关、备份保留份数、扫描源）。action：get / update。',
    parameters: {
      action: { type: 'string', required: true, enum: ['get', 'update'] },
      json: { type: 'string', description: 'update：要合并的设置的 JSON 文本，例如 {"memory":{"inject":false}}。' },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (args.action === 'get') return JSON.stringify(await readSettings(), null, 2)
      let patch
      try {
        patch = JSON.parse(String(args.json ?? '{}'))
      } catch (error) {
        throw new Error(`json 不是合法 JSON：${error?.message ?? String(error)}`)
      }
      const next = await writeSettings(patch)
      return `设置已更新：\n${JSON.stringify(next, null, 2)}`
    },
  }, { mutating: (args) => args.action === 'update' })

  /* ─────────────────────────── 备份 ─────────────────────────── */

  add({
    name: 'control_center_backup',
    description: [
      '备份与恢复 DSH 配置。action：list / sections / create / remove / restore。',
      'create 需要 sections 数组（可选值见 action=sections）：规则、技能、记忆、MCP、插件清单、平台设置等。',
      'restore 会用备份包**替换**当前配置，需要 file（备份文件名）与可选的 sections（缺省=包内全部）。',
    ].join(''),
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'sections', 'create', 'remove', 'restore'] },
      file: { type: 'string', description: '备份产物文件名（remove / restore 用）。' },
      label: { type: 'string', description: 'create 时给这次备份起的名字（可选）。' },
      sections: { type: 'array', description: '分区 id 数组。', items: { type: 'string' } },
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      switch (args.action) {
        case 'sections': {
          const sections = await listSections()
          return sections.map((section) => `- ${section.id}：${section.label} —— ${section.hint}`).join('\n')
        }
        case 'list': {
          const items = await listBackups()
          return items.length === 0
            ? '（没有备份产物）'
            : items.map((item) => `- ${item.file}（${(item.bytes / 1024).toFixed(1)} KB｜${item.createdAt}）`).join('\n')
        }
        case 'create': {
          const settings = await readSettings()
          const created = await createBackup(args.sections, { label: args.label, retention: settings.backup.retention })
          return `已备份到 ${created.file}（${(created.bytes / 1024).toFixed(1)} KB）`
        }
        case 'remove': {
          await deleteBackup(String(args.file ?? ''))
          return `已删除备份 ${args.file}`
        }
        default: {
          const file = String(args.file ?? '')
          const settings = await readSettings()
          const items = await listBackups()
          const target = items.find((item) => item.file === file)
          if (target === undefined) throw new Error(`备份 ${file} 不存在`)
          const analysis = analyzeBackup(await readFile(target.path))
          const plan = await planRestore(analysis, args.sections)
          await createBackup(args.sections === undefined || args.sections.length === 0 ? analysis.sections.map((section) => section.id) : args.sections, {
            label: 'before-restore',
            retention: settings.backup.retention,
          }).catch(() => {})
          const applied = await applyRestore(plan)
          return `已用 ${file} 替换 ${applied.written.length} 个文件${applied.failed.length === 0 ? '' : `，${applied.failed.length} 个失败`}`
        }
      }
    },
  }, { mutating: (args) => !['list', 'sections'].includes(args.action) })

  /* ─────────────────────────── 规则审批闸门 ─────────────────────────── */

  disposers.push(
    // 闸门是 async 的：档位存在磁盘设置里，得先读出来再决定。
    // cordis 的 waterfall 本身不是 async，但平台那侧写的是
    // `const gate = await ctx.waterfall(…)`（dsh-tools 的 tools/pre-execute 调用点），
    // 所以返回 Promise 是安全的——不要改成 fire-and-forget。
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!APPROVAL_REQUIRED.includes(exec.name)) return next()

      // 用户在「规则」页选的档位（settings.rules.approval，见 settings.js 的 RULE_APPROVALS）。
      const settings = await readSettings()
      const mode = settings.rules.approval

      if (mode === 'allow') {
        // 用户明确选了「始终允许」：直接放行，不惊动任何人。
        return next()
      }
      if (mode === 'deny-always') {
        return {
          kind: 'deny',
          reason: `控制中心：规则写入审批被设为「禁止且不再询问」，${exec.name} 不会执行。想让我改规则，请在「规则」页把审批改成「每次询问」或「始终允许」。`,
        }
      }

      // 「每次询问」：先看有没有已经放行的记忆——本轮对话（进程内）或这个工作区（落盘豁免）。
      const session = exec.agent?.session
      const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : ''
      if (session !== undefined && sessionAllows.has(session)) return next()
      if (cwd !== '' && settings.rules.allowedWorkspaces.includes(cwd)) return next()

      const asked = await askRuleApproval(ctx, exec, cwd)
      if (asked !== undefined) {
        if (asked.action === 'allow-session') {
          if (session !== undefined) sessionAllows.add(session)
          return next()
        }
        if (asked.action === 'allow-workspace') {
          // 记进插件设置（幂等：同一个工作区只留一份）。
          await writeSettings({
            rules: { allowedWorkspaces: [...new Set([...settings.rules.allowedWorkspaces, cwd])] },
          }).catch(() => {})
          return next()
        }
        if (asked.action === 'deny-once') {
          return {
            kind: 'deny',
            reason: `控制中心：你在审批弹框里选了「禁止一次」，所以这次没有执行 ${exec.name}；下次还会先问你。`,
          }
        }
        if (asked.action === 'deny-always') {
          await writeSettings({ rules: { approval: 'deny-always' } }).catch(() => {})
          return {
            kind: 'deny',
            reason: `控制中心：你在审批弹框里选了「禁止且不再询问」，${exec.name} 不会执行；想恢复询问请在「规则」页把审批改成「每次询问」。`,
          }
        }
        // 没选择 / 跳过 / 用户自己敲了别的答案：都按「这次不放行」处理，档位不变（fail-closed）。
        const detail = typeof asked.custom === 'string' && asked.custom !== '' ? `你的回答是「${asked.custom}」` : '没有选择'
        return {
          kind: 'deny',
          reason: `控制中心：审批弹框没有给出可用的选择（${detail}），所以这次不会执行 ${exec.name}，档位也没变。`,
        }
      }

      // 弹框通道不可用（没有 answerer、调用方是子 agent、老版本客户端……）→ 退回平台的审批通道。
      // 会话权限预设可能把审批整个关掉（danger-full-access → approval=never）：平台的 approval 服务
      // 此时会在弹窗前直接判 rejected，理由却写成 `the user rejected tool "…"`，看着像用户拒绝、
      // 实际用户根本没被问过。用户既然在设置里选了「每次询问」，就先把本会话策略拨回 ask
      //（这与权限预设的 GUI 走同一条 `setPolicy` 通路）；拨不动才解释真正的原因。
      const approval = ctx.get?.('approval')
      const policy = approval?.effectivePolicy?.(session)
      if (policy === 'never') {
        if (exec.agent === undefined || typeof approval?.setPolicy !== 'function') {
          return {
            kind: 'deny',
            reason: `控制中心：当前会话的权限预设关闭了审批（approval=never，例如 danger-full-access），${exec.name} 会被平台自动拒绝，所以不会弹确认框。想让我改规则，请把权限预设切成 workspace-write；也可以在「规则」页把审批设为「始终允许」。`,
          }
        }
        try {
          approval.setPolicy(exec.agent, 'ask')
        } catch (failure) {
          return {
            kind: 'deny',
            reason: `控制中心：这次想替你把本会话审批打开（${failure?.message ?? failure}），但没成功，所以不会弹确认框。请把权限预设切成 workspace-write；也可以在「规则」页把审批设为「始终允许」。`,
          }
        }
      }
      return {
        kind: 'ask',
        reason: `控制中心：${exec.name} 会修改规则（用户对 AI 的约束），需要你在对话里确认后才执行。`,
      }
    }),
  )

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // 卸载期的清理失败不该阻断其他 disposer。
      }
    }
  }
}
