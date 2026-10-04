/**
 * 滚动行为测试：触顶自动加载更早的历史 + 当前位置锚定 + 当前回合跟踪。
 *
 * 这段逻辑全在 effect 与 scroll 回调里，真机上出错的表现是「滚上去不加载」或
 * 「一路把所有历史拉完」。用 hook 探针（`test/helpers/probe-react.mjs`）在 node 里把它拉进单测，
 * 比等到真机上肉眼判断便宜得多。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'
import { createFakeScroller, createProbeReact } from './helpers/probe-react.mjs'

const { react, mount } = createProbeReact()
const { exports } = await loadBundle({ react })
const { useScroller, TOP_LOAD_THRESHOLD_PX, MAX_CATCHUP_PAGES } = exports.__internals

/**
 * 手动驱动的 `requestAnimationFrame`：把回调排队，由测试决定什么时候走一帧。
 *
 * 加载期间的「钉住」是一个逐帧循环，node 环境本来没有 rAF，所以要用它把帧拉进单测。
 *
 * @returns `{step, restore}`。
 */
function installFrames() {
  const queue = new Map()
  let nextId = 1
  const previousFrame = globalThis.requestAnimationFrame
  const previousCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId
    nextId += 1
    queue.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => {
    queue.delete(id)
  }
  return {
    /** 走一帧：只跑这一帧之前排进来的回调（回调自己会再排下一帧）。 */
    step() {
      const pending = [...queue.values()]
      queue.clear()
      for (const callback of pending) callback()
    },
    restore() {
      globalThis.requestAnimationFrame = previousFrame
      globalThis.cancelAnimationFrame = previousCancel
    },
  }
}

/**
 * 挂载探针：跑一次 `useScroller` 并把调用记录收下来。
 *
 * @param options - `turns`、`hasMore`、`loadingOlder`、`loadOlder`。
 * @param scrollerOptions - 假滚动宿主的初始状态。
 * @returns `{harness, fake, calls, through, state}`：`calls` 是 `loadOlder` 的调用记录，
 *   `through` 是 `loadThrough` 收到的 seq 列表（导轨跳转用）。
 */
function probeScroller(options, scrollerOptions = {}) {
  const fake = createFakeScroller(scrollerOptions)
  const rootRef = { current: fake.root }
  const calls = []
  const through = []
  const state = {
    hasMore: options.hasMore ?? true,
    loadingOlder: options.loadingOlder ?? false,
    // 真机上注入层的 `loadOlder` 返回核心的 promise（永不 reject）；单测里的桩返回 undefined，
    // 两条路径都要走得通（`useScroller` 只把它当「可以再算一次」的信号）。
    loadOlder: () => calls.push(fake.scroller.scrollTop),
    loadThrough: (seq) => {
      through.push(seq)
      return Promise.resolve()
    },
    turns: options.turns ?? [1, 2],
    /** 窗口头 seq：加载历史时它会变小，锚定补偿只在「真的前插了」时发生。 */
    firstSeq: options.firstSeq ?? 100,
  }
  const harness = mount(function Probe() {
    return useScroller(rootRef, state)
  })
  return { harness, fake, calls, through, state }
}

test('触顶（进入阈值内）时自动加载更早的历史', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500 })
  assert.equal(calls.length, 0)
  fake.setTop(TOP_LOAD_THRESHOLD_PX)
  fake.fire()
  assert.equal(calls.length, 1, '触顶应该触发一次 loadOlder')
  fake.unmount?.()
})

test('停在顶部不会自己反复触发（否则会把全部历史一次拉完）', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 1)
  // 加载会改变滚动位置并再派发滚动事件；没有闸门时这里会连成一条链。
  fake.setTop(10)
  fake.fire()
  fake.setTop(0)
  fake.fire()
  assert.equal(calls.length, 1, '未离开顶部就不算新的触顶')
})

test('锚点滚出视口再回来可以再次加载（防重复触发的闸门）', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500, anchorBottom: 400, withAnchor: true })
  fake.fire()
  assert.equal(calls.length, 1)
  // 用户往下读：加载锚点被推出视口上方 → 重新武装，但**不**立刻加载。
  fake.setAnchorBottom(-120)
  fake.fire()
  assert.equal(calls.length, 1)
  // 用户再滚回最上面：锚点重新可见 → 加载一次。
  fake.setAnchorBottom(400)
  fake.fire()
  assert.equal(calls.length, 2)
})

test('没有更早的历史时不触发', () => {
  const { fake, calls } = probeScroller({ hasMore: false }, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 0)
})

test('上一次加载还没结束时不重复触发', () => {
  const { fake, calls, state } = probeScroller({ loadingOlder: true }, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 0, '正在加载中不能再发一次')
  state.loadingOlder = false
  fake.setTop(300)
  fake.fire()
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 1, '加载结束后恢复可触发')
})

test('加载更早内容后把阅读位置补偿回去（锚定）', () => {
  const { harness, fake, state } = probeScroller(
    { firstSeq: 100 },
    { scrollTop: 20, nodeRows: [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }] },
  )
  fake.fire()
  // 前插落地：窗口头 seq 变小，并且原有内容被整体往下推 200px。
  fake.setNodeRowTop('n1', 160)
  fake.setNodeRowTop('n2', 500)
  state.firstSeq = 60
  const before = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, before + 200, 'scrollTop 应加上被推下的距离，读者停在原处')
})

test('锚定：窗口头没往前挪时不做补偿（否则每次渲染都会抖）', () => {
  const { harness, fake } = probeScroller(
    { firstSeq: 100 },
    { scrollTop: 20, nodeRows: [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }] },
  )
  fake.fire()
  // 只是重渲染（流式追加、折叠状态变化…）：位置没变 → 不动滚动位置。
  const before = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, before)
  // 就算 firstSeq 变了，只要锚点行没被推动，仍然是零补偿。
  fake.setNodeRowTop('n1', 160)
  const again = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, again)
})

test('锚定：一次加载里的多批前插都持续钉住同一个节点', () => {
  const { harness, fake, state } = probeScroller(
    { firstSeq: 100 },
    { scrollTop: 20, nodeRows: [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }] },
  )
  fake.fire()
  assert.equal(fake.scroller.scrollTop, 20, '触发时不动位置（只记录锚点）')
  state.loadingOlder = true
  // 第一批前插：窗口头 100 → 80，内容整体下移 100。
  fake.setNodeRowTop('n1', 60)
  fake.setNodeRowTop('n2', 400)
  state.firstSeq = 80
  harness.render()
  assert.equal(fake.scroller.scrollTop, 120, '第一批前插后读者仍停在原处')
  // 还在加载中 → 锚点按新位置重新记录；第二批前插（80 → 60，再下移 100）继续补偿。
  fake.setNodeRowTop('n1', 160)
  fake.setNodeRowTop('n2', 500)
  state.firstSeq = 60
  harness.render()
  assert.equal(fake.scroller.scrollTop, 220, '第二批前插也要补偿（同一节点继续钉住）')
  // 加载结束：锚点消费掉，之后再渲染不动滚动位置。
  state.loadingOlder = false
  harness.render()
  fake.setNodeRowTop('n2', 900)
  const settled = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, settled)
})

test('加载期间把页面钉住：前插与用户滚动都会被纠回原位置', () => {
  const frames = installFrames()
  try {
    const { harness, fake, state } = probeScroller(
      { firstSeq: 100 },
      { scrollTop: 20, nodeRows: [{ key: 'n1', top: 40 }, { key: 'n2', top: 300 }] },
    )
    fake.fire()
    state.loadingOlder = true
    harness.render()
    // 用户在加载期间滚了一下：下一帧就被纠回原位（这就是「不允许滚动、固定页面」）。
    fake.setTop(120)
    frames.step()
    assert.equal(fake.scroller.scrollTop, 20, '加载中用户滚动会被立刻纠回')
    // 更早的内容前插进来（内容下移 200）：锚点行位置保持不动。
    fake.setNodeRowTop('n1', 240)
    fake.setNodeRowTop('n2', 500)
    frames.step()
    assert.equal(fake.scroller.scrollTop, 220, '前插的内容被补偿，阅读位置不动')
    // 加载结束 → 解除钉住，滚动权利交还用户。
    state.loadingOlder = false
    harness.render()
    fake.setTop(999)
    frames.step()
    assert.equal(fake.scroller.scrollTop, 999, '加载结束后不再钉住')
  } finally {
    frames.restore()
  }
})

test('没有在加载时不装钉住循环（不能干扰用户滚动）', () => {
  const frames = installFrames()
  try {
    const { fake } = probeScroller({ firstSeq: 100 }, { scrollTop: 20, nodeRows: [{ key: 'n1', top: 40 }] })
    frames.step()
    fake.setTop(400)
    frames.step()
    assert.equal(fake.scroller.scrollTop, 400, '不在加载中 → 一帧都不该改滚动位置')
  } finally {
    frames.restore()
  }
})

test('滚动时跟踪视口顶部所在的回合', () => {
  const { harness, fake } = probeScroller({}, { scrollTop: 500, anchorTops: { 1: -600, 2: 120 } })
  fake.fire()
  harness.render()
  // 阈值内最后一个满足条件的锚点：-600 在阈值内，120 超出 → 当前是第 1 回合。
  assert.equal(harness.value.activeTurn, 1)
  fake.setAnchorTop(2, 20)
  fake.fire()
  harness.render()
  assert.equal(harness.value.activeTurn, 2, '第二个回合进入顶部阈值后应成为当前回合')
})

test('挂载时注册、卸载时移除滚动监听', () => {
  const { harness, fake } = probeScroller({})
  assert.equal(fake.listenerCount(), 1)
  harness.unmount()
  assert.equal(fake.listenerCount(), 0)
})

test('加载锚点在视口内才触发；锚点滚出视口后重新武装', () => {
  // 锚点在视口内（bottom 400 > 宿主 top 0）= 用户滚到了最上面。
  const inside = probeScroller({}, { scrollTop: 10, anchorBottom: 400, withAnchor: true })
  inside.fake.fire()
  assert.equal(inside.calls.length, 1, '锚点可见时触发加载')

  // 锚点在视口上方（bottom -50）= 用户读下面的内容 → 不加载，但重新武装。
  const outside = probeScroller({}, { scrollTop: 10, anchorBottom: -50, withAnchor: true })
  outside.fake.fire()
  assert.equal(outside.calls.length, 0, '锚点不可见时不加载')
  outside.fake.setAnchorBottom(400)
  outside.fake.fire()
  assert.equal(outside.calls.length, 1, '锚点回到视口后加载一次')
})

/* ─────────────────── 补页：加载「成功但没有任何新内容」时继续翻 ─────────────────── */

test('加载成功但窗口没有任何变化时自动补页，一有进展就停手', () => {
  const { harness, fake, calls, state } = probeScroller({}, { scrollTop: 10 })
  fake.fire()
  assert.equal(calls.length, 1, '触顶先发一页')
  // 核心的 `loadOlder()` 会「resolve 了但什么都没加载」（重复页被组装器按 seq 去重、
  // 或注入层是静默 no-op）——窗口头与回合数都没变，所以视图必须继续补页，不能静默卡住。
  harness.render()
  harness.render()
  harness.render()
  assert.equal(calls.length, 4, '每一轮渲染发现「没有进展」就补一页')
  // 这一页终于带来了新内容：窗口头前进 → 立刻停手。
  state.firstSeq = 50
  harness.render()
  assert.equal(calls.length, 4, '有进展就不再补页（不把历史一次拉完）')
})

test('补页有硬预算：一直没进展也不会一路把所有历史拉完', () => {
  const { harness, fake, calls } = probeScroller({}, { scrollTop: 10 })
  fake.fire()
  for (let round = 0; round < 20; round += 1) harness.render()
  assert.equal(calls.length, 1 + MAX_CATCHUP_PAGES, '触顶那一页 + 有限的补页预算，用完就停')
})

test('补页期间用户滚下去读内容 → 立刻让位；回到顶部可以再来一轮', () => {
  const { harness, fake, calls } = probeScroller({}, { scrollTop: 10, anchorBottom: 400, withAnchor: true })
  fake.fire()
  assert.equal(calls.length, 1)
  harness.render()
  assert.equal(calls.length, 2, '没进展就补一页')
  // 用户往下读：加载锚点离开视口 → 补页立刻让位（不在用户没看顶部时偷偷加载）。
  fake.setAnchorBottom(-200)
  harness.render()
  const afterGiveUp = calls.length
  harness.render()
  harness.render()
  assert.equal(calls.length, afterGiveUp, '用户在看下面的内容时不再补页')
  // 用户滚回顶部：算一次新的触顶，重新加载。
  fake.setAnchorBottom(400)
  fake.fire()
  assert.equal(calls.length, afterGiveUp + 1, '回到顶部后可以再来一轮')
})

test('没有更早的历史时补页也一次都不该发', () => {
  const { harness, fake, calls } = probeScroller({ hasMore: false }, { scrollTop: 10 })
  fake.fire()
  for (let round = 0; round < 6; round += 1) harness.render()
  assert.equal(calls.length, 0)
})

/* ─────────────────── 导轨跳转：窗口头未知时也要有界重试 ─────────────────── */

test('点未加载的刻度：窗口头取不到时也会再翻页（不再静默放弃）', async () => {
  // `firstSeq === null`（窗口里一个节点都没有、或首节点没有 anchorSeq）是核心的合法状态：
  // 旧版本在落位里直接跳过「再翻一次」这条路，于是这种会话点刻度毫无反应。
  const { harness, through } = probeScroller({ firstSeq: null }, { scrollTop: 200 })
  harness.value.onJump({ turn: 9, seq: 40, loaded: false })
  assert.deepEqual(through, [40], 'onJump 立刻发一次')
  // 这一发还在飞（promise 未落地）时，落位 effect 必须**只等不重发**。
  harness.render()
  assert.deepEqual(through, [40], '同一次跳转不会并发重复发起')
  // 落地之后窗口头仍然未知 → 落位 effect 再补翻一次（有界重试仍在）。
  await Promise.resolve()
  await Promise.resolve()
  harness.render()
  assert.deepEqual(through, [40, 40], '落地后确认窗口没覆盖目标，再补翻一次')
})

test('跳转翻页后仍找不到那个回合：留一条 warn 线索，不静默当成功', async () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    const { harness } = probeScroller({ firstSeq: null, hasMore: false }, { scrollTop: 200 })
    harness.value.onJump({ turn: 9, seq: 40, loaded: false })
    // 等这一发落地：落位 effect 要等它落地之后才做判定（否则会被「还在飞」挡回去）。
    await Promise.resolve()
    await Promise.resolve()
    harness.render()
  } finally {
    console.warn = original
  }
  assert.equal(warnings.length, 1, '找不到目标回合时必须留痕（真机上没有别的排查渠道）')
  assert.match(String(warnings[0][0]), /跳转回合失败/)
})