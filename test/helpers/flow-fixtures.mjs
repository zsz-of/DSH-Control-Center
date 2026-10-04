/**
 * 派生测试用的节点夹具。
 *
 * 形状严格照抄核心 `dsh-client-ui-chat` 产出的 chat 节点（字段名与嵌套层级都来自源码，
 * 见 `docs/references/core-seams.md`），因为这一层的全部价值就是「正确读懂核心给的数据」——
 * 夹具一旦宽松，测试就失去意义。
 *
 * @module test/helpers/flow-fixtures
 */

/** 把节点数组包成 `useChat` 快照里 `nodes` 的形状。 */
export function makeSnapshot(nodes) {
  const map = new Map(nodes.map((node) => [node.key, node]))
  return {
    order: nodes.map((node) => node.key),
    nodes: {
      get: (key) => map.get(key),
      values: () => [...map.values()],
    },
  }
}

/** 节点信封的公共字段（核心 `chatNode()` 的产物形状）。 */
function envelope(key, turn, step, kind, data) {
  return {
    key,
    kind,
    id: `${turn}:${step}`,
    target: 'chat',
    anchorSeq: Number(`${turn}${String(step).padStart(3, '0')}`),
    location: { kind: 'step', turn: { turn, status: 'open' }, step: { turn, step, status: 'open' } },
    visibility: 'visible',
    data,
  }
}

/** 用户消息节点。 */
export function userNode(key, turn, text) {
  return envelope(key, turn, 0, 'user', {
    kind: 'user',
    seq: 1,
    time: 0,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/**
 * 插队消息节点（用户在助手干活期间发进来的那条）。
 *
 * 形状来自核心 `input-message` 定义：`source.kind === 'user'` 且已被本轮认领的 `user/message`
 * 被渲染成 `kind: 'steering'`，状态里多一个 `messageId`（`dsh-client-ui-chat/lib/client.js:5761-5768`）。
 */
export function steeringNode(key, turn, step, text) {
  return envelope(key, turn, step, 'steering', {
    kind: 'steering',
    messageId: key,
    seq: 3,
    time: 0,
    content: [{ type: 'text', text }],
    source: { kind: 'user', rpcId: key },
  })
}

/** 助手节点。`blocks` 传 `{kind:'text'|'reasoning', text}`。 */
export function assistantNode(key, turn, step, blocks) {
  return envelope(key, turn, step, 'assistant-step', {
    status: 'settled',
    turn,
    step,
    blocks,
    time: 0,
  })
}

/**
 * 工具调用节点。
 *
 * @param result - 省略表示「还在跑」；给出对象表示已落定，支持
 *   `{content, isError, error, meta, parentCallId}`：
 *   - `error` 是宿主的 `{name, code}` 形状（客户端据此判定「已取消」等状态）；
 *   - `parentCallId` 表示这是嵌套子调用（子结果没有 meta/error）。
 */
export function toolNode(key, turn, step, name, args, result) {
  const argsRaw = JSON.stringify(args)
  let root
  if (result === undefined) {
    root = { callId: key, name, argsRaw, turn, step, time: 0, subCalls: [] }
  } else {
    root = {
      kind: 'tool-result',
      seq: 100,
      time: 0,
      callId: key,
      call: { name, argsRaw },
      callTime: 0,
      content: [{ type: 'text', text: result.content ?? '' }],
      isError: result.isError === true,
      subCalls: [],
    }
    if (result.error !== undefined) root.error = result.error
    if (result.meta !== undefined) root.meta = result.meta
    if (result.parentCallId !== undefined) root.parentCallId = result.parentCallId
  }
  return envelope(key, turn, step, 'tool-call', { root })
}

/** `pwsh` 工具调用节点：按宿主真实格式写入退出码标记。 */
export function pwshNode(key, turn, step, command, output = 'ok', exitCode = 0) {
  const tail = exitCode === 0 ? '' : `\n[exit code: ${exitCode}]`
  return toolNode(key, turn, step, 'pwsh', { command }, { content: `${output}${tail}` })
}

/** 被中断的命令（客户端把中断合成为 `error.code = 'interrupted'`，结果文本为空）。 */
export function interruptedPwshNode(key, turn, step, command) {
  return toolNode(key, turn, step, 'pwsh', { command }, {
    content: '',
    isError: true,
    error: { name: 'Interrupted', code: 'interrupted' },
  })
}

/** `edit` 工具调用节点（用于验证 `−N/+N`）。 */
export function editNode(key, turn, step, path, oldText, newText) {
  return toolNode(key, turn, step, 'edit', { file_path: path, old_string: oldText, new_string: newText }, {
    content: 'edited',
  })
}

/** MCP 工具调用节点。 */
export function mcpNode(key, turn, step, publicName, args, output = 'ok') {
  return toolNode(key, turn, step, publicName, args, { content: output })
}

/** 提问工具调用节点：结果文本是 `JSON.stringify({answers})`。 */
export function askNode(key, turn, step, questions, answers) {
  const content = answers === undefined ? '' : JSON.stringify({ answers })
  return toolNode(key, turn, step, 'ask_user_question', { questions }, { content })
}

/** 子 agent 工具调用节点。 */
export function subagentCallNode(key, turn, step, prompt, output = '子 agent 的报告') {
  return toolNode(key, turn, step, 'subagent', { prompt }, { content: output })
}

/** `write` 工具调用节点。 */
export function writeNode(key, turn, step, path) {
  return toolNode(key, turn, step, 'write', { file_path: path, content: 'x' }, { content: 'written' })
}

/** `todo_write` 工具调用节点。 */
export function todoNode(key, turn, step, todos) {
  return toolNode(key, turn, step, 'todo_write', { todos }, { content: 'updated' })
}

/**
 * 上下文注入节点（规则 / 记忆 / 时间 / 环境…）。
 *
 * 形状来自核心 `input-message` 定义：`source.kind !== 'user'` 的 `user/message` 事件被渲染成
 * `kind: 'context'`，状态里带 `content` / `source` / `provenance` / `form`
 * （`dsh-client-ui-chat/lib/client.js:5752-5760`）。
 */
export function contextNode(key, turn, step, text, source = { kind: 'plugin:chat-flow', form: 'snapshot' }) {
  return envelope(key, turn, step, 'context', {
    kind: 'context',
    seq: 2,
    time: 0,
    content: [{ type: 'text', text }],
    source,
    provenance: { kind: 'system' },
    form: 'snapshot',
  })
}

/**
 * 系统提示词节点。
 *
 * 形状来自核心 `system-prompt` Definition 的 `buildViewNode`：`{text: state.prompt.system}`
 * （`dsh-client-ui-chat/lib/client.js:5837`）——它的正文在 `data.text`，
 * 不像 `context` 那样在 `data.content` 数组里。
 */
export function systemPromptNode(key, turn, step, text) {
  return envelope(key, turn, step, 'system-prompt', { text })
}

/**
 * 回合尾部节点（`turn/end` 之后的收尾控制器）。
 *
 * 本插件**自己**接管这个 kind（阶段折叠就是它的替代品），所以它的 data 只参与「回合是否已结束」
 * 的判定；形状按核心 `tailData` 的公开字段给出（`dsh-client-ui-chat/lib/client.js:6905-6907`）。
 */
export function turnTailNode(key, turn, step, text = '做完了') {
  return envelope(key, turn, step, 'turn-tail', {
    turn,
    closing: { finalNode: { seq: 9 }, blocks: [{ kind: 'text', text }], time: 0 },
    branchUnavailable: false,
  })
}

/**
 * 核心为回合合成的「过程折叠」控制器节点（`turn-process`）。
 *
 * 本插件自己接管它（阶段折叠就是它的替代品，见 `OWNED_NODE_KINDS`），所以它不交给原生座位。
 * ⚠️ 它的**位置**很关键：`turn/start` 早于第一条 `user/message`（本机实测 seq 5 vs 8），
 * 所以它会排在第一个用户节点**之前**——这正是「对话最前面多出一个无操作的块」的成因。
 */
export function turnProcessNode(key, turn, step = 1) {
  return envelope(key, turn, step, 'turn-process', { turn, open: true })
}

/** 没有正文也没有推理的助手步（核心对它 `return null`，渲染层也不该为它画思考块）。 */
export function blankAssistantNode(key, turn, step) {
  return envelope(key, turn, step, 'assistant-step', { status: 'settled', turn, step, blocks: [], time: 0 })
}
