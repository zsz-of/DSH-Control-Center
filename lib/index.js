/**
 * `dsh-control-center` —— host 半侧入口。
 *
 * 一个设置页背后要落地五件事：
 * 1. **规则注入**：`agent/pre-step` 注入强加载正文 + 按需规则索引（见 `rules.js`）。
 * 2. **记忆注入**：同一钩子里注入长期记忆；按 `scope` 过滤（项目记忆只在对应工作目录生效）。
 * 3. **MCP 运行时**：按 `~/.dsh/mcp.json` 挂载 `dsh-mcp-client`（见 `mcp.js`）。
 * 4. **技能提供方**：把 `~/.dsh/skills` 注册进技能 registry 的全局层（见 `skills.js`）——
 *    当前 web 组合故意禁用了 host 层的 `skill-filesystem`，仓库插件注册 provider 才是官方接缝。
 * 5. **HTTP API + 提示词优化**：`/api/dsh-control-center` 是浏览器侧唯一数据通道（见 `api.js`）；
 *    优化器复用平台的 `llm` 服务（见 `optimize.js`），因此**晚于 llm 就绪才挂上**，不影响其余功能。
 * 6. **任务流协议**：把「对用户输出」协议与「先规划后执行」纪律写进系统提示，并注册
 *    `chat_flow_summary` 总结命令（见 `flow/index.js`——原 `dsh-chat-flow` 的 host 半侧）。
 *
 * 第 1–5 件是控制中心自己的，第 6 件来自合并进来的任务流半侧：两半共用这一份
 * `name` / `inject` / `apply`，所以插件面上只有一个插件、`cordis.patch.yml` 里只有一行。
 *
 * @module dsh-control-center
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerApi } from './api.js'
import { applyFlow } from './flow/index.js'
import { McpRuntime } from './mcp.js'
import { listMemories, renderMemoryInjection } from './memory.js'
import { PromptOptimizer } from './optimize.js'
import { MAX_INJECT_BYTES, MAX_MEMORY_INJECT_BYTES } from './paths.js'
import { digest, renderInjection } from './rules.js'
import { readSettings } from './settings.js'
import { registerDisabledSkillGate, registerSkillProvider } from './skills.js'
import { listRules } from './store.js'
import { registerTools } from './tools.js'

/** cordis 插件名：loader 诊断与注入消息的来源标记都用它。 */
export const name = 'control-center'

/** 需要的服务：`agents` 提供 agent 平面（`agent/pre-step`），`webServer` 提供 HTTP 路由挂载点，
 *  `skills` 是技能 registry（本插件往它的全局层注册 `~/.dsh/skills` 的提供方）。
 *  `llm` 不在这里——它只被提示词优化用，用 `ctx.inject` 单独等，避免它缺失时整个插件不加载。 */
export const inject = ['agents', 'webServer', 'skills']

/** 每个会话最近一次注入内容的摘要——规则/记忆没变就不重复注入，省 token。 */
const lastInjected = new WeakMap()

/**
 * 组装一条插件来源的持久消息。
 *
 * `source.kind` 必须是**生产者自有**的来源名：已退役的 V3 写法
 * `{ kind: 'plugin', plugin: name }` 会被 format v4 拒绝
 * （`format v4 message requires a producer-owned source kind`），
 * 注入发生的那一步连 `step/start` 都写不下去，整轮对话因此中断。
 * V3→V4 迁移给外部插件的映射是 `plugin:` + 完整插件名
 * （见 dsh-session-format-v3-to-v4 的「消息来源转换」），这里按同一映射写出。
 * `form: 'snapshot'` + `sections` 保持上下文注入行的呈现（而不是伪装成用户发言）。
 */
function pluginMessage(text) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${name}`, form: 'snapshot', sections: [{ name, text }] },
  })
}

/**
 * 注册规则注入、记忆注入、MCP 运行时与设置页 API。
 *
 * @param ctx - 插件上下文。
 * @returns 无。
 */
export function apply(ctx) {
  /**
   * 插件的共享运行时：MCP 挂载管理 + 技能目录失效钩子 + 提示词优化器。
   * 三者都由 HTTP API 在使用中触发，因此放在一个显式对象里传递，而不是模块级全局。
   */
  const runtime = {
    mcp: new McpRuntime(ctx),
    /** 由技能 provider 工厂在注册时接上；未注册成功时保持空实现。 */
    invalidateSkills: () => {},
    /** 由 `ctx.inject(['llm'])` 在 llm 就绪后填上；未就绪时 API 明确报错而不是静默失败。 */
    optimize: undefined,
    /**
     * 数据版本号：任何写入（界面 or 工具）都 +1。
     *
     * 浏览器侧轮询 `/revision` 拿它，变了就重拉一次完整 state——这样 Agent 用 `control_center_*`
     * 工具改了 MCP / 技能 / 规则之后，开着的控制中心会在几秒内自己刷新，不会一直显示旧状态。
     */
    revision: 0,
    bumpRevision() {
      this.revision += 1
    },
    /**
     * 会话 id → 会话工作目录。
     *
     * 让浏览器侧能说「给我这个会话的项目规则」而不用去猜会话快照的结构；
     * 会话不存在或还没绑定时返回 `undefined`（调用方按「没有项目规则」处理）。
     */
    sessionCwd: (sessionId) => {
      try {
        return ctx.agents.get(sessionId)?.session?.header?.cwd
      } catch {
        return undefined
      }
    },
    /**
     * 会话是否还活在**本进程**里（打开中 / 正在跑）。
     *
     * 彻底删除会话要先过这一关：内存里活着的会话每落盘一次就会把刚删掉的文件写回来，
     * 与其让用户看到「删了又回来」，不如直接拒绝并让他先切走或重启 DSH。
     * 同时问 `ctx.sessions`（宿主会话存储）与 `ctx.agents`——两个服务存在与否随宿主
     * 装配而变，谁都答不上来时按「不活」处理（那就照常删）。
     */
    sessionLive: (sessionId) => {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      try {
        if (ctx.sessions.get(sessionId) !== undefined) return true
      } catch {
        /* 服务未注装：忽略 */
      }
      try {
        return ctx.agents.get(sessionId) !== undefined
      } catch {
        return false
      }
    },
  }

  ctx.on(
    'agent/pre-step',
    async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const settings = await readSettings()
      const cwd = agent?.session?.header?.cwd
      // 规则分两层：**项目规则**（`<工作区>/.dsh/rules`）在前，**全局规则**（`~/.dsh/rules`）在后。
      // 顺序即优先级：预算不够时先让位的永远是全局规则，项目里那条更具体的指令优先保留。
      const [projectRules, globalRules] = await Promise.all([
        typeof cwd === 'string' && cwd.trim() !== ''
          ? listRules({ scope: 'project', workspace: cwd }).catch(() => [])
          : Promise.resolve([]),
        listRules(),
      ])
      const rules = renderInjection([...projectRules, ...globalRules], MAX_INJECT_BYTES)
      const memory =
        settings.memory.enabled && settings.memory.inject
          ? renderMemoryInjection(await listMemories(), { cwd, maxBytes: MAX_MEMORY_INJECT_BYTES })
          : undefined
      if (rules === undefined && memory === undefined) return decision
      const stamp = digest(`${rules ?? ''}\u0000${memory ?? ''}`)
      const seen = lastInjected.get(agent.session) ?? {}
      if (seen.stamp === stamp) return decision
      lastInjected.set(agent.session, { ...seen, stamp })
      const messages = [...decision.messages]
      if (rules !== undefined) messages.push(pluginMessage(rules))
      if (memory !== undefined) messages.push(pluginMessage(memory))
      return { kind: 'enter', messages }
    },
    { prepend: true },
  )

  ctx.effect(
    () => {
      // 启动即对账一次：名单里启用的服务器立刻挂载，无需重启桌面壳。
      runtime.mcp.sync().catch((error) => {
        runtime.mcp.status.set('__sync__', { state: 'error', error: error?.message ?? String(error) })
      })
      return () => {
        runtime.mcp.dispose().catch(() => {})
      }
    },
    'control-center mcp runtime',
  )

  ctx.effect(
    () =>
      registerSkillProvider(ctx, (control) => {
        runtime.invalidateSkills = () => control.invalidate()
      }),
    'control-center skills',
  )

  ctx.inject(['llm'], (llmCtx) => {
    runtime.optimize = new PromptOptimizer(llmCtx)
  })

  // 工具是「Agent 可自行设置」的那一半能力：只在 tools 服务存在时挂上，
  // 缺它时设置页照旧可用（少一次审批通道，不是少一页界面）。
  ctx.inject(['tools'], (toolsCtx) => {
    const dispose = registerTools(toolsCtx, runtime)
    toolsCtx.effect(() => dispose, 'control-center tools')
    // 关掉的技能：模型可能凭旧上下文再调一次，这里明确拒绝并说清原因（见 skills.js）。
    toolsCtx.effect(() => registerDisabledSkillGate(toolsCtx), 'control-center disabled skill gate')
  })

  // 不要在这里读 `ctx` 上没声明过的字段：cordis 的 Context 是 proxy，读一个不在 `inject` 里的
  // 名字会抛 `cannot get property "X" without inject`，而这个异常会让**整个插件树加载失败**
  // （桌面壳随后进 safe mode）。需要给测试留接缝时，走 `registerApi` 的普通参数，不要走 ctx。
  ctx.effect(() => registerApi(ctx, runtime), 'control-center api')

  // 任务流半侧（原 `dsh-chat-flow`）：协议分区 + 总结命令 + 每回合的规划提醒。
  // 放在最后注册：同样是 `prepend: true` 的 `agent/pre-step`，控制中心的规则/记忆注入先注册、
  // 先跑，注入顺序（规则 → 记忆 → 规划提醒）更好读。插件名从上面传进去，它只用来拼来源标记
  // `plugin:control-center`——注入消息的来源必须是**这个插件**的自有名字，不能写死别的名字。
  applyFlow(ctx, name)
}
