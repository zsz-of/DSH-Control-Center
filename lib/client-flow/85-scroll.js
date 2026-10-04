    /* ──────────────────────────── 滚动行为 ──────────────────────────── */

    /** 距顶部多少像素以内算「触顶」。留一点余量，滚轮惯性到不了 0 也能触发。 */
    const TOP_LOAD_THRESHOLD_PX = 64

    /**
     * 距底部多少像素以内算「还在底部」。
     *
     * 超过它才需要「快速回到底部」按钮：几百像素的余量让「差一点点到底」不弹按钮，
     * 免得正常阅读时按钮一直闪。
     */
    const BOTTOM_THRESHOLD_PX = 300

    /**
     * 视口离开底部了吗（够不够格显示「快速回到底部」按钮）。
     *
     * 单独成函数是为了能直接测：按钮本身的显隐要靠真实的 scroll 事件，
     * 而滚动事件在 node 侧没有 DOM 就没有，判据却可以逐条断言。
     *
     * @param scroller - 滚动宿主（只看 `scrollTop` / `scrollHeight` / `clientHeight`）。
     */
    function isAwayFromBottom(scroller) {
      if (scroller === null || scroller === undefined) return false
      return scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - BOTTOM_THRESHOLD_PX
    }

    /**
     * 平滑滚到最底部。
     *
     * 「快速回到底部」按钮与「任务结束后自动跟到底」共用这一处：
     * 两处各写一遍 `scrollTo` 的话，改行为（比如换成 `auto`）必然会漏掉一处。
     *
     * @param scroller - 滚动宿主；为 `null` 时什么都不做（滚动宿主还没绑上去）。
     */
    function scrollViewToBottom(scroller) {
      if (scroller === null || scroller === undefined) return
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }

    /** 行相对滚动宿主的位置：与页面整体滚动无关（核心 `flowTop` 同义，`CHAT:1895-1897`）。 */
    function flowTopOf(row, scroller) {
      return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }

    /** 按节点 key 找已渲染的行（核心 `anchorElement` 同义，`CHAT:1867-1870`）。 */
    function anchorRowOf(root, key) {
      if (key === null || key === '') return null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        if (row.getAttribute('data-chat-anchor-key') === key) return row
      }
      return null
    }

    /**
     * 选一个稳定的锚点行：**视口顶部往下第一个可见节点行**（找不到就退化成第一行）。
     *
     * 为什么锚在「节点行」而不是「回合块」：加载历史时回合块会被整段重排，而节点行带
     * `data-chat-anchor-key`（核心同款属性），前插之后仍然唯一存在，才能把阅读位置钉回去。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns `{key, top}`，或没有任何节点行时 `null`。
     */
    function visibleAnchorOf(root, scroller) {
      const hostTop = scroller.getBoundingClientRect().top
      let first = null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null || key === '') continue
        const top = flowTopOf(row, scroller)
        if (first === null) first = { key, top }
        if (row.getBoundingClientRect().top - hostTop >= 0) return { key, top }
      }
      return first
    }

    /**
     * 恢复阅读位置时最多重试多少帧。
     *
     * 视图切回来时节点是**异步**进树的：第一帧里 `scrollHeight` 往往还只有一屏，
     * 这时把 `scrollTop` 写成 30000 会被浏览器夹回 0——表现出来就是「切回来跳到已加载部分的顶部」。
     * 恢复必须逐帧重试，直到锚点行真的出现；90 帧 ≈ 1.5 秒，超过就当放弃（不再和用户抢滚动条）。
     */
    const SCROLL_RESTORE_MAX_FRAMES = 90

    /**
     * 一次触顶最多**连续补几页**。
     *
     * 核心的 `loadOlder()` 可能「成功 resolve，但什么都没加载」——真机上表现为
     * 「加载之后没有任何新内容」。三种成因（详见下面补页 effect 的注释）：请求赶在窗口安装完成前发出
     * 而拿回一页重复记录、会话绑定已释放导致注入层是静默 no-op、远端失败被核心吞掉。
     * 所以每次触顶给一笔补页预算：只要这次加载**既没让窗口头前进、也没多出回合**，就再补一页；
     * 预算用完就停并保持闸门未武装（等用户离开顶部再回来，或点按钮）。
     * 预算是硬的，所以不会退化成「一路把所有历史拉完」。
     */
    const MAX_CATCHUP_PAGES = 5

    /** 刻度跳转最多再翻几次（窗口头未知时也允许重试，避免「点了刻度毫无反应」）。 */
    const MAX_JUMP_REPAGES = 3

    /** 分页期间「钉住页面」的帧数上限（≈10 秒）：加载卡住时不能把页面永久冻住。 */
    const SCROLL_PIN_MAX_FRAMES = 600

    /** 文档当前是否可见。没有 `document`（node 侧渲染）时按「可见」处理。 */
    function isDocumentVisible() {
      if (typeof document === 'undefined' || document === null) return true
      return document.visibilityState !== 'hidden'
    }

    /** 下一帧；没有 `requestAnimationFrame` 就退化成 16ms 定时器，都没有就不再重试。 */
    function nextFrame(fn) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(fn)
        return
      }
      if (typeof setTimeout === 'function') setTimeout(fn, 16)
    }

    /**
     * 记下「现在读到哪儿」。
     *
     * ⚠️ 只记像素位置不够：切回来时窗口可能已经重新分页（更早的历史被前插进来），
     * 同一个 `scrollTop` 会落在完全不同的内容上。所以位置**锚在视口顶部那一行节点**上：
     * 记「哪一行 + 它相对视口顶的偏移」，恢复时按这一行重新算像素。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns `{atBottom, top, key, offset}`；根或宿主不在时 `null`。
     */
    function readScrollState(root, scroller) {
      if (root === null || root === undefined) return null
      if (scroller === null || scroller === undefined) return null
      const state = {
        atBottom: !isAwayFromBottom(scroller),
        top: Math.round(scroller.scrollTop),
        key: null,
        offset: 0,
      }
      const anchor = visibleAnchorOf(root, scroller)
      if (anchor !== null) {
        state.key = anchor.key
        state.offset = Math.round(anchor.top)
      }
      return state
    }

    /**
     * 把阅读位置钉回去，返回**是否已经钉住**。
     *
     * `false` 说明目标行还没进树，调用方下一帧再试（见 {@link SCROLL_RESTORE_MAX_FRAMES}）；
     * 一旦返回 `true` 就不要再调——否则会把用户这期间的手动滚动又拽回去。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @param state - {@link readScrollState} 的结果（或 {@link decodeScrollState} 解析出来的同形对象）。
     */
    function applyScrollState(root, scroller, state) {
      if (state === null || state === undefined) return true
      if (scroller === null || scroller === undefined) return true
      if (state.atBottom === true) {
        scroller.scrollTop = scroller.scrollHeight
        // 内容还没铺满一屏时「到底」是无意义的（被夹在 0），下一帧再看。
        return scroller.scrollHeight > scroller.clientHeight
      }
      const row = state.key === null || state.key === undefined ? null : anchorRowOf(root, state.key)
      if (row !== null) {
        scroller.scrollTop += flowTopOf(row, scroller) - state.offset
        return true
      }
      // 锚点行不在了（窗口整个换了一批）→ 退化成「按像素还原」，至少不比原来差。
      if (typeof state.top === 'number' && Number.isFinite(state.top) && state.top > 0) {
        scroller.scrollTop = state.top
        return true
      }
      return false
    }

    /** 逐帧重试直到钉住（内容异步进树，一帧往往不够）。 */
    function restoreScrollState(root, scroller, state) {
      let frames = 0
      const step = () => {
        if (applyScrollState(root, scroller, state) === true) return
        frames += 1
        if (frames >= SCROLL_RESTORE_MAX_FRAMES) return
        nextFrame(step)
      }
      step()
    }

    /** `{atBottom, top, key, offset}` → 存储字符串。 */
    function encodeScrollState(state) {
      if (state === null || state === undefined) return null
      return JSON.stringify(state)
    }

    /**
     * 存储字符串 → `{atBottom, top, key, offset}`。
     *
     * 兼容旧值：以前存的是**一个数字**（`String(scroller.scrollTop)`），
     * 按 `{top}` 处理，不能让升级前的记录直接作废。
     */
    function decodeScrollState(raw) {
      if (typeof raw !== 'string' || raw === '') return null
      const legacy = Number(raw)
      if (Number.isFinite(legacy)) return { atBottom: false, top: legacy, key: null, offset: 0 }
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      if (parsed === null || typeof parsed !== 'object') return null
      return {
        atBottom: parsed.atBottom === true,
        top: typeof parsed.top === 'number' && Number.isFinite(parsed.top) ? parsed.top : 0,
        key: typeof parsed.key === 'string' && parsed.key !== '' ? parsed.key : null,
        offset: typeof parsed.offset === 'number' && Number.isFinite(parsed.offset) ? parsed.offset : 0,
      }
    }

    /** 「贴到底」的位置状态（任务在离开期间结束时用它）。 */
    function bottomScrollState() {
      return { atBottom: true, top: 0, key: null, offset: 0 }
    }

    /**
     * 加载锚点（「加载更早的历史」按钮或加载提示）是不是还在视口里。
     *
     * 闸门用它而不是裸的 `scrollTop` 阈值：用户看到的就是最上面那个按钮——它露在视口里
     * 说明用户还在最顶上；它被推出视口上方，说明用户已经在读下面的内容，
     * 从这里开始算「离开顶部」，再滚回来才算一次新的触顶。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns 锚点在视口内（或没有锚点时按像素阈值判断）为 `true`。
     */
    function isLoadAnchorVisible(root, scroller) {
      const anchor = root.querySelector('[data-dcf-load-anchor]')
      if (anchor === null) return scroller.scrollTop <= TOP_LOAD_THRESHOLD_PX
      return anchor.getBoundingClientRect().bottom >= scroller.getBoundingClientRect().top
    }

    /**
     * 绑定真实的滚动宿主，负责两件事：**触顶自动加载更早的历史**、**跟踪当前回合**。
     *
     * 几个必须说明的取舍：
     * 1. **滚动宿主是 shell 的，不是本视图的**。核心把会话体包在 `[data-conversation-scroll]`
     *    里（`ui-conversation` 的 scrollBody），所以这里用 `closest()` 向上找它，
     *    而不是自己再套一个滚动容器——套两层会出现嵌套滚动条。
     * 2. **防重复触发用「先离开顶部」的闸门**（`armedRef`），而不是时间冷却。
     *    加载后修正滚动位置本身会引起一次 scroll 事件，没有闸门就会自己触发自己，
     *    一路把所有历史拉完。闸门语义：只有「曾经滚到阈值以下、又回到顶部」才算一次新的触顶。
     * 3. **位置锚定**：加载更早的内容会把旧内容往下推。这里记住第一个回合元素的视口位置，
     *    内容变长后把差值补回 `scrollTop`，读者眼睛停在原处。
     *    如果浏览器原生 scroll anchoring 已经处理了，差值≈0，这一步就是空操作——两者不冲突。
     * 4. 度量放在 rAF 里做（一次滚动只量一帧），因为读 `getBoundingClientRect` 会强制布局。
     *
     * @param rootRef - 本视图根节点的 ref（滚动宿主由它向上找）。
     * @param options - `turns`（回合号数组）、`hasMore`、`loadingOlder`、`loadOlder`、`firstSeq`。
     * @returns `{activeTurn, busyTurn, onJump}`：当前视口顶部所在回合、正在加载的刻度、刻度点击。
     */
    function useScroller(rootRef, options) {
      const {
        turns = [],
        hasMore,
        loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
        /**
         * 初始激活的回合号（由外层指定，如「rail 默认滚到底部」）。
         * 有值时：初始 `activeTurn` 直接用它；首次 measure 跳过（避免把顶部回合误设为激活）。
         */
        initialActiveTurn = null,
        /**
         * 当前会话 id。
         *
         * **换会话时必须把滚动记账全部复位**：这个 hook 的实例会被外层复用（见 `80-view.js` 的
         * 注释），而窗口头、锚点行、补页预算都是**上一个会话**的事实。不复位的话，新会话刚打开
         * 就可能拿着旧会话的进度去 `loadOlder`，或者按旧锚点把 `scrollTop` 拽到别处（F2）。
         * 不传时按 `null` 处理（单测里就是这种桩），退化成「永不复位」的旧行为。
         */
        sessionId = null,
      } = options
      const [activeTurn, setActiveTurn] = useState(initialActiveTurn)
      const [busyTurn, setBusyTurn] = useState(null)
      const [pendingJump, setPendingJump] = useState(null)
      const [settleTick, setSettleTick] = useState(0)
      /** 已用过 initialActiveTurn → 后续全走 measure。 */
      const usedInitialRef = useRef(initialActiveTurn !== null)
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)
      /** 上一个窗口头 seq：只有它变小（真的前插了）才做锚定补偿（核心同款，`CHAT:2227`）。 */
      const firstSeqRef = useRef(null)
      /** 防死循环：同一个窗口头只允许再翻一次（核心的 `jumpRepageHeadRef` 同款）。 */
      const repagedRef = useRef(null)
      /** 上一个 `loadingOlder`：用来在它落回 false 时补一次落位尝试。 */
      const wasPagingRef = useRef(options.loadingOlder === true)
      /** 本次触顶还剩几页补页预算（> 0 时才允许继续补页）。 */
      const catchupRef = useRef(0)
      /** 触发这次加载时的基线（窗口头 seq + 已加载回合数）：没进展就一直补页。 */
      const progressRef = useRef(null)
      /** 刻度跳转在同一个窗口头上已经补翻过几次。 */
      const repageAttemptsRef = useRef(0)
      /**
       * 加载落地后强制算一次「有没有进展」。
       *
       * 不能只靠渲染驱动：注入层的 `loadOlder` 可能是**静默 no-op**（会话绑定已释放），
       * 那条路径上不会引起任何 props 变化，光等渲染永远等不到——这正是「卡住不动」的形状。
       */
      const [loadTick, setLoadTick] = useState(0)
      /**
       * 正在为一次刻度跳转翻页（还在飞）吗？
       *
       * `onJump` 与落位 effect 都会调 `loadThrough`，而「窗口头已覆盖目标」的判据在 promise
       * 落地前通常还是 false，于是同一次跳转会**连发两次**（F4）。记下「有一发在飞」，
       * 落地（成功、失败或同步抛）后清空，期间落位 effect 只等不重试。
       */
      const jumpFlightRef = useRef(null)
      /** 会话标识：只在它真的变化时才复位记账（首挂载不复位，保持原有首屏行为）。 */
      const sessionKey = options.sessionId ?? null
      const lastSessionRef = useRef(sessionKey)

      /**
       * 发一次加载，并在**它落地之后**重算「有没有进展」。
       *
       * `loadOlder` 的返回值在真机上是 promise（核心的 `loadOlder` 是 async），
       * 但它**永不 reject**，失败也是 resolve——所以这里只把它当作「可以再算一次」的信号，
       * 绝不把「resolve 了」当成「加载成功了」。返回值不是 promise 时立刻算一次（单测里就是这种桩）。
       */
      const startLoad = useCallback((loader) => {
        let result = null
        try {
          result = loader()
        } catch {
          result = null
        }
        const done = () => setLoadTick((tick) => tick + 1)
        if (result !== null && result !== undefined && typeof result.then === 'function') result.then(done, done)
        else done()
      }, [])

      /**
       * 记下「现在读到哪儿」：锚点行 + 它相对滚动口的偏移，外加当时的 `scrollHeight`。
       *
       * `scrollHeight` 是给「锚点行整个被换掉」时兜底用的：那时只能按前插撑高的像素补回去
       * （F5，与 {@link applyScrollState} 的像素兜底同一思路）。
       */
      const recordAnchor = useCallback((root, scroller) => {
        if (root === null || root === undefined || scroller === null || scroller === undefined) {
          anchorRef.current = null
          return
        }
        const anchor = visibleAnchorOf(root, scroller)
        anchorRef.current = anchor === null ? null : { key: anchor.key, top: anchor.top, height: scroller.scrollHeight }
      }, [])

      /**
       * 触顶与手动按钮**共用**的「记账 + 发一次加载」（F3）。
       *
       * 手动按钮必须走这一条：只调用 `loadOlder()` 会绕过锚点/进度/闸门三件记账，
       * 结果是前插不补偿（页面跳）、补页不生效（静默 no-op 不重试）、连点还会并发加载。
       */
      const armLoad = useCallback(
        (root, scroller) => {
          const state = latest.current
          if (state.hasMore !== true || state.loadingOlder === true) return
          if (typeof state.loadOlder !== 'function') return
          recordAnchor(root, scroller)
          progressRef.current = {
            firstSeq: state.firstSeq ?? null,
            turns: Array.isArray(state.turns) ? state.turns.length : 0,
          }
          catchupRef.current = MAX_CATCHUP_PAGES
          armedRef.current = false
          startLoad(state.loadOlder)
        },
        [recordAnchor, startLoad],
      )

      /** 手动「加载更早的历史」按钮的入口：与触顶完全同一条路径（F3）。 */
      const requestLoadOlder = useCallback(() => {
        armLoad(rootRef.current, scrollerRef.current)
      }, [armLoad, rootRef])

      /**
       * 发一次「翻到 seq」，并在它**落地之后**补算一次落位。
       *
       * `loadThrough` 的 promise **永不 reject**（失败也 resolve），但真机上也可能同步抛错；
       * 而它一旦 reject 就是一条无人处理的 unhandled rejection，并且 `settleTick` 永不前进、
       * 刻度永久停在加载态（F1）。这里统一：同步抛 → 记一条 warn；promise → 成功失败都算落地。
       */
      const jumpLoad = useCallback((seq) => {
        const done = () => {
          jumpFlightRef.current = null
          setSettleTick((tick) => tick + 1)
        }
        let result = null
        try {
          result = latest.current.loadThrough(seq)
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[chat-flow] 翻页调用抛错', error)
          done()
          return
        }
        if (result !== null && result !== undefined && typeof result.then === 'function') result.then(done, done)
        else done()
      }, [])

      /**
       * 换会话：把所有滚动记账复位（F2/F6）。
       *
       * 这个 effect 必须声明在下面那些消费记账的 effect **之前**——同一个提交里 effect 按声明顺序跑，
       * 复位先跑，后面的补页/落位才不会拿着上一个会话的进度做决定。
       * 首挂载不动（`lastSessionRef` 挡住），以免改变原有首屏行为。
       */
      useEffect(() => {
        if (lastSessionRef.current === sessionKey) return
        lastSessionRef.current = sessionKey
        armedRef.current = true
        anchorRef.current = null
        firstSeqRef.current = null
        repagedRef.current = null
        repageAttemptsRef.current = 0
        wasPagingRef.current = latest.current.loadingOlder === true
        catchupRef.current = 0
        progressRef.current = null
        jumpFlightRef.current = null
        // 换会话后要重新量一次：不要留着上一个会话的激活刻度（F6）。
        usedInitialRef.current = true
        setActiveTurn(latest.current.initialActiveTurn ?? null)
        setBusyTurn(null)
        setPendingJump(null)
      }, [sessionKey])

      useEffect(() => {
        const root = rootRef.current
        if (root === null || root === undefined || typeof root.closest !== 'function') return undefined
        const scroller = root.closest('[data-conversation-scroll]') ?? root.parentElement ?? root
        scrollerRef.current = scroller
        let frame = 0

        const measure = () => {
          frame = 0
          const anchors = root.querySelectorAll('[data-turn-anchor]')
          if (anchors.length === 0) return
          const hostTop = scroller.getBoundingClientRect().top
          let current = Number(anchors[0].getAttribute('data-turn-anchor'))
          for (const anchor of anchors) {
            if (anchor.getBoundingClientRect().top - hostTop > TOP_LOAD_THRESHOLD_PX) break
            current = Number(anchor.getAttribute('data-turn-anchor'))
          }
          setActiveTurn((previous) => (previous === current ? previous : current))
        }

        const onScroll = () => {
          if (frame === 0 && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(measure)
          else measure()

          // 闸门用「加载锚点（按钮或加载提示）还在不在视口里」判定：
          // 锚点滚出视口（用户在读下面的内容）→ 重新武装；锚点回到视口（用户滚到最上面）
          // → 触发一次加载。这比裸的 scrollTop 阈值更贴近用户看到的东西。
          if (isLoadAnchorVisible(root, scroller) !== true) {
            armedRef.current = true
            return
          }
          if (armedRef.current !== true) return
          // 记账（锚点 + 进度 + 补页预算）与发加载都在 armLoad 里，与手动按钮共用同一条路径（F3）。
          armLoad(root, scroller)
        }

        // 有 initialActiveTurn 时首次不 measure：外层已经把激活回合定死在最后一个（导轨默认滚到底），
        // 这里再量一次会把**顶部的**回合误设成激活。之后再绑定时正常 measure。
        if (usedInitialRef.current === true) measure()
        else usedInitialRef.current = true
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          scroller.removeEventListener('scroll', onScroll)
          scrollerRef.current = null
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }, [rootRef, sessionKey, armLoad])

      /**
       * 前插之后把阅读位置钉回原处（见上文第 3 点）。
       *
       * **触发条件是「窗口头真的往前挪了」**（`firstSeq` 变小），而不是「渲染了一次」：
       * 这正是核心的做法（`CHAT:2227-2231`：`anchorRef !== null && firstSeq < firstSeqRef.current`）。
       * 早期版本一渲染就把锚点消费掉，于是「加载开始」那一刻就把锚点清了，
       * 等内容真正前插进来时已经没有锚点可用——用户看到的就是**加载完页面跳一下**。
       *
       * 一页加载可能包含多页（`loadThrough` 会循环），所以补偿之后如果还在加载中，
       * 就按当前位置重新记一次锚点，让下一批前插继续钉住同一个节点。
       */
      useEffect(() => {
        const firstSeq = options.firstSeq
        const previous = firstSeqRef.current
        const anchor = anchorRef.current
        if (anchor !== null && firstSeq !== null && previous !== null && firstSeq < previous) {
          const root = rootRef.current
          const scroller = scrollerRef.current
          if (root !== null && root !== undefined && scroller !== null) {
            const row = anchorRowOf(root, anchor.key)
            if (row !== null) {
              const delta = flowTopOf(row, scroller) - anchor.top
              if (delta !== 0) scroller.scrollTop += delta
              anchorRef.current =
                options.loadingOlder === true
                  ? { key: anchor.key, top: flowTopOf(row, scroller), height: scroller.scrollHeight }
                  : null
            } else {
              // 锚点行整个被换掉了（一次前插翻过了它）：至少把这次撑高的那部分补回去，
              // 别把读者顶走（F5；{@link applyScrollState} 在同情况下退回像素还原）。
              if (typeof anchor.height === 'number' && Number.isFinite(anchor.height)) {
                const grew = scroller.scrollHeight - anchor.height
                if (grew > 0) scroller.scrollTop += grew
              }
              anchorRef.current = null
            }
          }
        }
        firstSeqRef.current = firstSeq
      }, [rootRef, options.firstSeq, options.loadingOlder])

      /**
       * 分页期间**把页面钉住**（用户要求「加载过程中不要发生跳变，可以不允许滚动操作」）。
       *
       * 做法是每帧把锚点行拉回它被记录时的视口位置：内容前插造成的位移被立刻补掉，
       * 用户在这几帧里的滚动输入也会被同一帧纠回，于是页面在加载期间看起来是**冻住**的；
       * `loadingOlder` 落回 false 时 effect 清理，一切交还用户。
       *
       * 为什么不用 `overflow: hidden` 去锁滚动条：那是 shell 的滚动容器，隐藏溢出会让经典滚动条
       * 消失、内容宽度变化十几个像素，反而制造一次横向跳动；逐帧钉住没有任何布局副作用。
       *
       * 帧数上限（`SCROLL_PIN_MAX_FRAMES`）是安全阀：核心的加载有一次彻底卡住不落回 false 的可能，
       * 那时钉住循环会把页面永久冻住——宁可放弃钉住，也不能让视图变成不能滚动的死页面。
       */
      useEffect(() => {
        if (options.loadingOlder !== true) return undefined
        if (typeof requestAnimationFrame !== 'function') return undefined
        let frame = 0
        let frames = 0
        const pin = () => {
          frames += 1
          if (frames > SCROLL_PIN_MAX_FRAMES) return
          frame = requestAnimationFrame(pin)
          const root = rootRef.current
          const scroller = scrollerRef.current
          const anchor = anchorRef.current
          if (root === null || root === undefined || scroller === null || anchor === null) return
          const row = anchorRowOf(root, anchor.key)
          if (row === null) return
          const delta = flowTopOf(row, scroller) - anchor.top
          if (delta !== 0) scroller.scrollTop += delta
        }
        frame = requestAnimationFrame(pin)
        return () => cancelAnimationFrame(frame)
      }, [rootRef, options.loadingOlder])

      /**
       * **补页**：触顶发出的加载如果没带来任何新内容，就继续补页（预算见 `MAX_CATCHUP_PAGES`）。
       *
       * 为什么必须有这一段——核心的 `loadOlder()` 会「成功 resolve 但什么都没加载」，三种成因：
       * 1. 请求赶在窗口安装完成前发出。核心用 `baseSeq` 当游标，而 `baseSeq` 的推进在
       *    `prependWindow` 里、是**异步**的；于是同一次触顶的第二次请求可能拿回**和上次完全一样的一页**，
       *    组装器按 `event.seq` 去重（`inputs.has(seq)`）后一条 fresh 都没有 → `publication = 'none'`
       *    → **界面上什么都不会出现**。
       * 2. 会话绑定已经被释放（`ctx.sessions.binding()` 取不到）→ 注入层那个 `loadOlder` 是
       *    **静默 no-op**，连 promise 都没有，点了/触顶了都不会有任何变化。
       * 3. 远端失败被核心的 `isRemoteFailure` 分支吞掉（只 `console.error`）。
       *
       * 三种情况的共同表现就是用户报的「加载之后没有任何新内容，加载了一段时间后没有加载出任何内容」，
       * 而且闸门此时已经放下（`armedRef = false`），用户停在最顶上再怎么滚都不会再触发。
       * 这里只看两个渲染事实判断有没有进展：**窗口头 seq 变小**、或**已加载回合数变多**。
       * 预算是硬的，用完就停并保持未武装；用户滚下去读内容（锚点离开视口）时立刻让位并重新武装。
       */
      useEffect(() => {
        if (catchupRef.current <= 0) return
        const state = latest.current
        // 还在加载中：等它落回 false，那时这个 effect 还会再跑一次。
        if (state.loadingOlder === true) return
        const giveUp = (rearm) => {
          catchupRef.current = 0
          progressRef.current = null
          if (rearm === true) armedRef.current = true
        }
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return giveUp(false)
        // 用户已经在读下面的内容：补页让位，等他再滚回顶部（那时算一次新的触顶）。
        if (isLoadAnchorVisible(root, scroller) !== true) return giveUp(true)
        const base = progressRef.current
        const firstSeq = state.firstSeq ?? null
        const turnCount = Array.isArray(state.turns) ? state.turns.length : 0
        if (base === null) return giveUp(false)
        const advancedHead = firstSeq !== null && (base.firstSeq === null || firstSeq < base.firstSeq)
        const grew = turnCount > base.turns
        if (advancedHead === true || grew === true) return giveUp(false)
        if (state.hasMore !== true || typeof state.loadOlder !== 'function') return giveUp(false)
        catchupRef.current -= 1
        startLoad(state.loadOlder)
      }, [rootRef, options.firstSeq, options.turns, options.loadingOlder, loadTick])

      /**
       * 点一个刻度。
       *
       * 已加载 → 直接滚过去；未加载 → 记下目标（`pendingJump`）并把刻度置为加载态，
       * 然后 `loadThrough(seq)` 翻页。**完成判定不靠 promise**（它永不 reject，失败也 resolve），
       * 而靠「目标回合变成了已加载」这个渲染事实（见下面的落位 effect）。
       */
      const onJump = useCallback(
        (item) => {
          if (item === null || typeof item !== 'object') return
          // 「更早的回合」刻度：它没有回合号也没有目标 seq，走与列表顶部按钮同一条普通翻页路径
          // （记账 + 发一次 loadOlder），而不是 loadThrough 定向翻页。
          if (item.turn === OLDER_TICK) {
            requestLoadOlder()
            return
          }
          if (item.loaded === true) {
            jumpToTurn(rootRef.current, item.turn)
            return
          }
          const loadThrough = latest.current.loadThrough
          if (typeof loadThrough !== 'function' || item.seq === null) return
          recordAnchor(rootRef.current, scrollerRef.current)
          repagedRef.current = null
          repageAttemptsRef.current = 0
          setBusyTurn(item.turn)
          setPendingJump({ turn: item.turn, seq: item.seq })
          // 记「这一发在飞」：落位 effect 就不会对同一个目标再发一次（F4）。
          jumpFlightRef.current = item.seq
          jumpLoad(item.seq)
        },
        [jumpLoad, recordAnchor, rootRef, requestLoadOlder],
      )

      // `loadThrough` 在 `loadingOlder` 已被普通加载占用时会**立即 resolve 而不排队**，
      // 所以必须在它落回 false 时再补一次落位尝试（核心用同样的 tick 机制）。
      useEffect(() => {
        const paging = options.loadingOlder === true
        if (wasPagingRef.current === true && paging === false && pendingJump !== null) {
          setSettleTick((tick) => tick + 1)
        }
        wasPagingRef.current = paging
      }, [options.loadingOlder, pendingJump])

      /**
       * 落位：目标回合一渲染出来就滚到它。
       *
       * 三层兜底（顺序与核心一致）：① 目标回合已是已加载且能找到锚点 → 落位收尾；
       * ② 窗口还没覆盖目标 seq → 允许**再翻几次**（同一个窗口头有界重试，防死循环，见 `MAX_JUMP_REPAGES`）；
       * ③ 都失败时退化成「滚到第一个 turn ≥ 目标的回合」，连它都找不到就留一条 warn。
       */
      useEffect(() => {
        if (pendingJump === null) return
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return
        const land = (row) => {
          const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
          if (delta !== 0) scroller.scrollTop += delta
        }
        const settle = () => {
          setPendingJump(null)
          setBusyTurn(null)
        }
        const row = root.querySelector(`[data-turn-anchor="${pendingJump.turn}"]`)
        if (row !== null) {
          land(row)
          settle()
          return
        }
        const state = latest.current
        const head = state.firstSeq
        // 上一发翻页（`onJump` 起的，或本 effect 上一轮起的）还没落地：等它落地后会再跑一遍，
        // 期间绝不重复发起——否则「同一刻度连发两次 loadThrough」（F4）。
        if (jumpFlightRef.current !== null) return
        // 窗口还没覆盖目标 seq（**窗口头未知时也当作没覆盖**）→ 再翻一次。
        // 早期版本这里在 `firstSeq === null` 时直接跳过再翻页这条路，于是「首节点取不到 anchorSeq」
        // 的会话里点导轨刻度会毫无反应（落位失败也没人补），所以改成：有界重试（同一个窗口头最多
        // 再翻 `MAX_JUMP_REPAGES` 次），窗口头未知也照试。次数是硬的，不会退化成死循环。
        const covered = head !== null && head !== undefined && head <= pendingJump.seq
        if (state.hasMore === true && covered !== true && typeof state.loadThrough === 'function') {
          if (state.loadingOlder === true) return
          const attempts = repagedRef.current === head ? repageAttemptsRef.current : 0
          if (attempts < MAX_JUMP_REPAGES) {
            repagedRef.current = head
            repageAttemptsRef.current = attempts + 1
            jumpFlightRef.current = pendingJump.seq
            jumpLoad(pendingJump.seq)
            return
          }
        }
        const rows = root.querySelectorAll('[data-turn-anchor]')
        let landed = false
        for (const candidate of rows) {
          const turn = Number(candidate.getAttribute('data-turn-anchor'))
          if (Number.isSafeInteger(turn) && turn >= pendingJump.turn) {
            land(candidate)
            landed = true
            break
          }
        }
        // 连兜底都没找到：不要静默「当作成功」。真机上这就是「点了刻度没反应」，
        // 留一条 warn 让下次排查有据可查（客户端没有别的留痕渠道）。
        if (landed !== true && typeof console !== 'undefined') {
          console.warn('[chat-flow] 跳转回合失败：翻页后窗口里仍找不到该回合', {
            turn: pendingJump.turn,
            seq: pendingJump.seq,
            firstSeq: head,
            hasMore: state.hasMore,
          })
        }
        settle()
      }, [settleTick, pendingJump, rootRef, jumpLoad])

      return { activeTurn, busyTurn, onJump, requestLoadOlder }
    }
