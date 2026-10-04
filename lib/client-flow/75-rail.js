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
     * 把「已加载的回合」与 `turnOutline` 投影合并成导轨刻度。
     *
     * 这是核心 `mergeTurnRailItems`（`CHAT:1829-1858`）的同构实现：
     * `turnOutline` 是**全集**（含未加载回合，带 `turn` 与 `seq`），已加载的回合覆盖同名项，
     * 结果按 `turn` 升序。`seq` 是 `turn/start` 事件的 seq，也就是 `loadThrough` 的翻页目标。
     *
     * @param outline - `useProjection('turnOutline')` 的值：`{turn, seq, prompt, response}[]`，或 `undefined`。
     * @param loadedTurns - 本视图自己派生出的回合号数组。
     * @returns `{turn, loaded, seq}[]`，按 turn 升序。
     */
    function mergeRailItems(outline, loadedTurns) {
      const byTurn = new Map()
      if (Array.isArray(outline)) {
        for (const entry of outline) {
          if (entry === null || typeof entry !== 'object') continue
          if (!Number.isSafeInteger(entry.turn) || entry.turn < 0) continue
          if (!Number.isSafeInteger(entry.seq) || entry.seq < 0) continue
          byTurn.set(entry.turn, {
            turn: entry.turn,
            loaded: false,
            seq: entry.seq,
            summary: typeof entry.prompt === 'string' ? entry.prompt : '',
          })
        }
      }
      for (const turn of loadedTurns) {
        const previous = byTurn.get(turn)
        byTurn.set(turn, {
          turn,
          loaded: true,
          seq: previous?.seq ?? null,
          summary: previous?.summary ?? '',
        })
      }
      return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
    }

    /**
     * 右侧刻度条：每个回合一个刻度，点击跳到该回合（一次对话）的开头。
     *
     * 结构与核心的 `TurnNavigator` 同构但**不共用代码**（它没有任何公开导出）：
     * 一个**零高 sticky 槽**钉在滚动视口顶部，里面绝对定位出竖向刻度条。
     * 这样滚动时导轨始终停在视口里，刻度数与内容高度无关（不需要按比例定位）。
     *
     * 刻度分两种：
     * - **已加载**（`data-loaded="true"`）→ 点击直接滚动到该回合；
     * - **未加载**（`data-loaded="false"`，淡显）→ 点击先翻页加载到它，期间该刻度显示加载动画
     *   （`data-busy="true"`），加载完成后自动滚到位。
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
            const busy = item.turn === busyTurn
            const label = t(item.loaded === true ? 'flow.rail.jump' : 'flow.rail.jumpLoad', { turn: item.turn })
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
              h('span', { className: 'dcf-marknum' }, String(item.turn)),
              busy === true ? h('span', { className: 'dcf-spinner' }) : null,
            )
          }),
        ),
      )
    }
