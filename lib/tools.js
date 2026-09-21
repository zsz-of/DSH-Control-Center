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
 * 注意审批的实际行为由会话的权限预设决定（设置 → 权限）：预设里 approval 为 `ask` 时会弹审批，
 * 为 `never` 时这类调用会被直接拒绝——那是用户自己关掉的，不是本插件吞掉。
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
    ctx.on('tools/pre-execute', (exec, next) => {
      if (!APPROVAL_REQUIRED.includes(exec.name)) return next()
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
