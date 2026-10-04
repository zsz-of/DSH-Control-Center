/**
 * 子代理过程（内联读子会话）的用例。
 *
 * 三层，从里到外：
 * 1. **席位**（`subagentSeatFace`）：用桩 ctx 走完整的「拉目录 → 装地址 → 开窗口 → 订阅 → 退订」，
 *    外加三条降级路径（目录里没有这个子会话 / 解不出 chat / 开窗口抛错）；
 * 2. **行模型**（`subagentRowsOf`）：子会话快照 → 步骤行，纯函数；
 * 3. **面板**（`views.SubagentProcess`）：用探针 React 跑 hook + effect，验证「展开才订阅」、
 *    徽标步数、截断提示、跳转按钮，以及嵌套时的递归刹车。
 *
 * 真机上的**上下文传播**（`TaskFlowView` 的 Provider → 深处的子代理卡）由
 * `client-render-react.test.js` 的真实 React SSR 用例覆盖；手写替身只有默认值语义，测不出来。
 *
 * @module test/subagent-process
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { loadBundle, createFakeReact, collectText } from './helpers/load-bundle.mjs'
import { createProbeReact } from './helpers/probe-react.mjs'
import {
  makeSnapshot,
  userNode,
  assistantNode,
  pwshNode,
  contextNode,
  turnTailNode,
  subagentCallNode,
} from './helpers/flow-fixtures.mjs'

/** 子会话 id（核心给的都是这种 uuid）。 */
const CHILD = '11111111-2222-3333-4444-555555555555'

/**
 * 目录里这个子会话的条目（核心投影 `subagentCatalog` 的真实形状）。
 *
 * 平台从 `dsh-subagent` 的 `subagentCatalogEntries()` 直接投影出来的就是这四个字段
 * （`{id, createdAt, mode, label?}`）——**没有 `kind`**，所以插件不能靠 `kind === 'child'` 认子会话。
 */
const ENTRY = { id: CHILD, createdAt: 1, mode: 'continuable', label: '查目录' }

/** 子会话的对话快照：用户发言 + 思考/正文 + 一次工具调用 + 一次上下文压缩 + 收尾行。 */
function childSnapshot() {
  return makeSnapshot([
    userNode('u1', 1, '去查一下'),
    assistantNode('a1', 1, 1, [{ kind: 'text', text: '先看目录。' }]),
    pwshNode('t1', 1, 2, 'dir', 'a.js'),
    contextNode('x1', 1, 3, '压缩了上下文'),
    turnTailNode('tt1', 1, 4, '做完了'),
  ])
}

let internals

test.before(async () => {
  const loaded = await loadBundle({ react: createFakeReact() })
  internals = loaded.exports.__internals
})

/* ────────────────────────── 1. 席位 ────────────────────────── */

/**
 * 造一个足够真的 `ctx`：`sessions` 是硬依赖，`uiConversation` / `uiWorkspace` 走 `ctx.get`。
 *
 * 桩必须照平台**真实**的接口来造，否则测出来的绿灯是假的（这正是以前那批用例的问题）：
 * 目录是会话投影（`list.projectionsBySession[sid].values.subagentCatalog`）、水合入口是
 * `sessions.refreshProjections(parent)`、读子会话必须先 `sessions.retain(...)`
 * （`binding` 只在保活过的 scope 上存在）、跳转走 `ctx.get('uiWorkspace').openSession(target)`。
 *
 * @param options - `chat`（子会话 chat 源）、`address`（`subagentAddress` 的返回值）、
 *   `entries`（目录条目）、`binding`（置 false 模拟「宿主列表里没有这个子会话」）、
 *   `retain`（置 false 模拟宿主没装 retain）、`uiConversation` / `uiWorkspace`（置 false 模拟缺席）、
 *   `openFails`（置 true 让 `session.open()` 抛）。
 * @returns `{ctx, calls, pushList}`。
 */
function stubCtx(options = {}) {
  const calls = {
    refresh: 0,
    parents: [],
    configure: [],
    open: 0,
    retain: [],
    released: 0,
    openSession: [],
    listSubscribed: 0,
    listUnsubscribed: 0,
  }
  const entries = options.entries ?? [ENTRY]
  const listListeners = []
  const list = {
    byId: options.byId ?? {},
    // 目录的权威形状：会话投影（`subagentCatalog`），不是 list 快照的顶层字段。
    projectionsBySession: { s1: { values: { subagentCatalog: entries } } },
    getSnapshot: () => list,
    subscribe: (listener) => {
      listListeners.push(listener)
      calls.listSubscribed += 1
      return () => {
        const index = listListeners.indexOf(listener)
        if (index >= 0) listListeners.splice(index, 1)
        calls.listUnsubscribed += 1
      }
    },
  }
  const sessions = {
    list,
    subagentAddress: () => options.address,
    refreshProjections: async (parentSessionId) => {
      calls.refresh += 1
      calls.parents.push(parentSessionId)
      if (options.refreshFails === true) throw new Error('catalog route refused')
    },
    retain: (target, retainOptions) => {
      if (options.retain === false) return undefined
      calls.retain.push([target, retainOptions])
      const release = () => {
        calls.released += 1
      }
      if (options.retainFails === true) return { ready: Promise.reject(new Error('retain refused')), release }
      return { ready: Promise.resolve(), release }
    },
    binding: (childId) => {
      if (options.binding === false) return undefined
      return {
        sessionId: childId,
        session: {
          configureSubagent: (address, parentAvailable) => calls.configure.push([address, parentAvailable]),
          open: async () => {
            calls.open += 1
            if (options.openFails === true) throw new Error('history route refused')
          },
        },
      }
    },
  }
  const ctx = {
    sessions,
    get: (name) => {
      if (name === 'uiConversation') {
        if (options.uiConversation === false) return undefined
        return {
          binding: () => ({
            // `binding(childId).target('chat')` 是唯一真实的取数路径；未保活时核心会抛，这里只测「没有」。
            target: () => (options.chat === undefined ? undefined : options.chat),
          }),
        }
      }
      if (name === 'uiWorkspace') {
        if (options.uiWorkspace === false) return undefined
        return { openSession: (target) => calls.openSession.push(target) }
      }
      return undefined
    },
  }
  /** 推一次列表变更（模拟宿主推子代理新增 / 运行态变化）。 */
  function pushList() {
    for (const listener of [...listListeners]) listener()
  }
  return { ctx, calls, pushList }
}

/** 造一个可控的 chat 源：能推快照、能观察退订。 */
function stubChat() {
  const listeners = []
  const source = {
    snapshot: childSnapshot(),
    getSnapshot() {
      return source.snapshot
    },
    subscribe(listener) {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
  return {
    source,
    listeners,
    /** 推一次快照变更（模拟子会话继续干活）。 */
    push(snapshot) {
      source.snapshot = snapshot
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 等一次微任务队列，让 `ensureOpen` 里的 await 落地。 */
async function flushed() {
  await new Promise((resolve) => setImmediate(resolve))
}

test('子代理席位：宿主没装 sessions 时给空席位（视图照常渲染，只是没有过程面板）', () => {
  assert.deepEqual(internals.subagentSeatFace({}, 's1'), {})
  assert.deepEqual(internals.subagentSeatFace({ sessions: {} }, 's1'), {})
})

test('子代理席位：先拉目录、装地址、开窗口，然后把子会话快照发给监听器', async () => {
  const chat = stubChat()
  // `subagentAddress` 没记过 —— 地址必须从子代理目录里取。
  const { ctx, calls } = stubCtx({ chat: chat.source })
  const seat = internals.subagentSeatFace(ctx, 's1')
  const seen = []
  const unsubscribe = seat.watch(CHILD, (state) => seen.push(state))

  assert.deepEqual(seen, [{ phase: 'loading' }], '先给一个 loading，别让面板空白')
  await flushed()

  assert.equal(calls.refresh, 1)
  assert.deepEqual(calls.parents, ['s1'], '目录按父会话拉')
  assert.deepEqual(
    calls.retain,
    [[{ parentSessionId: 's1', childSessionId: CHILD, mode: 'continuable' }, { source: 'chatFlow' }]],
    '读子会话之前必须先 retain：binding 只在保活过的 scope 上存在（这是以前整条链路哑掉的地方）',
  )
  assert.deepEqual(
    calls.configure,
    [[{ parentSessionId: 's1', childSessionId: CHILD, mode: 'continuable' }, true]],
    '目录地址必须装回会话，否则历史路由拿不到子会话',
  )
  assert.equal(calls.open, 1)
  assert.equal(seen.at(-1).phase, 'ready')
  assert.equal(seen.at(-1).snapshot, chat.source.snapshot, '快照形状与 useChat 一致，派生层能直接复用')

  chat.push(makeSnapshot([userNode('u2', 1, '再看一眼')]))
  assert.equal(seen.at(-1).snapshot.order[0], 'u2', '订阅之后子会话继续干活要能推过来')

  unsubscribe()
  chat.push(makeSnapshot([userNode('u3', 1, '不该收到')]))
  assert.equal(seen.at(-1).snapshot.order[0], 'u2', '退订之后不该再收到更新')
  assert.equal(chat.listeners.length, 0)
  assert.equal(calls.released, 1, '最后一个 watcher 退订要真的 release 保活，别把子会话钉死在内存里')
})

test('子代理席位：同一个子会话只拉一次目录、只开一次窗口', async () => {
  const chat = stubChat()
  const { ctx, calls } = stubCtx({ chat: chat.source })
  const seat = internals.subagentSeatFace(ctx, 's1')
  const first = seat.watch(CHILD, () => {})
  const second = seat.watch(CHILD, () => {})
  await flushed()
  assert.equal(calls.retain.length, 1, '保活是幂等的')
  first()
  second()
  assert.equal(calls.refresh, 1, '目录只拉一次')
  assert.equal(calls.open, 1, '窗口是幂等的')
  assert.equal(calls.released, 1, '两个 watcher 都退了才 release 一次')
})

test('子代理席位：保活失败不缓存 —— 目录随后水合后还能重试成功（以前是永久 unavailable）', async () => {
  const chat = stubChat()
  const options = { chat: chat.source, retainFails: true }
  const { ctx, calls } = stubCtx(options)
  const seat = internals.subagentSeatFace(ctx, 's1')

  const first = []
  const stopFirst = seat.watch(CHILD, (state) => first.push(state))
  await flushed()
  assert.deepEqual(first.at(-1), { phase: 'unavailable', reason: 'error' }, '第一次拉不动要如实报错')
  stopFirst()

  options.retainFails = false
  const second = []
  const stopSecond = seat.watch(CHILD, (state) => second.push(state))
  await flushed()
  assert.equal(second.at(-1).phase, 'ready', '负结果绝不能进缓存：子会话是随后才水合的')
  assert.equal(calls.retain.length, 2, '第二次展开真的又试了一次')
  stopSecond()
})

test('子代理席位：宿主列表里没有这个子会话时如实降级成 unlisted', async () => {
  const { ctx } = stubCtx({ binding: false, chat: stubChat().source })
  const seat = internals.subagentSeatFace(ctx, 's1')
  const seen = []
  const unsubscribe = seat.watch(CHILD, (state) => seen.push(state))
  await flushed()
  assert.deepEqual(seen.at(-1), { phase: 'unavailable', reason: 'unlisted' })
  unsubscribe()
})

test('子代理席位：解不出 chat 源时降级成 no-chat（不抛、不空转）', async () => {
  const { ctx } = stubCtx({ uiConversation: false })
  const seat = internals.subagentSeatFace(ctx, 's1')
  const seen = []
  const unsubscribe = seat.watch(CHILD, (state) => seen.push(state))
  await flushed()
  assert.deepEqual(seen.at(-1), { phase: 'unavailable', reason: 'no-chat' })
  unsubscribe()
})

test('子代理席位：开窗口抛错时降级成 error，并留一条日志', async () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    const { ctx } = stubCtx({ chat: stubChat().source, openFails: true })
    const seat = internals.subagentSeatFace(ctx, 's1')
    const seen = []
    const unsubscribe = seat.watch(CHILD, (state) => seen.push(state))
    await flushed()
    assert.deepEqual(seen.at(-1), { phase: 'unavailable', reason: 'error' })
    assert.ok(
      warnings.some((args) => String(args[0]).includes('[chat-flow] 打开子会话窗口失败')),
      '降级要留痕，否则真机排查时看不到子会话为什么打不开',
    )
    unsubscribe()
  } finally {
    console.warn = originalWarn
  }
})

test('子代理席位：退订发生在开窗口还在飞的时候，也不该再回调', async () => {
  let release = () => {}
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const chat = stubChat()
  const { ctx } = stubCtx({ chat: chat.source })
  const original = ctx.sessions.binding
  ctx.sessions.binding = (childId) => {
    const binding = original(childId)
    return { sessionId: binding.sessionId, session: { ...binding.session, open: () => gate } }
  }
  const seat = internals.subagentSeatFace(ctx, 's1')
  const seen = []
  const unsubscribe = seat.watch(CHILD, (state) => seen.push(state))
  unsubscribe()
  release()
  await flushed()
  assert.deepEqual(seen, [{ phase: 'loading' }], '退订后飞回来的结果必须丢掉')
})

test('子代理席位：子代理目录地址缺失时也能用本地记账的地址', async () => {
  const chat = stubChat()
  const address = { parentSessionId: 's1', childSessionId: CHILD }
  const { ctx, calls } = stubCtx({ chat: chat.source, address, entries: [] })
  const seat = internals.subagentSeatFace(ctx, 's1')
  const unsubscribe = seat.watch(CHILD, () => {})
  await flushed()
  assert.deepEqual(calls.configure, [[address, true]], '本地记账的地址优先于目录')
  assert.equal(seat.openSubagent(CHILD), true)
  assert.deepEqual(calls.openSession, [address], '跳转走核心的 uiWorkspace.openSession（那条路会切舞台，只在点击时走）')
  unsubscribe()
})

test('子代理席位：目录与本地记账都没地址时，跳转用「父会话 + 子会话」这个最小地址兜底', () => {
  const { ctx, calls } = stubCtx({ chat: stubChat().source, entries: [] })
  const seat = internals.subagentSeatFace(ctx, 's1')
  assert.equal(seat.openSubagent(CHILD), true)
  assert.deepEqual(
    calls.openSession,
    [{ parentSessionId: 's1', childSessionId: CHILD }],
    'uiWorkspace.openSession 接受 id 或地址，最小地址也够切到子会话',
  )
})

test('子代理席位：宿主没装 uiWorkspace 时跳转返回 false，绝不瞎调核心', () => {
  const { ctx, calls } = stubCtx({ chat: stubChat().source, uiWorkspace: false })
  const seat = internals.subagentSeatFace(ctx, 's1')
  assert.equal(seat.openSubagent(CHILD), false)
  assert.deepEqual(calls.openSession, [])
})

/* ────────────────────────── 2. 行模型 ────────────────────────── */

test('子代理行模型：工具/正文/思考保留，过程标注与收尾行丢掉', () => {
  const rows = internals.subagentRowsOf(childSnapshot())
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['message', 'assistant', 'tool'],
    '用户发言是子会话的输入，值得显示；上下文压缩这类过程标注是噪音（且没有对应的行渲染器）',
  )
  assert.deepEqual(
    rows.map((row) => row.key),
    ['u1', 'a1', 't1'],
  )
  // 白名单必须与 subagentRowOf 的分派一一对应，否则会画出空叶子。
  for (const row of rows) {
    assert.notEqual(
      internals.subagentRowOf(row, { t: (key) => key, sessionId: 's1', labels: {}, keyPrefix: 'n:c1' }),
      null,
      `${row.kind} 行必须有渲染器`,
    )
  }
})

test('子代理行模型：空快照 / 缺快照都给空数组（面板据此显示「还没有步骤」）', () => {
  assert.deepEqual(internals.subagentRowsOf(makeSnapshot([])), [])
  assert.deepEqual(internals.subagentRowsOf(undefined), [])
})

/* ────────────────────────── 3. 面板 ────────────────────────── */

/** 造一个面板要用的子代理卡模型（`toolCardOf` 的子代理分支产物形状）。 */
function subagentCard(overrides = {}) {
  return {
    key: 'c1',
    kind: 'subagent',
    toolName: 'subagent',
    title: 'subagent',
    status: 'running',
    childId: CHILD,
    prompt: '去查一下',
    markdownLabels: { copy: '复制' },
    ...overrides,
  }
}

/** 收集树里所有 `className` 命中的元素（探针 React 的 element 是 `{type, props}`）。 */
function collectByClass(value, className, found = []) {
  if (value === null || value === undefined || typeof value !== 'object') return found
  if (Array.isArray(value)) {
    for (const item of value) collectByClass(item, className, found)
    return found
  }
  if (value.props !== undefined) {
    if (value.props.className === className) found.push(value)
    collectByClass(value.props.children, className, found)
  }
  return found
}

/** 收集树里所有带某个属性值的元素。 */
function collectByAttr(value, name, expected, found = []) {
  if (value === null || value === undefined || typeof value !== 'object') return found
  if (Array.isArray(value)) {
    for (const item of value) collectByAttr(item, name, expected, found)
    return found
  }
  if (value.props !== undefined) {
    if (value.props[name] === expected) found.push(value)
    collectByAttr(value.props.children, name, expected, found)
  }
  return found
}

/**
 * 面板的折叠头（`DisclosureLine` 元素）。
 *
 * 探针 React 不递归渲染函数组件，所以折叠头自己那行文字（标题 + 徽标）**只能从 props 读**——
 * `collectText` 看不到它。这里返回全部实例，调用方按 `props.title` 认。
 */
function disclosureLines(value, found = []) {
  if (value === null || value === undefined || typeof value !== 'object') return found
  if (Array.isArray(value)) {
    for (const item of value) disclosureLines(item, found)
    return found
  }
  if (value.props !== undefined) {
    if (value.props.title !== undefined && value.props.onToggle !== undefined) found.push(value)
    disclosureLines(value.props.children, found)
  }
  return found
}

/** 一个「立刻 ready」的假席位，记录调用。 */
function stubSeat(snapshot = childSnapshot()) {
  const calls = { watched: [], opened: [] }
  return {
    calls,
    seat: {
      watch(childId, listener) {
        calls.watched.push(childId)
        listener({ phase: 'ready', snapshot })
        return () => {}
      },
      openSubagent(childId) {
        calls.opened.push(childId)
      },
    },
  }
}

/**
 * 用探针 React 挂一次面板（每次都重新装载 bundle，让 hook 槽位干净）。
 *
 * @param props - 面板 props（`seat` 走显式接缝）。
 * @param snapshot - 子会话快照。
 * @returns `{value, calls, render, html}`。
 */
async function mountPanel(props, snapshot = childSnapshot()) {
  const { react, mount } = createProbeReact()
  const loaded = await loadBundle({ react })
  const local = loaded.exports.__internals
  const { seat, calls } = stubSeat(snapshot)
  const t = (key, params) => {
    const template = local.ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  const harness = mount(local.views.SubagentProcess, {
    card: subagentCard(),
    t,
    sessionId: 's1',
    keyPrefix: 'n:c1',
    active: true,
    seat,
    ...props,
  })
  harness.render()
  // effect 里 watch 是同步回调 ready 的，再渲染一次才能看到步骤行。
  harness.render()
  return { harness, calls, internals: local, text: collectText(harness.value) }
}

test('子代理过程面板：展开时列出子会话步骤，徽标给真实步数', async () => {
  const { harness, calls, text } = await mountPanel({})
  // 探针 React 每次 render 都重跑全部 effect（不做 deps 比较），所以会被订阅多次；关键是只订它。
  assert.deepEqual([...new Set(calls.watched)], [CHILD], '展开才订阅，且只订这个子会话')
  const head = disclosureLines(harness.value)
  assert.equal(head.length, 1)
  assert.equal(head[0].props.title, '子代理过程')
  assert.equal(head[0].props.summary, '3 步', '徽标是真实步数（含被截断掉的）')
  assert.match(text, /打开子会话/)

  const list = collectByClass(harness.value, 'dcf-subprocess')
  assert.equal(list.length, 1)
  const rows = list[0].props.children[1]
  assert.equal(Array.isArray(rows) ? rows.length : 0, 3, '三步都画出来')
  assert.equal(harness.value.props['data-phase'], 'ready')
})

test('子代理过程面板：超过上限时只画最近的一批，并说明被截断了', async () => {
  const many = Array.from({ length: internals.MAX_SUBAGENT_ROWS + 5 }, (_, index) =>
    pwshNode(`t${index + 1}`, 1, index + 1, `echo ${index + 1}`, 'ok'),
  )
  const { harness, text } = await mountPanel({}, makeSnapshot(many))
  assert.match(text, new RegExp(`只显示最后 ${internals.MAX_SUBAGENT_ROWS} 步`))
  assert.equal(disclosureLines(harness.value)[0].props.summary, `${internals.MAX_SUBAGENT_ROWS + 5} 步`)
  const list = collectByClass(harness.value, 'dcf-subprocess')
  const rows = list[0].props.children[1]
  assert.equal(rows.length, internals.MAX_SUBAGENT_ROWS)
})

test('子代理过程面板：卡片收起时连订阅都不发（不白拉子会话窗口）', async () => {
  const { harness, calls } = await mountPanel({ active: false })
  assert.deepEqual(calls.watched, [], '卡片收起就不该读子会话')
  assert.equal(disclosureLines(harness.value)[0].props.title, '子代理过程', '面板本身还在（用户能看到入口）')
  assert.equal(harness.value.props['data-phase'], 'idle')
  assert.equal(collectByClass(harness.value, 'dcf-subprocess').length, 0)
})

test('子代理过程面板：没有 childId 或席位缺席时整块不画', async () => {
  const noChild = await mountPanel({ card: subagentCard({ childId: '' }) })
  assert.equal(noChild.harness.value, null)
  assert.deepEqual(noChild.calls.watched, [])

  const noSeat = await mountPanel({ seat: null })
  assert.equal(noSeat.harness.value, null)
})

test('子代理过程面板：点「打开子会话」交给席位跳转', async () => {
  const { harness, calls } = await mountPanel({})
  const buttons = collectByAttr(harness.value, 'data-dcf-subagent-open', 'true')
  assert.equal(buttons.length, 1)
  buttons[0].props.onClick()
  assert.deepEqual(calls.opened, [CHILD])
})

test('子代理过程面板：面板内部把席位压成 null（子会话里的子代理卡不再递归读）', async () => {
  const { harness } = await mountPanel({})
  const providers = collectByAttr(harness.value, 'value', null)
  assert.ok(providers.length >= 1, '递归刹车：Provider 显式传 null')
})

test('子代理过程面板：子会话还没给出步骤时，给一句说明而不是空白', async () => {
  const { text, harness } = await mountPanel({}, makeSnapshot([]))
  assert.match(text, /还没有可显示的步骤/)
  assert.equal(disclosureLines(harness.value)[0].props.summary, '0 步')
  assert.equal(harness.value.props['data-phase'], 'ready')
})

test('子代理过程面板：读不到子会话时降级成说明 + 跳转按钮，不空转', async () => {
  const { react, mount } = createProbeReact()
  const loaded = await loadBundle({ react })
  const local = loaded.exports.__internals
  const seat = {
    watch(_childId, listener) {
      listener({ phase: 'unavailable', reason: 'unlisted' })
      return () => {}
    },
    openSubagent: () => {},
  }
  const t = (key) => local.ZH[key] ?? key
  const harness = mount(local.views.SubagentProcess, {
    card: subagentCard(),
    t,
    sessionId: 's1',
    keyPrefix: 'n:c1',
    active: true,
    seat,
  })
  harness.render()
  harness.render()
  const head = disclosureLines(harness.value)
  assert.equal(head.length, 1)
  assert.match(String(head[0].props.summary), /读不到这个子代理的过程/)
  assert.equal(harness.value.props['data-phase'], 'unavailable')
  assert.equal(collectByAttr(harness.value, 'data-dcf-subagent-open', 'true').length, 1, '降级也要留跳转')
})

test('子代理过程面板：卡片与面板都要展开才读（两层折叠都算数）', async () => {
  const { react, mount } = createProbeReact()
  const loaded = await loadBundle({ react })
  const local = loaded.exports.__internals
  const { seat, calls } = stubSeat()
  const t = (key) => local.ZH[key] ?? key
  // 面板自身的默认展开态是 `active`，所以「卡片展开 + 面板收起」只能靠折叠存储构造。
  const storage = loaded.storage
  const sessionId = 's1'
  storage.setItem(
    `dsh-chat-flow.collapse.${sessionId}`,
    JSON.stringify({ 'n:c1:process': false }),
  )
  const harness = mount(local.views.SubagentProcess, {
    card: subagentCard(),
    t,
    sessionId,
    keyPrefix: 'n:c1',
    active: true,
    seat,
  })
  harness.render()
  harness.render()
  assert.deepEqual(calls.watched, [], '面板收起时不读')
})

test('子代理过程：席位缺席时子代理卡退回只显示报告（一个空壳都不多画）', async () => {
  const loaded = await loadBundle({ react: createFakeReact() })
  const local = loaded.exports.__internals
  const t = (key) => local.ZH[key] ?? key
  // 跑动中的卡默认展开，body 一定在树里——这才是「会不会多画空壳」的真问题。
  const element = local.views.SubagentCard({
    card: subagentCard({ status: 'running', report: undefined }),
    t,
    sessionId: 's1',
    keyPrefix: 'n:c1',
  })
  assert.match(collectText(element), /已派出/)
  assert.equal(
    collectByAttr(element, 'data-dcf-subagent', 'true').length,
    0,
    '没有席位就不画过程面板——宿主缺 ui-session / ui-conversation 的装配里不该多一个点不开的空壳',
  )
})

test('子代理过程：派发卡的 childId 来自派发结果，面板拿的就是它', () => {
  const rows = internals.subagentRowsOf(
    makeSnapshot([subagentCallNode('c9', 1, 1, '去查一下', `started subagent ${CHILD}`)]),
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].card.childId, CHILD, '行模型读的是同一套派生（childId 由 toolCardOf 抓出来）')
})

/* ────────────────────── 4. 席位的目录能力（下拉菜单的取数） ────────────────────── */

test('子代理席位：目录读的是会话列表快照 + 本会话的目录条目', () => {
  const { ctx } = stubCtx({ byId: { [CHILD]: { id: CHILD, parentId: 's1', title: '查目录', running: true } } })
  const seat = internals.subagentSeatFace(ctx, 's1')
  const data = seat.catalog()
  assert.equal(data.list.byId[CHILD].running, true, 'byId 里有全机的父子链与运行态')
  assert.deepEqual(data.catalog.entries, [ENTRY], '目录条目给标签与模式')
})

test('子代理席位：目录订阅走会话列表，退订要透传下去', () => {
  const { ctx, calls, pushList } = stubCtx({})
  const seat = internals.subagentSeatFace(ctx, 's1')
  let fired = 0
  const unsubscribe = seat.subscribeCatalog(() => {
    fired += 1
  })
  assert.equal(calls.listSubscribed, 1)
  pushList()
  assert.equal(fired, 1, '宿主推一次变更就要回调一次（运行态就靠这条路刷新）')
  unsubscribe()
  assert.equal(calls.listUnsubscribed, 1)
  assert.equal(typeof seat.subscribeCatalog(() => {}), 'function', '退订必须给函数（卸载时无脑调）')
})

test('子代理席位：refreshCatalog 按本会话拉目录；拉不动时只留日志不炸', async () => {
  const { ctx, calls } = stubCtx({})
  internals.subagentSeatFace(ctx, 's1').refreshCatalog()
  await flushed()
  assert.deepEqual(calls.parents, ['s1'])

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    const { ctx: bad } = stubCtx({ refreshFails: true })
    internals.subagentSeatFace(bad, 's1').refreshCatalog()
    await flushed()
    assert.ok(
      warnings.some((args) => String(args[0]).includes('[chat-flow] 拉取子代理目录失败')),
      '目录拉不动要留痕（宿主没这个接口时不能静默）',
    )
  } finally {
    console.warn = originalWarn
  }
})

test('子代理席位：宿主没装 sessions 时是空席位；装了但没列表快照时目录读成空数组', () => {
  assert.deepEqual(internals.subagentSeatFace({}, 's1'), {})
  assert.deepEqual(internals.subagentSeatFace({ sessions: {} }, 's1'), {}, '缺 binding 就不算能用')
  const bare = internals.subagentSeatFace({ sessions: { list: {}, binding: () => undefined } }, 's1')
  assert.deepEqual(
    bare.catalog(),
    { list: undefined, catalog: { entries: [] } },
    '列表读不动时 list 给 undefined，目录如实给空数组（消费侧不必再判 undefined）',
  )
  assert.equal(typeof bare.subscribeCatalog(() => {}), 'function', '列表不可订阅也要给退订函数')
  bare.refreshCatalog()
})

/* ────────────────────── 5. 子代理下拉的行模型（纯函数） ────────────────────── */

/** 核心 `settlementSummary` 的原话（`dsh-subagent/lib/index.js:641-681`）。 */
const SETTLE = {
  completed: 'The subagent finished and will do no further work unless you send it more.',
  aborted: 'The subagent was stopped before it finished.',
  'max-tokens': 'The subagent ran out of room before it finished.',
  refusal: 'The subagent declined the task.',
  error: 'The subagent failed before it finished.',
}

/**
 * 造一棵「会话列表快照」：`spec` 是 `{childId: {parentId, running, title}}`。
 *
 * @param spec - 子会话摘要表。
 * @returns 列表快照（`byId` + 目录）。
 */
function catalogOf(spec, entries = []) {
  const byId = {}
  for (const [id, summary] of Object.entries(spec)) byId[id] = { id, ...summary }
  return { list: { byId }, catalog: { entries } }
}

test('子代理行模型：正在跑的排第一（byId.running 与目录 activity 都算）', () => {
  const child = '22222222-3333-4444-5555-666666666666'
  const fromList = internals.subagentTreeOf('s1', catalogOf({ [CHILD]: { parentId: 's1', running: true } }))
  assert.equal(fromList.rows[0].state, 'running')

  const fromCatalog = internals.subagentTreeOf('s1', {
    list: { byId: { [CHILD]: { id: CHILD, parentId: 's1', running: false } } },
    catalog: { entries: [{ kind: 'child', id: CHILD, mode: 'one-shot', activity: 'running' }] },
  })
  assert.equal(fromCatalog.rows[0].state, 'running', '目录的 activity 也代表在跑（两者取或）')

  const both = internals.subagentTreeOf('s1', {
    list: { byId: { [CHILD]: { id: CHILD, parentId: 's1', running: false }, [child]: { id: child, parentId: 's1', running: true } } },
    catalog: { entries: [] },
  })
  assert.deepEqual(both.rows.map((row) => row.childId), [CHILD, child], '列表顺序（宿主给的血统序）原样保留')
})

test('子代理行模型：结算通知的五个 stopReason 各归各位', () => {
  const state = (text) => {
    const tree = internals.subagentTreeOf('s1', {
      ...catalogOf({ [CHILD]: { parentId: 's1' } }),
      notices: new Map([[CHILD, { summary: text, text: '' }]]),
    })
    return tree.rows[0].state
  }
  assert.equal(state(SETTLE.completed), 'done')
  assert.equal(state(SETTLE.aborted), 'interrupted', '用户自己停的不该说成失败')
  assert.equal(state(SETTLE['max-tokens']), 'failed')
  assert.equal(state(SETTLE.refusal), 'failed')
  assert.equal(state(SETTLE.error), 'failed')
  assert.equal(state('某种新文案'), 'unknown', '认不出来的文本不猜')
  assert.equal(state(''), 'unknown')
})

test('子代理行模型：没有结算通知、也没在跑 → 状态未知（窗口外或目录没水合）', () => {
  const tree = internals.subagentTreeOf('s1', catalogOf({ [CHILD]: { parentId: 's1', running: false } }))
  assert.equal(tree.rows[0].state, 'unknown')
})

test('子代理行模型：树按 parentId 链往下走（子代理还能再派子代理）', () => {
  const grand = '33333333-4444-5555-6666-777777777777'
  const tree = internals.subagentTreeOf('s1', {
    ...catalogOf({
      [CHILD]: { parentId: 's1', title: '一层', running: false },
      [grand]: { parentId: CHILD, title: '二层', running: true },
      s9: { parentId: '别的会话', title: '别人家的', running: true },
    }),
    notices: new Map([[CHILD, { summary: SETTLE.completed, text: '' }]]),
  })
  assert.deepEqual(
    tree.rows.map((row) => [row.childId, row.depth, row.state]),
    [
      [CHILD, 0, 'done'],
      [grand, 1, 'running'],
    ],
    '孙代理在 depth 1，别的会话的子代理不许混进来',
  )
})

test('子代理行模型：目录只给本会话直接子代理，列表给全机的——两层都要（取并集）', () => {
  const onlyCatalog = '44444444-5555-6666-7777-888888888888'
  const tree = internals.subagentTreeOf('s1', {
    list: { byId: { [CHILD]: { id: CHILD, parentId: 's1', running: true } } },
    catalog: { entries: [{ kind: 'child', id: onlyCatalog, mode: 'continuable', label: '目录才知道的' }] },
  })
  assert.deepEqual(tree.rows.map((row) => row.childId), [onlyCatalog, CHILD], '目录里的先列（它在列表里可能还没出现）')
  assert.equal(tree.rows[0].label, '目录才知道的')
  assert.equal(tree.rows[0].mode, 'continuable')
  assert.equal(tree.rows[1].label, CHILD.slice(0, 8), '列表没有标题时用 id 前 8 位兜底')
})

test('子代理行模型：目录诊断行算失败，且不可点（没有子会话可进）', () => {
  const tree = internals.subagentTreeOf('s1', {
    list: { byId: {} },
    catalog: { entries: [{ kind: 'diagnostic', id: 'd1', reason: '子会话记录已损坏' }] },
  })
  assert.equal(tree.rows.length, 1)
  assert.equal(tree.rows[0].kind, 'diagnostic')
  assert.equal(tree.rows[0].state, 'failed')
  assert.equal(tree.rows[0].childId, '', '诊断行没有 childId，按钮要禁用')
  assert.equal(tree.rows[0].label, '子会话记录已损坏')
})

test('子代理行模型：超过上限时截断，total 与列出的行数一致', () => {
  const spec = {}
  for (let index = 0; index < internals.MAX_SUBAGENT_TREE_ROWS + 7; index += 1) {
    spec[`child-${index}`] = { parentId: 's1', running: false }
  }
  const tree = internals.subagentTreeOf('s1', catalogOf(spec))
  assert.equal(tree.rows.length, internals.MAX_SUBAGENT_TREE_ROWS)
  assert.equal(tree.total, internals.MAX_SUBAGENT_TREE_ROWS, '上限就是上限，徽标不虚报')
})

test('子代理行模型：空材料一律给空（没席位的宿主也走这条）', () => {
  assert.deepEqual(internals.subagentTreeOf('s1', {}), { rows: [], total: 0 })
  assert.deepEqual(internals.subagentTreeOf('s1', { list: { byId: {} } }), { rows: [], total: 0 })
})

/* ────────────────────── 6. 子代理下拉（组件） ────────────────────── */

/**
 * 挂一次下拉菜单（每次重新装载 bundle，让 hook 槽位干净）。
 *
 * @param props - 组件 props（`seat` / `notices` 可覆盖）。
 * @param options - `byId`、`entries`、`notices`。
 * @returns `{harness, calls, local, loaded, list, listeners, text}`。
 */
async function mountBar(props = {}, options = {}) {
  const { react, mount } = createProbeReact()
  const loaded = await loadBundle({ react })
  const local = loaded.exports.__internals
  const calls = { opened: [], refreshed: 0, subscribed: 0, unsubscribed: 0 }
  const listeners = []
  const list = {
    byId: options.byId ?? {},
    subagentsByParent: { s1: { entries: options.entries ?? [] } },
    getSnapshot: () => list,
    subscribe: (listener) => {
      listeners.push(listener)
      calls.subscribed += 1
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
        calls.unsubscribed += 1
      }
    },
  }
  const seat = {
    catalog: () => ({ list, catalog: list.subagentsByParent.s1 }),
    subscribeCatalog: (listener) => list.subscribe(listener),
    refreshCatalog: () => {
      calls.refreshed += 1
    },
    openSubagent: (childId) => calls.opened.push(childId),
  }
  const t = (key, params) => {
    const template = local.ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  const harness = mount(local.views.SubagentBar, {
    seat,
    sessionId: 's1',
    t,
    notices: options.notices ?? new Map(),
    ...props,
  })
  harness.render()
  return { harness, calls, local, loaded, list, listeners, text: collectText(harness.value) }
}

test('子代理下拉：没有子代理时一个像素都不占', async () => {
  const { harness } = await mountBar()
  assert.equal(harness.value, null)
  const noSeat = await mountBar({ seat: null }, { byId: { [CHILD]: { parentId: 's1', running: true } } })
  assert.equal(noSeat.harness.value, null, '席位缺席就整块不画')
})

test('子代理下拉：有子代理时出现工具条，徽标给「N 个 / N 个进行中」', async () => {
  const running = await mountBar(
    {},
    {
      byId: {
        [CHILD]: { parentId: 's1', title: '查目录', running: true },
        c2: { parentId: 's1', title: '写文档', running: false },
      },
      notices: new Map([['c2', { summary: SETTLE.completed, text: '' }]]),
    },
  )
  assert.match(running.text, /子代理/)
  assert.match(running.text, /1 个进行中/, '有在跑的就报在跑的数量')
  assert.equal(running.harness.value.props['data-running'], 'true')
  assert.equal(
    collectByAttr(running.harness.value, 'data-dcf-agentmenu', 'true').length,
    0,
    '默认收起：菜单不进 DOM',
  )

  const idle = await mountBar(
    {},
    {
      byId: { [CHILD]: { parentId: 's1', title: '查目录', running: false } },
      notices: new Map([[CHILD, { summary: SETTLE.completed, text: '' }]]),
    },
  )
  assert.match(idle.text, /1 个/)
  assert.equal(idle.harness.value.props['data-running'], 'false')
})

test('子代理下拉：展开列出每一行，右端图标按状态给 glyph（用户点名的三个态）', async () => {
  const byId = {
    [CHILD]: { parentId: 's1', title: '工作中', running: true },
    c2: { parentId: 's1', title: '干完了', running: false },
    c3: { parentId: 's1', title: '挂了', running: false },
  }
  const notices = new Map([
    ['c2', { summary: SETTLE.completed, text: '' }],
    ['c3', { summary: SETTLE.error, text: '' }],
  ])
  const { harness, text, local } = await mountBar({}, { byId, notices })
  collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0].props.onClick()
  harness.render()

  const menu = collectByAttr(harness.value, 'data-dcf-agentmenu', 'true')
  assert.equal(menu.length, 1)
  const rows = collectByAttr(harness.value, 'data-dcf-agentrow', 'true')
  assert.equal(rows.length, 3, '三个子代理三行')
  assert.deepEqual(rows.map((row) => row.props['data-state']), ['running', 'done', 'failed'])
  assert.deepEqual(
    rows.map((row) => collectText(row)),
    [
      `工作中 ${local.SUBAGENT_STATE_GLYPH.running}`,
      `干完了 ${local.SUBAGENT_STATE_GLYPH.done}`,
      `挂了 ${local.SUBAGENT_STATE_GLYPH.failed}`,
    ],
    '行里是子代理的标题，右端跟一个状态图标',
  )
  const glyphs = collectByClass(harness.value, 'dcf-agentstate')
  assert.deepEqual(
    glyphs.map((glyph) => glyph.props.children),
    [local.SUBAGENT_STATE_GLYPH.running, local.SUBAGENT_STATE_GLYPH.done, local.SUBAGENT_STATE_GLYPH.failed],
  )
  assert.deepEqual(
    glyphs.map((glyph) => glyph.props['aria-label']),
    ['工作中', '完成', '失败'],
  )
  assert.match(text, /子代理/)
})

test('子代理下拉：点一行进入那个子代理的对话，并把菜单收起来', async () => {
  const { harness, calls } = await mountBar(
    {},
    { byId: { [CHILD]: { parentId: 's1', title: '查目录', running: true } } },
  )
  collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0].props.onClick()
  harness.render()
  const row = collectByAttr(harness.value, 'data-dcf-agentrow', 'true')[0]
  row.props.onClick()
  assert.deepEqual(calls.opened, [CHILD])
  harness.render()
  assert.equal(collectByAttr(harness.value, 'data-dcf-agentmenu', 'true').length, 0, '点了就收起')
})

test('子代理下拉：展开时拉一次目录，收起不拉（不白打扰宿主）', async () => {
  const { harness, calls } = await mountBar(
    {},
    { byId: { [CHILD]: { parentId: 's1', title: '查目录', running: true } } },
  )
  assert.equal(calls.refreshed, 0, '没展开就不该拉目录')
  const trigger = collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0]
  trigger.props.onClick()
  harness.render()
  assert.equal(calls.refreshed, 1)
  assert.equal(trigger.props['aria-expanded'], false, '第一次点之前是收起的')
  collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0].props.onClick()
  harness.render()
  assert.equal(calls.refreshed, 1, '收起不拉')
})

test('子代理下拉：订阅会话列表拿实时运行态，卸载时退订', async () => {
  const { harness, calls, listeners } = await mountBar(
    {},
    { byId: { [CHILD]: { parentId: 's1', title: '查目录', running: true } } },
  )
  // 探针 React 每次 render 都重跑全部 effect（先清理再重挂），所以订阅次数是「渲染次数」。
  assert.ok(calls.subscribed >= 1, '挂上就要订阅会话列表')
  assert.equal(calls.unsubscribed, calls.subscribed - 1, '上一次渲染的订阅必须被清理掉，不能越挂越多')
  // 宿主推一次变更（子代理跑完了）→ 组件重画，徽标跟着变。
  for (const listener of [...listeners]) listener()
  harness.render()
  assert.match(collectText(harness.value), /1 个进行中/, '实时推来的运行态直接生效')
  const subscribed = calls.subscribed
  harness.unmount()
  assert.equal(calls.unsubscribed, subscribed, '卸载必须退订（否则会话切换后会漏监听）')
})

test('子代理下拉：Esc 与点外都收起（展开才挂全局监听，收起立刻摘掉）', async () => {
  const { harness, loaded } = await mountBar(
    {},
    { byId: { [CHILD]: { parentId: 's1', title: '查目录', running: true } } },
  )
  assert.equal(loaded.documentListenerCount('keydown'), 0, '收起时不该挂全局监听')
  collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0].props.onClick()
  harness.render()
  assert.equal(loaded.documentListenerCount('keydown'), 1)
  assert.equal(loaded.documentListenerCount('mousedown'), 1)

  loaded.fireDocumentEvent('keydown', { key: 'Escape' })
  harness.render()
  assert.equal(collectByAttr(harness.value, 'data-dcf-agentmenu', 'true').length, 0, 'Esc 收起')
  assert.equal(loaded.documentListenerCount('keydown'), 0, '收起时把监听摘掉')

  collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0].props.onClick()
  harness.render()
  loaded.fireDocumentEvent('mousedown', { target: {} })
  harness.render()
  assert.equal(collectByAttr(harness.value, 'data-dcf-agentmenu', 'true').length, 0, '点别处收起')
})

test('子代理下拉：看不到 childId 的条目不可点（诊断行）', async () => {
  const { harness, calls } = await mountBar(
    {},
    { entries: [{ kind: 'diagnostic', id: 'd1', reason: '子会话记录已损坏' }] },
  )
  collectByAttr(harness.value, 'data-dcf-agenttrigger', 'true')[0].props.onClick()
  harness.render()
  const row = collectByAttr(harness.value, 'data-dcf-agentrow', 'true')[0]
  assert.equal(row.props.disabled, true)
  assert.equal(row.props['data-kind'], 'diagnostic')
  row.props.onClick()
  assert.deepEqual(calls.opened, [], '不可点的行绝不调跳转')
})
