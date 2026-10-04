    /* ──────────────────────────── 右侧回合导轨 ──────────────────────────── */

    /**
     * 把导轨滚到最底部（当前回合就在最后一格）。
     *
     * 导轨自己是个可滚容器（刻度多了要溢出），但它不跟阅读视口联动：**默认停在顶部**，
     * 于是高亮在最后几格时用户什么也看不见。所以挂载与刻度数变化时主动滚到底。
     * 只在这一刻滚，之后用户手动滚动不被抢（阅读时导轨跟着视口跳会很烦）。
     *
     * @param rail - `.dcf-rail` 元素（滚动容器）。
     */
    function scrollRailToBottom(rail) {
      if (rail === null || rail === undefined) return
      rail.scrollTop = rail.scrollHeight
    }

    /**
     * 「更早的回合」刻度的哨兵值：数字回合号不可能等于它，所以不会与真实刻度混淆。
     *
     * 它没有回合号也没有 `seq`——「窗口外还有多少轮、下一轮的 seq 是多少」只有平台的
     * `turnOutline` 投影知道，而投影值来自落盘缓存，本视图不再读它（见 {@link railItemsOf}）。
     */
    const OLDER_TICK = 'older'

    /**
     * 把**当前对话里已加载的回合**算成导轨刻度。
     *
     * ⚠️ 以前这里是「`turnOutline` 投影 ∪ 已加载回合」。投影值来自会话投影缓存
     * （`~/.dsh/storages/session_projcache`，落盘），而用户要求任务视图「实时根据对话来，
     * 保证所有信息都是最新的」——所以现在只认本视图自己从对话里派生出来的回合：
     * 你看到的每一格，都必然对应此刻真的在视图里的那一段对话。
     *
     * 代价是**未加载回合没有回合号**（那是只有投影才知道的信息），于是全部退化成一格
     * {@link OLDER_TICK}：「还有更早的历史，点一下加载」。翻页仍走 `useScroller` 的
     * `requestLoadOlder`（与列表顶部那个「加载更早」按钮完全同一条记账路径）。
     *
     * @param loadedTurns - 本视图已加载的回合号（升序、去重）。
     * @param hasMore - 会话是否还有更早的回合（`useSession` 的 `hasMore`）。
     * @returns `{turn, loaded, seq}[]`：`OLDER_TICK` 在最前，其余按 turn 升序。
     */
    function railItemsOf(loadedTurns, hasMore) {
      const items = []
      if (hasMore === true) items.push({ turn: OLDER_TICK, loaded: false, seq: null })
      for (const turn of Array.isArray(loadedTurns) ? loadedTurns : []) {
        if (!Number.isSafeInteger(turn) || turn < 0) continue
        items.push({ turn, loaded: true, seq: null })
      }
      return items
    }

    /**
     * 右侧刻度条：每个回合一个刻度，点击跳到该回合（一次对话）的开头。
     *
     * 结构与核心的 `TurnNavigator` 同构但**不共用代码**（它没有任何公开导出）：
     * 一个**零高 sticky 槽**钉在滚动视口顶部，里面绝对定位出竖向刻度条。
     * 这样滚动时导轨始终停在视口里，刻度数与内容高度无关（不需要按比例定位）。
     *
     * 刻度分两种：
     * - **已加载回合**（`data-loaded="true"`）→ 点击直接滚动到该回合；
     * - **「更早的回合」**（`data-loaded="false"`，读数显示 `…`）→ 只在窗口外还有历史时出现这一格，
     *   点击走一次普通翻页（`requestLoadOlder`），期间该刻度显示加载动画（`data-busy="true"`）。
     *
     * 刻度里写**回合号数字**（用户要求：不要光秃秃的横线，刻度要能读出「这是第几轮」）：
     * 用户说的「第 N 轮」与这里的数字是同一个数，所以点击/无障碍文案都不用换算。
     * 加载中（`data-busy`）时数字让位给转圈——那一格正在等翻页，读数没有意义。
     *
     * 只有一个刻度时也渲染（它可能是唯一的一个未加载刻度）。没有可跳目标时返回 `null`。
     *
     * @param props - `items`、`activeTurn`、`liveTurn`、`busyTurn`、`onJump`、`t`。
     * @returns 导轨。
     */
    function TurnRail({ items, activeTurn, liveTurn, busyTurn, onJump, t }) {
      const railRef = useRef(null)
      const count = Array.isArray(items) ? items.length : 0

      // 挂载与刻度数变化时滚到底：默认高亮是最后一轮，滚在顶部就看不见它。
      useEffect(() => {
        scrollRailToBottom(railRef.current)
      }, [count])

      if (!Array.isArray(items) || items.length === 0) return null
      // 只有一个刻度且它已加载 = 没有可跳的目标（也没有更早的历史），不渲染。
      if (items.length < 2 && items.every((item) => item.loaded === true)) return null
      return h(
        'div',
        { className: 'dcf-rail-slot' },
        h(
          'div',
          { className: 'dcf-rail', ref: railRef, role: 'navigation', 'aria-label': t('flow.rail') },
          ...items.map((item) => {
            // 「更早的回合」那一格没有回合号，读数用省略号；其余格照旧显示第几轮。
            const older = item.turn === OLDER_TICK
            const busy = item.turn === busyTurn
            const label = older ? t('flow.rail.older') : t('flow.rail.jump', { turn: item.turn })
            return h(
              'button',
              {
                key: String(item.turn),
                type: 'button',
                className: 'dcf-mark',
                'data-loaded': item.loaded === true ? 'true' : 'false',
                'data-busy': busy === true ? 'true' : 'false',
                'data-active': item.turn === activeTurn ? 'true' : 'false',
                'data-live': item.turn === liveTurn ? 'true' : 'false',
                'aria-busy': busy === true ? 'true' : undefined,
                'aria-current': item.turn === activeTurn ? 'true' : undefined,
                title: label,
                'aria-label': label,
                onClick: () => {
                  if (typeof onJump === 'function') onJump(item)
                },
              },
              h('span', { className: 'dcf-marknum' }, older ? '…' : String(item.turn)),
              busy === true ? h('span', { className: 'dcf-spinner' }) : null,
            )
          }),
        ),
      )
    }
