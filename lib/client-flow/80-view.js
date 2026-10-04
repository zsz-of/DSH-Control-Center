    /* ──────────────────────────── 任务主视图 ──────────────────────────── */

    /** 取整份快照的选择器：引用稳定，避免每次渲染都重新订阅。 */
    function identitySelector(value) {
      return value
    }

    /**
     * 空列表常量。
     *
     * ⚠️ 必须是**同一个引用**：选择器返回新建的 `[]` 会让 `useSyncExternalStore` 每帧都判定
     * 「快照变了」，进而在滚动/流式渲染时反复重渲染甚至自激。
     */
    const EMPTY_LIST = []

    /** `useSessions` 缺席时的替身：同一个渲染位置永远只调一次、返回 undefined，hook 顺序不变。 */
    function noSessions() {
      return undefined
    }

    /**
     * 每秒走一格的实时时钟（只在 `active` 为真时走）。
     *
     * 用途是「任务耗时实时统计」：回合还在跑时显示 `now - startedAt`，从 0 分 0 秒开始往上加；
     * 回合结束后渲染层改用派生层算好的固定耗时，这个定时器随之停掉（effect 的清理函数）。
     *
     * @param active - 是否需要计时。
     * @returns 当前时间戳（毫秒）。
     */
    function useTick(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (active !== true) return undefined
        setNow(Date.now())
        if (typeof setInterval !== 'function') return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /**
     * 原生座位的**主人参数**（owner props）。
     *
     * 这些参数是核心 `ChatNodeSeat` 在 `renderSlot('conversation.chat.node', routedOwner, …)` 时
     * 交给原生叶子的（`dsh-client-ui-chat/lib/client.js:1509-1553`，逐项来源见
     * `docs/references/core-seams.md` §13）。本视图自己画层级，就必须把同样的参数补齐，
     * 否则原生叶子在真机上会因为拿不到 `openFile` / `fileMentions` / `renderMessageImages`
     * 而在事件回调里抛错（点一下文件名、展开一条带附件的消息都会踩到）。
     *
     * 三项刻意留空：
     * - `selectedCallId`：核心用它高亮「详情」侧栏里选中的调用，本视图没有那个侧栏；
     * - `turnProcess`：核心的「过程折叠」控制器，本插件用自己的任务阶段折叠替代它；
     * - `cwd` 取不到时留空，原生叶子按原样使用路径。
     *
     * @param props - 本视图收到的插槽 props。
     * @param sessionId - 本视图所属会话。
     * @returns `{owner, renderSlot}`：`owner` 给原生叶子，`renderSlot` 给原生座位。
     */
    function useNativeSeat(props, sessionId) {
      const { renderSlot, openFile, forkAt, fileMentions, loadImage, openView, useSessions } = props
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : noSessions
      const cwd = useSessionsSafe((state) => (state?.byId === undefined ? undefined : state.byId[sessionId]?.cwd))
      return useMemo(
        () => ({
          renderSlot,
          owner: {
            cwd,
            selectedCallId: undefined,
            turnProcess: undefined,
            /**
             * 核心的实现是 `openView('trajectory', callId)`（`ui-chat:2020-2022`），
             * `openView` 由 `conversation.session` 作为 owner prop 交给视图条目。
             */
            inspectCall: (callId) => {
              if (typeof openView === 'function') openView('trajectory', callId)
            },
            openFile: typeof openFile === 'function' ? openFile : () => Promise.resolve(),
            forkAt: typeof forkAt === 'function' ? forkAt : () => {},
            fileMentions: typeof fileMentions === 'function' ? fileMentions : () => undefined,
            // 与核心同一行语义：把 owner 原样转交消息图片插槽，并补上 loadImage（`ui-chat:2059-2062`）。
            renderMessageImages:
              typeof renderSlot === 'function'
                ? (target) => renderSlot(NATIVE_IMAGES_SLOT, { ...target, loadImage })
                : undefined,
          },
        }),
        [renderSlot, cwd, openView, openFile, forkAt, fileMentions, loadImage],
      )
    }

    /**
     * 跳到某个回合（一次对话）的开头。
     *
     * ⚠️ **必须只滚会话体（`[data-conversation-scroll]`），绝不能用 `scrollIntoView`**
     * （用户报告过：点最后一个刻度会让整个界面连输入框一起上移半屏）。
     *
     * 原因是 shell 的结构与 CSS（`core-seams.md §7.1`）：
     * - 真正的滚动宿主是 `div.scrollBody[data-conversation-scroll]`，它里面**既有视图区也有输入框座位**
     *   （`composerSeat`），输入框靠 `position: sticky; bottom: 0` 钉在容器底部；
     * - `scrollIntoView` 会滚动**所有**可滚动祖先——包括 `overflow: hidden` 的盒子（脚本仍可滚它），
     *   而 shell 在 composer 浮层态正是把 `.viewArea` 设成 `overflow: hidden`。
     *   于是浏览器把外层盒子一起滚了，`sticky` 的参照系随之改变，界面连同输入框整体上移。
     *
     * 核心自己也是这么做的：`landOnRow` 直接算 `el.scrollTop += flowTop(row, el) - 24`（`CHAT:2154-2165`）。
     * 系统开了「减少动态效果」时用瞬时跳转，与 CSS 里的动效收敛保持一致。
     *
     * @param root - 本视图根节点。
     * @param turn - 目标回合号。
     * @returns 无。
     */
    function jumpToTurn(root, turn) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return
      const target = root.querySelector(`[data-turn-anchor="${turn}"]`)
      if (target === null || typeof target.getBoundingClientRect !== 'function') return
      const scroller = scrollerOfView(root)
      if (scroller === null || typeof scroller.scrollTop !== 'number') return
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
      if (delta === 0) return
      const reduced =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      const top = Math.max(0, scroller.scrollTop + delta)
      // `scrollTo` 支持平滑滚动，而且作用域就是这个元素——不会再牵扯外层盒子。
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
        return
      }
      scroller.scrollTop = top
    }

    /**
     * 本视图所在的**会话滚动宿主**：`[data-conversation-scroll]`（shell 的 scrollBody）。
     *
     * 取不到时退化成父元素/自身：这样在测试与非常规装配下也拿得到一个可滚的盒子，
     * 而不是把动作交给 `scrollIntoView` 去滚整个文档。
     *
     * @param root - 本视图根节点。
     * @returns 滚动宿主，或 `null`。
     */
    function scrollerOfView(root) {
      if (root === null || root === undefined) return null
      const found = typeof root.closest === 'function' ? root.closest('[data-conversation-scroll]') : null
      return found ?? root.parentElement ?? root
    }

    /**
     * 任务视图主体（真正调用 hook 的地方）。
     *
     * 数据来源全部是**标准 props**，不读 DOM 取业务数据、不开自有数据通道：
     * - `useChat` 由 ui-chat 通过 `uiSession.provide({hooks:['chat']})` 提供，是整棵对话节点树；
     * - `useSession` 由 ui-session 内置源提供，用来判断 `running` / `hasMore` / `loadingOlder`；
     * - `t` 来自本条目声明的 `locale`；
     * - `loadOlder` 来自本条目自己的 `inject`。
     *
     * 布局分两层：外层是满宽块（承载右侧导轨的 sticky 槽），内层 `.dcf-main` 才是限宽阅读列。
     *
     * @param props - 见上。
     * @returns 任务流 + 右侧回合导轨。
     */
    function FlowBody(props) {
      const { sessionId, useChat, useSession, t, loadOlder, loadThrough } = props
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      /**
       * 子代理结算通知（`subagent-settled`）——「子代理下拉」判 完成/失败/已中断 的唯一权威来源。
       *
       * 视图自己算一遍而不是复用 `deriveFlow` 的产物：派生层把通知按 `consumed` 标记消化进卡片，
       * 下拉菜单要的是**全量**（含已经并进卡片的那些），所以从同一棵节点树重新收敛更直白。
       */
      const agentNotices = useMemo(() => collectSubagentNotices(orderedNodes(snapshot)), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)
      const seat = useNativeSeat(props, sessionId)

      /**
       * 还没进入对话的用户消息（DSH 的「插队发送」/ 排队）。
       *
       * 选择器返回的必须是**稳定引用**（`state.queue` 本身或共享的空数组），否则 uSES 会自激。
       */
      const inbox = useSession((state) => (Array.isArray(state?.queue) ? state.queue : EMPTY_LIST))
      const submissions = useSession((state) =>
        Array.isArray(state?.pendingSubmissions) ? state.pendingSubmissions : EMPTY_LIST,
      )
      const pendingSeats = useMemo(() => pendingSeatsOf(inbox, submissions, snapshot), [inbox, submissions, snapshot])

      const running = session?.running === true
      /** 实时时钟：只有在跑的时候才每秒走一格（结束的回合用派生层算好的固定耗时）。 */
      const now = useTick(running)
      /**
       * 已加载的回合号（去重）。
       *
       * 同一个回合里可能因为**插队消息**而有多个分组（见 `deriveFlow`），导轨只需要一个刻度，
       * 所以这里去重；`liveTurn` 仍然按「最后一个分组」判定，但要用分组的 key 比较
       * （同一个回合里的前几个分组已经结束了，不该跟着一起算「正在跑」）。
       */
      const turns = useMemo(() => [...new Set(flow.turns.map((group) => group.turn))], [flow])
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      const liveGroupKey = running && flow.turns.length > 0 ? flow.turns[flow.turns.length - 1].key : null
      /**
       * 窗口头部的 seq 代理值（核心同款）：取第一条可见节点的 `anchorSeq`。
       * 这不是真正的窗口起点 seq（`Session.baseSeq` 是私有的、不进快照），
       * 所以它只用来判断「目标 seq 是否可能已被窗口覆盖」，落位时还有兜底分支。
       */
      const firstSeq =
        snapshot.order.length === 0 ? null : (snapshot.nodes.get(snapshot.order[0])?.anchorSeq ?? null)

      /**
       * 导轨刻度 = **当前对话里已经加载的回合**（外带一格「还有更早的历史」）。
       *
       * ⚠️ 这里**不再读平台的 `turnOutline` 投影**：投影值来自落盘缓存
       * （`~/.dsh/storages/session_projcache`），而用户要求任务视图「实时根据对话来，
       * 保证所有信息都是最新的」——于是刻度只由本视图从对话里派生出的回合算出来，
       * 不存在「投影还没刷新」的窗口。未加载的历史由 `railItemsOf` 收成一格 `OLDER_TICK`。
       */
      const railItems = useMemo(() => railItemsOf(turns, session?.hasMore === true), [turns, session?.hasMore])

      const { activeTurn, busyTurn, onJump, requestLoadOlder } = useScroller(rootRef, {
        // 换会话要复位滚动记账（否则新会话会拿着旧会话的进度/锚点做决定，见 useScroller 的 F2 说明）。
        sessionId,
        turns,
        hasMore: session?.hasMore,
        loadingOlder: session?.loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
        // 首次挂载时让 rail 默认激活最后一个回合——视觉上「最末位始终是最新轮次」，
        // 与 rail 上 `data-active` 高亮配合，让用户一眼看到当前在最新回合。
        initialActiveTurn: turns.length > 0 ? turns[turns.length - 1] : null,
      })

      /**
       * 滚动位置：**切出去再切回来要回到原处**（用户报告过「切回对话会跳到已加载部分的顶部」）。
       *
       * 成因：DSH 内部切换会话/视图**不会改变 `document.visibilityState`**，而位置原来只挂在
       * `visibilitychange`/`beforeunload` 上——切出去时根本没记过；切回来时本视图是重新挂载的，
       * 而滚动宿主是 shell 的（`scrollTop` 从 0 开始），「已加载部分的顶部」就是这么来的。
       *
       * 现在的规则：
       * - 滚动过程中**持续**记录位置（锚在视口顶部那一行节点上，见 `readScrollState`）；
       * - 切出时任务在跑、切回来它已经结束 → 翻到底看最新输出（`SS_ENDED_AWAY` 记号）；
       * - 其余情况一律恢复切出时的位置（贴底的人自然还是贴底）；
       * - 任务在用户正看着时结束 → 直接翻到底（原有行为）。
       *
       * `visibilitychange`/`beforeunload` 仍然保留：切标签页、最小化、刷新、关页面
       * 都不会卸载组件，那些路径只能靠事件。sessionStorage 按 sessionId 隔离。
       */
      const SS_SCROLL = `dsh-chat-flow.scroll.${sessionId}`
      const SS_ENDED_AWAY = `dsh-chat-flow.ended-away.${sessionId}`

      /**
       * 最后一次量到的阅读位置。
       *
       * ⚠️ 卸载时不能再量：React **先**把 ref 摘掉、再跑 passive effect 的清理，
       * 那时 `rootRef.current` 已经是 `null`，所以只能把滚动过程中持续量到的快照写进存储。
       */
      const lastStateRef = useRef(null)

      /** 最近一次 `running`：离开与卸载都在闭包里处理，只有 ref 读得到当下值。 */
      const runningRef = useRef(running)
      runningRef.current = running

      /** 记住上一个 `running` 值，用来判断「离开期间状态是否变了」。 */
      const prevRunningRef = useRef(running)

      /** 记住视图在「离开」前是否可见（不在可见态时不重复翻）。 */
      const wasVisibleRef = useRef(isDocumentVisible())

      /** 量一次当前位置：更新内存快照 + 写 sessionStorage。 */
      const captureScroll = useCallback(() => {
        const root = rootRef.current
        const state = readScrollState(root, root ? scrollerOfView(root) : null)
        if (state === null) return
        lastStateRef.current = state
        try {
          sessionStorage.setItem(SS_SCROLL, encodeScrollState(state))
        } catch {
          // 隐私模式 / 配额满：位置记不住不影响使用。
        }
      }, [SS_SCROLL])

      /**
       * 挂载（以及**切换会话**）时把位置钉回去。
       *
       * 依赖 `[sessionId]` 而不是 `[]`：DSH 换会话时本视图可能只是换了 props。
       * 清理函数会把**离开的那个会话**的位置写进它自己的键（闭包里的 `sessionId` 还是旧值），
       * 新会话再从新键里读——两个会话互不串味。
       */
      useEffect(() => {
        lastStateRef.current = null
        const root = rootRef.current
        const scroller = root ? scrollerOfView(root) : null
        if (scroller !== null) {
          // 离开期间任务结束了 → 翻到底（这期间的新内容才是用户要看的）。
          const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'
          if (endedAway && runningRef.current === false) {
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
            restoreScrollState(root, scroller, bottomScrollState())
          } else {
            const saved = decodeScrollState(sessionStorage.getItem(SS_SCROLL))
            if (saved !== null) restoreScrollState(root, scroller, saved)
          }
        }
        return () => {
          // 切走 / 卸载：把最后一次量到的位置留给下一次挂载；当时还在跑就留个记号。
          const state = lastStateRef.current
          try {
            if (state !== null) sessionStorage.setItem(SS_SCROLL, encodeScrollState(state))
            if (runningRef.current === true) sessionStorage.setItem(SS_ENDED_AWAY, '1')
          } catch {
            // 同上：存储不可用就当作没有位置记录。
          }
        }
      }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

      // 切标签页 / 关页面不会卸载组件：这两条路径靠事件，动作与上面「离开 + 回来」一致。
      useEffect(() => {
        const handleLeave = () => {
          captureScroll()
          // 视图不可见时任务还在跑 → 留记号，回来时若它已结束就直接翻到底。
          if (isDocumentVisible() === false && runningRef.current === true) {
            try {
              sessionStorage.setItem(SS_ENDED_AWAY, '1')
            } catch {
              // 静默降级。
            }
          }
          wasVisibleRef.current = false
        }

        const handleActivate = () => {
          wasVisibleRef.current = true
          const root = rootRef.current
          const scroller = root ? scrollerOfView(root) : null
          if (scroller === null) return
          const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'
          if (endedAway && runningRef.current === false) {
            // 任务在离开期间结束了 → 翻到底
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
            restoreScrollState(root, scroller, bottomScrollState())
            return
          }
          // 任务还在跑（或在可见时已结束）→ 恢复切出时的位置
          const saved = decodeScrollState(sessionStorage.getItem(SS_SCROLL))
          if (saved !== null) restoreScrollState(root, scroller, saved)
        }

        const handleVisibilityChange = () => {
          if (isDocumentVisible()) handleActivate()
          else handleLeave()
        }

        const handleBeforeUnload = () => {
          handleLeave()
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          window.removeEventListener('beforeunload', handleBeforeUnload)
        }
      }, [sessionId, captureScroll])

      // `running` 从 true 变 false：在可见态下任务结束 → 直接翻到底
      useEffect(() => {
        if (prevRunningRef.current === true && running === false && wasVisibleRef.current === true) {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          if (scroller !== null) {
            scrollViewToBottom(scroller)
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
          }
        }
        prevRunningRef.current = running
      }, [running])

      /**
       * 快速回到底部按钮（`FloatingScrollButton`）。
       *
       * 逻辑：滚动宿主滚动超过 300px 时显示按钮；点击后滚动到最底部。
       * 只在任务进行中显示（结束后不需要快速回底，用户已能看到最新内容）。
       */
      const [showBottomBtn, setShowBottomBtn] = useState(false)

      /**
       * 会话列表快照：用来发现「已经被删掉的会话」。
       *
       * 核心没有会话删除事件，`useSessions` 是唯一可用的接缝（标准 props，官方 standardProps 清单里）。
       * 选择器返回整张快照而不是 `ids` 数组——返回新数组会让 uSES 自激。
       */
      const useSessionsSafe = typeof props.useSessions === 'function' ? props.useSessions : noSessions
      const sessionList = useSessionsSafe((state) => state)

      /**
       * 滚动监听：跟踪是否已远离底部（判据见 `isAwayFromBottom`），并**持续记录阅读位置**。
       *
       * 位置不能只在「离开事件」里记：DSH 内部换会话/换视图不触发 `visibilitychange`，
       * 那样切回来的时候存储里根本什么都没有。用 rAF 节流，一帧最多量一次。
       */
      useEffect(() => {
        const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
        if (scroller === null) return undefined
        let scheduled = false
        const handleScroll = () => {
          setShowBottomBtn(isAwayFromBottom(scroller))
          if (scheduled === true) return
          scheduled = true
          nextFrame(() => {
            scheduled = false
            captureScroll()
          })
        }
        scroller.addEventListener('scroll', handleScroll, { passive: true })
        handleScroll()
        return () => scroller.removeEventListener('scroll', handleScroll)
      }, [running, sessionId, captureScroll])

      /**
       * 会话被删除时，把本插件给那个会话留下的数据一起带走（localStorage 折叠状态 + sessionStorage 滚动记录）。
       *
       * 判据是「存储里有键、会话列表里没这个 id」（`staleSessionIds`），列表为空时不动手
       * （重连重拉会让列表短暂变空，那不是删除）；当前正在看的这个会话永远排除在外，
       * 因为刚建的空会话可能还没进列表。
       *
       * ⚠️ 这不是唯一一道网：`99-tail.js` 里还有一条**插件级**的同类清理，它不依赖本视图挂着
       * （用户可能在原生「对话」视图里删掉会话）。这里多做一件事——把「正在看的会话」也算作活着。
       */
      useEffect(() => {
        const ids = sessionList?.ids
        if (!Array.isArray(ids)) return
        const alive = new Set(ids)
        alive.add(sessionId)
        for (const stale of staleSessionIds(window, alive)) {
          purgeSessionData(stale, window)
          // 进程内折叠表是永不淘汰的缓存，删除会话时也要一起丢（见 30-collapse.js 的说明）。
          forgetCollapse(stale)
        }
      }, [sessionList, sessionId])

      /**
       * 快速回到底部按钮：固定在右下角，圆形箭头图标。
       * 视觉上在 rail 左侧，不遮挡内容。
       */
      const scrollToBottomButton = showBottomBtn && running === true
        ? h(
            'button',
            {
              key: 'scroll-to-bottom',
              type: 'button',
              className: 'dcf-scroll-bottom-btn',
              'aria-label': t('flow.scrollToBottom'),
              title: t('flow.scrollToBottom'),
              onClick: () => {
                const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
                scrollViewToBottom(scroller)
              },
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 16,
                height: 16,
                fill: 'currentColor',
                'aria-hidden': 'true',
              },
              h('path', { d: 'M8 12L2 6h3V2h6v4h3L8 12z' }),
            ),
          )
        : null

      const main = []
      if (session?.hasMore === true || session?.loadingOlder === true) {
        // 加载中显示动画而不是按钮：用户不需要点，滚到顶部就会自动开始加载。
        main.push(
          session.loadingOlder === true
            ? h(
                'div',
                { key: 'loading-older', className: 'dcf-loading', 'data-dcf-load-anchor': 'true' },
                h('span', { className: 'dcf-spinner' }),
                h('span', null, t('flow.loadingLocked')),
              )
            : h(
                'button',
                {
                  key: 'load-older',
                  type: 'button',
                  className: 'dcf-hint',
                  'data-dcf-load-anchor': 'true',
                  onClick: () => {
                    // 走与触顶完全同一条路径（F3）：手动加载同样要记锚点、记进度、清闸门。
                    // 直接调 `loadOlder()` 会绕过这三件记账——前插不补偿、补页不重试、连点并发。
                    requestLoadOlder()
                  },
                },
                t('flow.loadOlder'),
              ),
        )
      }
      if (flow.turns.length === 0) {
        main.push(h('div', { key: 'empty', className: 'dcf-empty' }, t('flow.empty')))
      }
      for (const group of flow.turns) {
        main.push(
          h(TurnGroup, {
            key: group.key,
            group,
            t,
            sessionId,
            labels,
            live: group.key === liveGroupKey,
            seat,
            now,
          }),
        )
      }
      // 还没进入对话的用户消息（插队 / 排队）：它们在节点树里还不存在，必须由视图自己显示，
      // 否则「我明明发了消息」在任务视图里看不到任何反应（核心在对话流末尾渲染同样这两串）。
      for (const pending of pendingSeats) {
        main.push(h(PendingBubble, { key: `pending:${pending.key}`, seat: pending, t }))
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(SubagentBar, { seat: props.agentSeat ?? null, sessionId, t, notices: agentNotices }),
        h(TurnRail, {
          items: railItems,
          activeTurn,
          liveTurn,
          // 「更早的回合」那一格在翻页期间自己转圈：普通翻页没有 busyTurn 目标。
          busyTurn: session?.loadingOlder === true ? OLDER_TICK : busyTurn,
          onJump,
          t,
        }),
        scrollToBottomButton,
        h('div', { className: 'dcf-main' }, main),
      )
    }

    /**
     * 还没进入对话的那条用户消息（插队 / 排队 / 本地回显）。
     *
     * 三种状态各有一句话说明，这是用户要求「处理好插队发送消息的状态」的落点：
     * 消息不会再「发出去就没影了」——它在列表末尾有一个座位，并被明确标成「插队待处理」或「排队中」。
     *
     * `data-pending-steering` 是核心约定（它的待发送座位带这个属性，`CHAT:1224-1237`），
     * 外部的回退插件也按它找待发送座位（`dsh-rewind-plugin/lib/client.js:1114`）。
     *
     * @param props - `seat`（`{kind, key, text}`）、`t`。
     * @returns 待发送气泡行。
     */
    function PendingBubble({ seat, t }) {
      const steering = seat.kind === 'steering'
      return h(
        'div',
        {
          className: 'dcf-leaf dcf-pending',
          'data-pending-steering': steering === true ? 'true' : undefined,
          'data-submission-echo': steering === true ? undefined : 'true',
        },
        h(UserBubble, { text: seat.text, t }),
        h(
          'div',
          { className: 'dcf-pendingstate' },
          h(StatusChip, {
            tone: steering === true ? 'live' : 'muted',
            text: t(steering === true ? 'flow.pending.steering' : 'flow.pending.queued'),
          }),
        ),
      )
    }

    /**
     * 视图层错误边界：本插件自己这一侧的渲染错误**不再让整块视图让位**。
     *
     * 为什么必须有：本条目崩溃会被插槽判定为「让位」（`RENDERER:519-533` 的 abdicate），
     * 结果是整块对话区变成 `data-slot-error` 一直到刷新——用户看到的就是「任务视图莫名变白」。
     * 有了这一层，出错时只把错误摘要画出来（并留 `console.warn` 线索），视图其余部分与标签栏都还在。
     *
     * 注意：它接不住**事件回调与副作用里**抛出的错误（React 边界的固有限制），
     * 所以派生层与渲染层的取值一律写成防御式的。
     */
    class ViewBodyBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }

      static getDerivedStateFromError(error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        console.warn('[chat-flow] 任务视图渲染失败，已降级为错误摘要（不再让整块视图让位）：', error)
      }

      /** 重试：清掉失败态让子树**重新挂载**（上一次失败的子树已经被卸载，重挂就是干净的）。 */
      retry() {
        this.setState({ failed: false, message: '' })
      }

      render() {
        if (this.state.failed !== true) return this.props.children
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        return h(
          'div',
          { className: 'dcf-error', 'data-dcf-error': this.state.message },
          h('div', { className: 'dcf-errortitle' }, t('flow.error.title')),
          h('pre', { className: 'dcf-pre' }, this.state.message),
          h('div', { className: 'dcf-note' }, t('flow.error.hint')),
          // 没有重试按钮时，一次瞬时异常（例如某个原生叶子在 `turnProcess === undefined`
          // 的上一帧抛错）会把整块视图锁死在错误摘要上，只能刷新页面——用户报的「任务视图莫名变白」。
          h(
            'button',
            {
              type: 'button',
              className: 'dcf-hint',
              'data-dcf-error-retry': 'true',
              onClick: () => this.retry(),
            },
            t('flow.error.retry'),
          ),
        )
      }
    }

    /**
     * 任务视图：`conversation.view` 的条目组件。
     *
     * 这一层只做两件事：能力探测（`useChat` 是 ui-chat 提供的，缺了就给空态而不是抛异常）
     * 与**错误边界**（自己的渲染错误降级成错误摘要，别让整块视图让位）。
     *
     * @param props - 插槽 kit + owner props。
     * @returns 任务视图。
     */
    function TaskFlowView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      /**
       * 「子代理显示」开关。
       *
       * 席位在这里**整片**置空：`58-subagent.js` 的消费点是
       * `seatProp !== undefined ? seatProp : useContext(SubagentSeatContext)`，
       * 传 `null` 就是「明确没有席位」——子代理卡全部退化成不显示，但不影响
       * `props.agentSeat` 本身（捕获与注入照旧，这只是显示开关）。
       *
       * 必须在 `ready` 提前返回**之前**调用：hook 顺序不能随分支变化。
       */
      const ui = useUiFlags()
      const agentSeat = ui.subagent ? props.agentSeat ?? null : null
      const ready = typeof props.useChat === 'function' && typeof props.useSession === 'function'
      if (!ready) return h('div', { className: 'dcf-empty' }, t('flow.empty'))
      // 子代理席位（读子会话过程用，见 `58-subagent.js`）在这里注入一次，
      // 深处的子代理卡用 `useContext` 取——不为它逐层改 5 处组件签名。
      // 顺序是「边界在外、席位在内」：边界仍然包住整块视图主体（`TaskFlowView` 的返回值
      // 就是错误边界元素本身，视图层用例锁着这一点），而席位照样罩住所有叶子。
      return h(
        ViewBodyBoundary,
        { t },
        h(SubagentSeatContext.Provider, { value: agentSeat }, h(FlowBody, { ...props, t })),
      )
    }
