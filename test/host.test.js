/**
 * host 半侧接线测试：协议分区 + 规划提醒。
 *
 * 用桩上下文真跑一遍 `apply()`，因此断言的是「接线真的接上了」，而不是「函数存在」。
 * 需要 `Source/node_modules/@deepseek-ai` 链接（`install.mjs` 会建）；缺链接时整组跳过。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'

import { PROTOCOL_BUDGET, SUMMARY_TOOL_NAME } from '../lib/flow/protocol.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEER_LINK = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh-llm')

let plugin
let merged
let ready = false

before(async () => {
  if (!existsSync(PEER_LINK)) return
  // 任务流半侧：只导出 `applyFlow(ctx, pluginName)`；`name` / `inject` 由合并后的顶层入口给出。
  plugin = await import('../lib/flow/index.js')
  merged = await import('../lib/index.js')
  ready = true
})

/** 用「合并后插件自己的名字」跑一遍任务流半侧——注入消息的来源标记就是用它拼的。 */
function applyFlowStub(ctx) {
  plugin.applyFlow(ctx, merged.name)
}

/** 桩上下文：只实现本插件真正用到的那几个动词。 */
function stubCtx() {
  const captured = { handlers: new Map(), effects: [], sections: [], tools: [] }
  const ctx = {
    on(event, handler) {
      captured.handlers.set(event, handler)
    },
    effect(fn, label) {
      captured.effects.push(label)
      const dispose = fn()
      if (typeof dispose === 'function') captured.disposers?.push(dispose)
      return () => {}
    },
    inject(deps, run) {
      // 与真实 cordis 一致：**依赖齐全时**才把补齐后的子上下文交给回调。
      const provided = { ...ctx }
      if (deps.includes('systemPrompt')) {
        provided.systemPrompt = {
          section(section) {
            captured.sections.push(section)
            return () => {}
          },
        }
      }
      if (deps.includes('tools')) {
        provided.tools = {
          register(definition) {
            captured.tools.push(definition)
            return () => {}
          },
        }
      }
      if (deps.every((dep) => provided[dep] !== undefined)) run(provided)
    },
  }
  return { ctx, captured }
}

/** 从一条用户消息里取出正文（`createUserMessage` 的产物是内容块数组）。 */
function textOf(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/** 跑一次 `agent/pre-step`，返回注入进来的正文。 */
async function runPreStep(captured, session, step) {
  const handler = captured.handlers.get('agent/pre-step')
  const decision = await handler({ agent: { session }, step, signal: { aborted: false } }, async () => ({
    kind: 'enter',
    messages: [{ role: 'user', content: [{ type: 'text', text: '原有的上下文' }] }],
  }))
  return { decision, injected: decision.messages.slice(1).map(textOf) }
}

test('host 接线：插件名、硬依赖与两个挂钩', (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接（先跑一次 node scripts/install.mjs）')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  // 合并后插件名与硬依赖由顶层入口统一声明（`lib/index.js`）：注入消息的来源标记必须是
  // **这个插件**的名字，所以任务流半侧不再自己写死 `chat-flow`。
  assert.equal(merged.name, 'control-center')
  assert.deepEqual(merged.inject, ['agents', 'webServer', 'skills'])
  assert.equal(typeof plugin.applyFlow, 'function', '任务流半侧只导出 applyFlow')
  assert.ok(captured.handlers.has('agent/pre-step'), '必须挂 pre-step 才能提醒先规划')
  assert.ok(captured.handlers.has('session/event'), '必须跟踪 session/event 才能知道本回合是否已写计划')
})

test('host 接线：注册一段命名唯一、顺序固定的系统提示分区', (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  assert.equal(captured.sections.length, 1)
  const section = captured.sections[0]
  assert.equal(section.name, 'chat-flow:protocol')
  assert.equal(Number.isFinite(section.order), true)
  // 协议必须写清四个时机与「先规划」，否则模型没有依据可循。
  for (const phrase of ['任务开始时', '输出任务计划时', '需要审批或决定时', '任务结束时', 'todo_write', '禁止批量补记']) {
    assert.ok(section.text.includes(phrase), `协议正文缺少「${phrase}」`)
  }
  // 「任务结束时先调总结命令」是这次新加的唯一硬要求：正文里必须点到它的**真名字**
  // （改常量却忘了改正文，模型就会去调一个不存在的工具）。
  assert.ok(
    section.text.includes(SUMMARY_TOOL_NAME),
    `协议正文必须点名总结命令 ${SUMMARY_TOOL_NAME}`,
  )
  // ⚠️ 这段文字**每个模型请求都会进系统提示**（一个回合几十步就是几十次），所以长度要锁住：
  // 想加内容就得先删掉同量的内容，否则每次请求都在为它多付钱。
  assert.ok(
    section.text.length <= PROTOCOL_BUDGET,
    `协议正文 ${section.text.length} 字符，超出预算 ${PROTOCOL_BUDGET}——它每个请求都要付一次`,
  )
})

test('host 接线：注册「总结命令」工具（描述是模型唯一的调用依据）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  assert.equal(captured.tools.length, 1, '只注册总结命令这一个工具')
  const tool = captured.tools[0]
  assert.equal(tool.name, SUMMARY_TOOL_NAME)
  // 描述是**模型可见**的自然语言：得说清「什么时候必须调」与「正文写在调用之后」。
  assert.match(tool.description, /总结/)
  assert.match(tool.description, /必须调用一次/)
  // 它自己不产出正文，因此不需要任何参数；调用结果只是一个「已标记」的布尔。
  assert.deepEqual(tool.parameters.properties, {})
  assert.deepEqual(await tool.execute({}, {}), { marked: true })
  assert.equal(typeof tool.presentCall, 'function', '调用要能在界面上显示成一张卡')
  assert.equal(tool.presentCall({}).card, 'generic')
})

test('host 接线：工具注册与提示分区都在 effect 里（卸载时能一起收回）', (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  assert.deepEqual(captured.effects, ['flow: prompt section', 'flow: summary tool'])
})

test('回合第一步注入规划提醒，且同一回合只注入一次', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  const session = { id: 's1' }
  captured.handlers.get('session/event')(session, { type: 'turn/start', data: { turn: 1 } })

  const first = await runPreStep(captured, session, 1)
  assert.equal(first.injected.length, 1)
  assert.match(first.injected[0], /<plan-first>/)
  assert.match(first.injected[0], /todo_write/)
  assert.equal(first.decision.messages.length, 2, '原有上下文必须原样保留')

  const second = await runPreStep(captured, session, 1)
  assert.equal(second.injected.length, 0, '同一回合不能重复提醒')

  const later = await runPreStep(captured, session, 2)
  assert.equal(later.injected.length, 0, '第二步之后不再提醒（模型已经在干活）')
})

test('注入消息的来源是生产者自有的 kind（已退役的 V3 `plugin` 包装会被 format v4 拒收）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  const session = { id: 's-source' }
  captured.handlers.get('session/event')(session, { type: 'turn/start', data: { turn: 1 } })

  const { decision } = await runPreStep(captured, session, 1)
  const source = decision.messages[1].source
  // format v4 只接受生产者自有的来源名：`{ kind: 'plugin', plugin: name }` 会让
  // 这一步的 `session.append('user/message', …)` 抛
  // 「format v4 message requires a producer-owned source kind」，
  // 注入所在的那一步连 `step/start` 都写不下去，整轮对话卡死。
  assert.equal(source.kind, 'plugin:control-center')
  assert.equal('plugin' in source, false, 'V3 的 `plugin` 包装字段必须去掉')
  assert.equal(source.form, 'snapshot', '渲染层按 form + sections 标成上下文注入行')
  assert.deepEqual(source.sections.map((section) => section.name), ['chat-flow:protocol'])
})

test('模型已经写过计划就不再提醒', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  const session = { id: 's2' }
  const sessionEvent = captured.handlers.get('session/event')
  sessionEvent(session, { type: 'turn/start', data: { turn: 1 } })
  sessionEvent(session, { type: 'todo/write', data: { todos: [{ content: 'A', status: 'in_progress' }] } })

  const decision = await runPreStep(captured, session, 1)
  assert.equal(decision.injected.length, 0)
  assert.equal(decision.decision.kind, 'enter')
})

test('新回合重置状态：上一次写过计划也要重新提醒', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  const session = { id: 's3' }
  const sessionEvent = captured.handlers.get('session/event')
  sessionEvent(session, { type: 'turn/start', data: { turn: 1 } })
  sessionEvent(session, { type: 'todo/write', data: { todos: [{ content: 'A', status: 'completed' }] } })
  assert.equal((await runPreStep(captured, session, 1)).injected.length, 0)

  sessionEvent(session, { type: 'turn/start', data: { turn: 2 } })
  const next = await runPreStep(captured, session, 1)
  assert.equal(next.injected.length, 1, '每个回合都要重新先规划')
})

test('会话对象缺失或事件缺字段时不抛异常', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  const sessionEvent = captured.handlers.get('session/event')
  assert.doesNotThrow(() => sessionEvent(undefined, undefined))
  assert.doesNotThrow(() => sessionEvent({ id: 's4' }, { type: 'turn/start' }))
  const handler = captured.handlers.get('agent/pre-step')
  const decision = await handler({ agent: undefined, step: 1, signal: undefined }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(decision.kind, 'enter')
})

test('上游拒绝这一步时原样返回，不追加任何消息', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai 链接')
  const { ctx, captured } = stubCtx()
  applyFlowStub(ctx)
  const handler = captured.handlers.get('agent/pre-step')
  const rejected = await handler({ agent: { session: { id: 's5' } }, step: 1, signal: { aborted: false } }, async () => ({ kind: 'reject' }))
  assert.deepEqual(rejected, { kind: 'reject' })
})
