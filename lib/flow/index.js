/**
 * 任务流半侧（原 `dsh-chat-flow`）—— host 半侧接线。
 *
 * 职责只有三件，都很小：
 * 1. 把「对用户输出」协议与「先规划后执行」纪律写进系统提示（`systemPrompt.section`）；
 * 2. 在每个回合的第一步，若该回合还没有任务计划，就注入一条提醒（`agent/pre-step`）；
 * 3. 注册「总结命令」`chat_flow_summary`（`tools.register`）：模型在写最终总结前先调用它一次，
 *    客户端据此把「任务过程」与「总结」分成互斥的两半。
 *
 * **为什么不再是一个独立插件**：客户端任务视图与「对用户输出」协议属于同一套对话体验，
 * 而控制中心已经是「一个包、双面孔」的宿主通道；两半合进同一个包里，用户只装一个插件、
 * 只有一份 `cordis.patch.yml`、profile 里也只有一行。
 *
 * **导出面只有 `applyFlow(ctx, pluginName)`**：`name` / `inject` 由合并后的 `lib/index.js`
 * 统一给出。注入消息的来源标记必须是**这个插件**的名字（`plugin:` + 插件名），而插件名只有
 * 顶层入口知道，所以从外面传进来，不在这里写死。
 *
 * 为什么 host 侧不做数据：任务列表与「正在处理」统计都从会话节点树派生，而节点树由浏览器侧
 * 的 `useChat` 标准 hook 直接提供（见 `docs/references/core-seams.md`）。host 再算一遍就会产生
 * 两份真相，验收标准第 10 条「统计数字与实际调用次数一致」将无法保证。
 * 「总结命令」也是同一条纪律：host 只负责**让模型能声明分界**，分界怎么用完全由客户端派生。
 *
 * @module dsh-control-center/flow
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  PLAN_REMINDER_TEXT,
  PROTOCOL_ORDER,
  PROTOCOL_SECTION,
  PROTOCOL_TEXT,
  SUMMARY_TOOL_NAME,
} from './protocol.js'

/**
 * 每个会话的本回合状态：`turn/start` 重置，`todo/write` 置为已规划。
 *
 * 以 Session 对象为键（`session/event` 的第一个参数就是它），因此不需要会话 id 映射，
 * 也不会因为会话被回收而泄漏。
 */
const turnStates = new WeakMap()

/**
 * 组装一条插件来源的持久消息。
 *
 * `source.form: 'snapshot'` + `sections` 让渲染层把它标成上下文注入行，
 * 与规则/记忆注入保持一致的呈现，而不是伪装成用户发言。
 *
 * `source.kind` 必须是**生产者自有**的来源名。已退役的 V3 写法
 * `{ kind: 'plugin', plugin: name }` 会被 format v4 拒绝
 * （`format v4 message requires a producer-owned source kind`），
 * 会话因此写不下去。V3→V4 迁移给外部插件的映射是
 * `plugin:` + 完整插件名（见 dsh-session-format-v3-to-v4 的「消息来源转换」），
 * 这里直接按该映射写出，历史日志迁移后的来源与实时写入的来源一致。
 *
 * @param text - 注入正文。
 * @param pluginName - 本插件的 cordis 插件名（合并后是 `control-center`）。
 * @returns 一条属于本插件的用户消息。
 */
function pluginMessage(text, pluginName) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: `plugin:${pluginName}`, form: 'snapshot', sections: [{ name: PROTOCOL_SECTION, text }] },
  })
}

/**
 * 「总结命令」的模型可见描述。
 *
 * 工具描述每个请求都会随工具表一起进上下文，所以与 {@link PROTOCOL_TEXT} 同一条纪律：
 * 只写可执行的指令。协议分区里已经说了「任务结束时先调它」，这里只补「它做什么、什么时候别调」。
 */
const SUMMARY_TOOL_DESCRIPTION =
  '本轮给出最终总结之前必须调用一次：它标记「任务过程 / 总结」的分界——从这次调用之后的输出才是给用户的总结，之前的都算过程。它自己不产出正文，总结正文照常写在调用之后。只在真正要交付最终总结时调用，一个回合最多一次。'

/**
 * 注册协议分区、回合状态跟踪、规划提醒与「总结命令」。
 *
 * `systemPrompt` 与 `tools` 都用 `ctx.inject` 单独等：缺任一个时客户端视图照旧可用，
 * 而不是整个插件不加载。`agents`（`agent/pre-step` 事件）是硬依赖，由顶层入口声明。
 *
 * @param ctx - 插件上下文。
 * @param pluginName - 本插件的 cordis 插件名；注入消息的来源标记用它。
 * @returns 无。
 */
export function applyFlow(ctx, pluginName) {
  const name = typeof pluginName === 'string' && pluginName !== '' ? pluginName : 'control-center'

  // 协议分区：缺 systemPrompt 服务时静默跳过（客户端仍能完整工作），不阻断插件加载。
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(
      () =>
        promptCtx.systemPrompt.section({
          name: PROTOCOL_SECTION,
          order: PROTOCOL_ORDER,
          text: PROTOCOL_TEXT,
        }),
      'flow: prompt section',
    )
  })

  // 「总结命令」：分界的**声明权**交给模型，**判定权**留在客户端派生层
  // （`lib/client-flow/20-derive.js` 找该回合内第一次该工具的调用）。
  // 与 `systemPrompt` 一样用 `ctx.inject` 等 `tools`：缺这个服务时插件其余能力照旧可用。
  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(
      () =>
        toolCtx.tools.register(
          defineTool({
            name: SUMMARY_TOOL_NAME,
            description: SUMMARY_TOOL_DESCRIPTION,
            parameters: {},
            output: {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { marked: { type: 'boolean', required: true } },
              },
              render: () => [{ type: 'text', text: '已标记总结分界：此后的输出视为本轮总结。' }],
            },
            execute() {
              // 没有副作用：这次调用本身（节点树里的一条 tool-call）就是标记。
              return Promise.resolve({ marked: true })
            },
            presentCall: () => ({ card: 'generic', title: '标记总结分界', kind: 'other' }),
          }),
        ),
      'flow: summary tool',
    )
  })

  // 跟踪「本回合是否已写计划」。事件签名是 (subject, event)：subject 是 Session。
  ctx.on('session/event', (subject, event) => {
    if (subject === undefined || event === undefined) return
    if (event.type === 'turn/start') {
      turnStates.set(subject, { turn: event.data?.turn ?? 0, planned: false, reminded: undefined })
      return
    }
    if (event.type === 'todo/write') {
      const state = turnStates.get(subject)
      if (state !== undefined) state.planned = true
    }
  })

  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal?.aborted === true) return decision
      // 只在回合的第一步提醒：后续步里模型已经在干活，再提醒只会污染上下文。
      if (typeof step === 'number' && step > 1) return decision
      const session = agent?.session
      if (session === undefined) return decision
      const state = turnStates.get(session)
      // 已写过计划，或本回合已经提醒过，就不再重复。
      if (state !== undefined && (state.planned === true || state.reminded === state.turn)) return decision
      if (state !== undefined) state.reminded = state.turn
      return { kind: 'enter', messages: [...decision.messages, pluginMessage(PLAN_REMINDER_TEXT, name)] }
    },
    { prepend: true },
  )
}
