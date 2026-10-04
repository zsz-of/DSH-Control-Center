/**
 * 极简 React 探针：让 **hook 级** 行为（useRef / useEffect / useState）能在 node 里被测。
 *
 * 为什么不直接用真实 React：真实 React 的 effect 需要 DOM 与调度器，而这些 hook 的逻辑
 * （触顶自动加载的闸门、位置锚定、当前回合跟踪）恰好全在 effect 与事件回调里——
 * 浏览器里才跑得到，也就意味着真机出问题前完全没有反馈。这里用 60 行替身把那段逻辑拉进单测。
 *
 * 能力与边界（明确写清，避免被误用）：
 * - `mount(Component, props)` 运行一次组件函数，**并按 React 的顺序执行 effect**；
 * - `useRef` 的槽位跨 `render()` 保持（否则 effect 里的 ref 每次都是新的，逻辑测不出来）；
 * - `useState` 的 setter 只写槽位、不触发重渲染；要看到新值就显式再调 `render()`；
 * - `createElement` **不**递归调用函数组件（本探针只服务于「组件返回简单值」的 hook 测试）；
 * - 不实现 deps 比较：每次 `render()` 都会重跑全部 effect（测试用它显式模拟「依赖变化」）。
 *
 * @module test/helpers/probe-react
 */

/**
 * 造一套探针 React。
 *
 * **槽位按 mount 隔离**：每个 `mount()` 有自己的 state/ref 槽位数组，否则同一个测试文件里
 * 第二个用例会复用第一个用例的 `useRef` 对象（`armedRef` 之类的闸门状态被带过来），
 * 测试结果就依赖执行顺序——那比没有测试更糟。
 *
 * @returns `{react, mount}`；把 `react` 传给 `loadBundle({ react })`。
 */
export function createProbeReact() {
  /** 当前正在渲染的 mount 的槽位（同一时刻只有一个）。 */
  let active = null

  /** 类组件基类：探针不实例化类组件，但 bundle 里定义错误边界时会 `extends react.Component`。 */
  class Component {
    constructor(props) {
      this.props = props ?? {}
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...(typeof next === 'function' ? next(this.state, this.props) : next) }
    }
  }

  const react = {
    Component,
    createElement(type, props, ...children) {
      if (type === undefined || type === null) throw new Error('createElement 收到了未定义的组件')
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      const slots = active
      const slot = slots.stateCursor
      slots.stateCursor += 1
      if (!(slot in slots.states)) slots.states[slot] = typeof initial === 'function' ? initial() : initial
      return [
        slots.states[slot],
        (next) => {
          slots.states[slot] = typeof next === 'function' ? next(slots.states[slot]) : next
        },
      ]
    },
    useEffect(effect) {
      active.effects.push(effect)
    },
    useMemo(factory) {
      return factory()
    },
    useCallback(callback) {
      return callback
    },
    useRef(initial) {
      const slots = active
      const slot = slots.refCursor
      slots.refCursor += 1
      if (!(slot in slots.refs)) slots.refs[slot] = { current: initial ?? null }
      return slots.refs[slot]
    },
    memo: (component) => component,
    /**
     * 上下文：探针只支持默认值。
     *
     * bundle 在装载期就会 `react.createContext(...)`（子代理过程面板的席位），所以这里必须有；
     * 但探针的 `createElement` 不递归渲染子树，没有「Provider 内」的概念，真值传播测不出来。
     * 要验证真值传播请用真实 React 的 SSR（`test/client-render-react.test.js`）或组件的显式接缝。
     */
    createContext(defaultValue) {
      const context = { _default: defaultValue }
      context.Provider = (props) => props.children ?? null
      context.Consumer = (props) => props.children(defaultValue)
      return context
    },
    useContext: (context) => (context === undefined || context === null ? null : context._default),
  }

  /**
   * 挂载一个只返回值的探针组件。
   *
   * @param Component - 组件函数（通常只调 hook 并返回值）。
   * @param props - 组件 props。
   * @returns `{render, value, unmount}`：`render()` 重跑组件与 effect，`value` 是最近一次的返回值。
   */
  function mount(Component, props) {
    const slots = { states: [], refs: [], stateCursor: 0, refCursor: 0, effects: [], cleanups: [] }
    const harness = {
      value: undefined,
      /**
       * 重跑组件与全部 effect（模拟重渲染）。
       *
       * **先跑上一轮的清理函数再跑这一轮的 effect**——真实 React 在依赖变化时就是这个顺序，
       * 少了这一步，「依赖变化时应该停掉的循环」（例如加载期间的逐帧钉住）会一直跑下去，
       * 测试就会看到一个早该被取消的帧还在改滚动位置。
       */
      render() {
        active = slots
        slots.stateCursor = 0
        slots.refCursor = 0
        slots.effects = []
        while (slots.cleanups.length > 0) slots.cleanups.pop()()
        harness.value = Component(props)
        const queued = slots.effects
        slots.effects = []
        for (const effect of queued) {
          const cleanup = effect()
          if (typeof cleanup === 'function') slots.cleanups.push(cleanup)
        }
        active = null
        return harness.value
      },
      /** 跑掉本 mount 登记的清理函数（模拟卸载）。 */
      unmount() {
        while (slots.cleanups.length > 0) slots.cleanups.pop()()
      },
    }
    harness.render()
    return harness
  }

  return { react, mount }
}

/**
 * 造一个假的滚动宿主与视图根节点。
 *
 * @param options - `anchors`（回合号 → 距宿主顶部的像素偏移）。
 * @returns `{root, scroller, fire, setTop, setAnchorTop}`。
 */
export function createFakeScroller(options = {}) {
  const listeners = new Map()
  const scroller = {
    scrollTop: options.scrollTop ?? 500,
    scrollHeight: options.scrollHeight ?? 5000,
    clientHeight: options.clientHeight ?? 800,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
    },
    getBoundingClientRect: () => ({ top: 0 }),
  }

  const anchorTops = new Map()
  const turns = options.turns ?? [1, 2]
  for (const turn of turns) anchorTops.set(turn, options.anchorTops?.[turn] ?? -100)
  const anchors = turns.map((turn) => ({
    getAttribute: (name) => (name === 'data-turn-anchor' ? String(turn) : null),
    getBoundingClientRect: () => ({ top: anchorTops.get(turn) ?? 0 }),
  }))

  const loadAnchorTops = { bottom: options.anchorBottom ?? 400 }
  const loadAnchor = { getBoundingClientRect: () => ({ top: loadAnchorTops.bottom, bottom: loadAnchorTops.bottom }) }

  /**
   * 节点行：本视图的每一行（`.dcf-leaf`）都带 `data-chat-anchor-key`，加载历史时的**阅读锚点**
   * 就是按它记录的（核心同款属性）。位置可被 `setNodeRowTop` 改动，用来模拟「前插把内容推下去」。
   *
   * ⚠️ 这些行的视口位置**随滚动变化**（`top - scrollTop`）——真实 DOM 就是这样；
   * 少了这一条，「加载期间把页面钉住」的逻辑在测试里永远算出 0 位移，等于没测。
   * 回合锚点（`[data-turn-anchor]`）刻意保持与滚动无关：`activeTurn` 的用例是按固定坐标写的。
   */
  const nodeTops = new Map()
  for (const row of options.nodeRows ?? [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }]) {
    nodeTops.set(row.key, row.top)
  }
  const nodeRows = [...nodeTops.keys()].map((key) => ({
    getAttribute: (name) => (name === 'data-chat-anchor-key' ? key : null),
    getBoundingClientRect: () => ({ top: (nodeTops.get(key) ?? 0) - scroller.scrollTop }),
  }))

  const root = {
    parentElement: scroller,
    closest: (selector) => (selector === '[data-conversation-scroll]' ? scroller : null),
    querySelectorAll: (selector) => {
      if (selector === '[data-turn-anchor]') return anchors
      if (selector === '[data-chat-anchor-key]') return nodeRows
      return []
    },
    querySelector: (selector) => {
      // 视图里用到两种选择器形态，都要支持：[data-turn-anchor]（第一个锚点）
      // 与 [data-turn-anchor="N"]（按回合号定位）。
      const byValue = /^\[data-turn-anchor="(.+)"\]$/.exec(selector)
      if (byValue !== null) {
        return anchors.find((anchor) => anchor.getAttribute('data-turn-anchor') === byValue[1]) ?? null
      }
      if (selector === '[data-turn-anchor]') return anchors[0] ?? null
      if (selector === '[data-dcf-load-anchor]') return options.withAnchor === false ? null : loadAnchor
      return null
    },
  }

  return {
    root,
    scroller,
    /** 派发一次滚动事件。 */
    fire() {
      for (const handler of listeners.get('scroll') ?? []) handler()
    },
    /** 设置滚动位置。 */
    setTop(value) {
      scroller.scrollTop = value
    },
    /** 改变「加载更早」锚点的视口位置（模拟它滚出/回到视口）。 */
    setAnchorBottom(value) {
      loadAnchorTops.bottom = value
    },
    /** 改变某个回合锚点的视口位置（模拟内容变长）。 */
    setAnchorTop(turn, top) {
      anchorTops.set(turn, top)
    },
    /** 改变某个节点行的视口位置（模拟前插把内容往下推）。 */
    setNodeRowTop(key, top) {
      nodeTops.set(key, top)
    },
    listenerCount: () => listeners.get('scroll')?.size ?? 0,
  }
}
