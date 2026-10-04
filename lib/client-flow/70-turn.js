    /* ──────────────────────────── 计划 / 任务列表快照 / 子任务 ──────────────────────────── */

    /** 状态点在任务行左侧：已完成/进行中用 primitives 的 `StateDot`，未开始用空心圆。 */
    function TaskDot({ status, stalled }) {
      if (status === 'completed') return h(StateDot, { state: 'done', size: 10, className: 'dcf-dot' })
      // ⚠️ `ongoing` 是**会转的**状态点。回合已结束（例如被用户停止）却还挂在 in_progress 上的任务
      // 必须换成静态的警示点，否则界面一直在转，等于告诉用户「还在干活」——那是错的。
      if (status === 'in_progress') {
        return h(StateDot, { state: stalled === true ? 'warning' : 'ongoing', size: 10, className: 'dcf-dot' })
      }
      // 「已停止」：被后续任务列表接管的那一项。用 primitives 的中性静态点（`idle` 没有专属配色，
      // 走 currentColor）——它既不是「还在转」，也不是「出错了」，只是不再运行。
      if (status === 'stopped') return h(StateDot, { state: 'idle', size: 10, className: 'dcf-dot' })
      return h('span', { className: 'dcf-dot dcf-dot-pending' })
    }

    /**
     * 任务行在界面上的**显示状态**。
     *
     * 快照内容永远冻结（用户要求「显示也是显示这时的状态」），但**运行状态不能冻结**：
     * 后续列表一出现，旧列表里那一项就不再是「进行中」了——它已经被接管。
     * 不这么做的话，一个回合从头到尾**第一步那一版**都挂着会转的进度圈
     * （用户报告过「老的任务列表都在第一步，都有进度圈在转」）。
     *
     * @param segment - 分段视图模型（认 `superseded`）。
     * @param status - 该快照里冻结的状态。
     * @returns `stopped`（被接管），否则原样返回。
     */
    function displayStatusOf(segment, status) {
      return segment.superseded === true && status === 'in_progress' ? 'stopped' : status
    }

    /**
     * 把毫秒格式化成「x分x秒」（有小时才加小时位）。
     *
     * **分位始终显示**：用户要求计时「从 0 分 0 秒开始」，所以刚开跑的任务显示 `0分3秒`
     * 而不是 `3秒`——位数固定，读数时不会跳。
     */
    function formatDuration(ms, t) {
      const total = Math.max(0, Math.round(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const parts = []
      if (hours > 0) parts.push(t('flow.duration.hour', { count: hours }))
      parts.push(t('flow.duration.minute', { count: minutes }))
      parts.push(t('flow.duration.second', { count: seconds }))
      return parts.join('')
    }

    /** 任务状态的本地化文字。 */
    function statusText(t, status) {
      if (status === 'completed') return t('flow.status.completed')
      if (status === 'in_progress') return t('flow.status.in_progress')
      if (status === 'stopped') return t('flow.status.stopped')
      return t('flow.status.pending')
    }

    /**
     * 任务列表**快照面板**：每一次 `todo_write` 的冻结状态各成一块（背景板）。
     *
     * 这是用户当轮要求的核心语义：「不能全局调用，只有有更新任务列表，就要存储一次这时的状态，
     * 之后显示也是显示这时的状态」。所以这里渲染的是**该分段自己的那份快照**，
     * 而不是「当前最新列表」——否则对话里每处列表都长一样，历史进度就没有意义了。
     *
     * **默认展开规则**（三条用户要求合起来）：
     * - **只有最后一块（当前那一版）默认展开**（用户要求「如果一个任务列表出现后列表被更新了，
     *   那么老的任务列表就应该自动折叠」）：旧版是历史，展开只是占地方；
     * - 当前这一版里，**整张表全部已完成时也默认收起**（用户要求「当任务列表更新为『全部已完成』
     *   状态时，不需要展开」）——这时候没有「进度」可看；
     * - 用户手动点过就以用户的选择为准（`useCollapse` 只在显式切换时写 localStorage）。
     *
     * ⚠️ 表内**运行状态跟着最新的列表走**：被接管的旧版里「进行中」那一项显示成「已停止」、
     * 点也不再转（见 {@link displayStatusOf}）——冻结的是**内容**，不是「还在不在跑」。
     *
     * @param props - `segment`、`t`、`sessionId`、`unfinished`。
     * @returns 快照面板。
     */
    function SnapshotPlate({ segment, t, sessionId, unfinished }) {
      /** 这一版是不是「当前那一版」（后面还有更新的列表就被接管了）。 */
      const current = segment.superseded !== true
      /** 整张表是否都已完成（空表不算），据此决定默认展开还是默认收起。 */
      const allDone = segment.todos.length > 0 && segment.completedCount === segment.todos.length
      const [open, toggle] = useCollapse(sessionId, `plate:${segment.key}`, current && allDone !== true)
      /**
       * 面板正文：**只写「哪些已完成」**（用户要求），不再写「本次变化（X ✓ · Y ▶）」那种对比说明。
       * 逐项列表本身带着状态点与状态徽标，所以这一行只是把「这一版里已经完成的部分」点名出来。
       */
      const done = segment.todos.filter((todo) => todo.status === 'completed').map((todo) => todo.content)
      const body = []
      if (done.length > 0) {
        body.push(h('div', { key: 'done', className: 'dcf-change' }, t('flow.tasksDone', { text: done.join(' · ') })))
      }
      for (const todo of segment.todos) {
        // 显示状态：被接管的旧版里那一项不再是「进行中」，而是「已停止」。
        const status = displayStatusOf(segment, todo.status)
        body.push(
          h(
            'div',
            { key: `item:${todo.content}`, className: 'dcf-taskrow', 'data-status': status },
            h(TaskDot, { status, stalled: current && unfinished === true }),
            h('span', { className: 'dcf-tasktitle' }, todo.content),
            h('span', { className: 'dcf-badge' }, statusText(t, status)),
          ),
        )
      }
      return h(
        'div',
        { className: 'dcf-plate' },
        h(
          'button',
          { type: 'button', className: 'dcf-platehead', 'aria-expanded': open === true, onClick: toggle },
          h(Chevron, { open }),
          h('span', { className: 'dcf-platetitle' }, t('flow.tasks')),
          h('span', { className: 'dcf-badge' }, t('flow.tasksUpdate', { index: segment.index + 1 })),
          h(
            'span',
            { className: 'dcf-count' },
            t('flow.tasksSummary', { total: segment.todos.length, done: segment.completedCount }),
          ),
        ),
        h(Fold, { open, className: 'dcf-platebody' }, body),
      )
    }

    /**
     * 一个分段里的「子任务」折叠体：这一版列表当时正在进行的那一项。
     *
     * 这就是「完成一个任务后需要 agent 写明下一个任务，然后才显示下一个节点」的落点：
     * 下一个任务节点属于**下一个分段**，而下一个分段由那次 `todo_write` 开启。
     * 该任务在这一版快照里必然是 `in_progress`（快照是冻结的），所以状态点显示「进行中」，
     * 「已完成」会在下一块快照面板里出现。
     *
     * **默认展开只给「此刻正在做的那一项」**（`segment.isCurrentTask`，见 `buildTurnGroup`），
     * 且必须**这个回合还在跑**：任务一旦完成或回合结束，它就自动折叠（用户要求
     * 「当一个任务或一个节点完成后自动折叠」）。更早分段的折叠体没有理由继续摊开；
     * 唯一例外是「回合结束但没做完」——那时保持展开，让用户一眼看到它停在哪一步。
     *
     * ⚠️ **被后续列表接管的旧分段一律不展开**（`segment.superseded`）：即使那一项在后续列表里
     * 仍然是 `in_progress`（同一次任务跨了多版列表），展开的也应该是**最新那一版**——
     * 否则同一个任务会同时摊开好几个折叠体（用户报告过「从头至尾老的任务列表都在第一步」）。
     *
     * @param props - `segment`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`subagents`、`seat`。
     * @returns 子任务折叠体；该分段没有进行中的任务时返回 `null`。
     */
    function TaskFold({ segment, t, sessionId, labels, live, unfinished, subagents, seat, liveKey }) {
      const current = segment.superseded !== true
      const [open, toggle] = useCollapse(
        sessionId,
        `task:${segment.key}`,
        current && segment.isCurrentTask === true && (live === true || unfinished === true),
      )
      if (segment.activeTask === null) return null
      /** 被接管的旧分段里，这一项也显示成「已停止」（内容冻结，运行状态跟最新列表走）。 */
      const status = displayStatusOf(segment, 'in_progress')
      return h(
        'div',
        { className: 'dcf-task' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-taskrow',
            'data-status': status,
            'aria-expanded': open === true,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h(TaskDot, { status, stalled: current && unfinished === true }),
          h('span', { className: 'dcf-tasktitle' }, segment.activeTask),
          h('span', { className: 'dcf-badge' }, t('flow.ops', { count: segment.stats.listed })),
        ),
        h(
          Fold,
          { open },
          h(NodeSequence, {
            nodes: segment.nodes,
            blockKey: `proc:${segment.key}`,
            t,
            sessionId,
            labels,
            // 「思考中」按「这一块里有没有回合的最后一个节点」判定（见 NodeSequence 的 blockActive）：
            // 这一项写完了就立刻变成「思考已完成」，而不是整回合一直挂着「思考中」。
            active: live,
            liveKey,
            unfinished,
            subagents: subagents,
            seat,
          }),
        ),
      )
    }

    /**
     * 一个回合 = 一次用户输入产生的任务流（「任务处理流」这一层）。
     *
     * 层级（用户当轮要求）：**任务处理流 > 子任务 > 小处理过程 = 子 agent 操作**。
     * - 任务处理流 = 本组件（回合）；
     * - 子任务 = {@link TaskFold}（由某次列表更新点名的那一项）；
     * - 小处理过程 = {@link ThinkingBlock}（思考中 / 思考完成），子 agent 卡片与它同级。
     *
     * 有计划：用户发言 → 规划过程 → 逐段（列表快照 + 子任务）→ 收尾。
     * 没计划：用户发言 → 按操作序列折叠（`looseNodes`）。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`、`seat`、`now`。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels, live, seat, now }) {
      // 「任务过程」：**进行中默认展开，并且此时不允许关闭**（用户要求「任务过程中默认展开，
      // 任务完成了以后才允许关闭这个节点」）；任务结束后默认收起，用户可以自由开合（选择被记住）。
      // 回合结束但没做完的任务、以及「正在做的那一项」仍然在折叠体里，靠头上的「被打断」标记提示。
      /**
       * 任务过程头上的两枚徽标（用户裁决：只有**核心给出的中断证据**才配写「被打断」）：
       * - `cutOff`：`assistant-step` 被标 `interrupted`，或工具块错误码属于 `INTERRUPT_CODES`；
       * - `unfinished`：回合结束了，但最后一个任务列表里还留着「进行中」——这是**很常见**的事
       *   （清单本来就只写了一半、模型没回头改），所以只给中性文案，不再冒充「被打断」。
       */
      const cutOff = group.cutOff === true && live !== true
      const unfinished = group.unfinished === true && live !== true
      // 折叠状态键用 `group.key`（同一回合里可能因为插队消息而有多个分组，见 deriveFlow）。
      const [storedStageOpen, toggleStage] = useCollapse(sessionId, `stage:${group.key}`, false)
      const stageOpen = live === true ? true : storedStageOpen
      /**
       * 任务耗时：**正在跑的回合实时计时**（`now` 由视图每秒刷新一次，见 `useTick`），
       * 已经结束的回合用派生层算好的固定值。从 0 分 0 秒开始往上走。
       */
      const liveMs =
        live === true && typeof group.startedAt === 'number' && typeof now === 'number'
          ? Math.max(0, now - group.startedAt)
          : null
      const durationMs = liveMs === null ? group.durationMs : liveMs
      const durationText =
        durationMs === null ? '' : t('flow.stage.duration', { text: formatDuration(durationMs, t) })
      const statsText = describeStats(group.stats, t)
      const stageSummary = [durationText, statsText].filter((part) => part !== '').join(' · ')
      /** 用户发言走原生座位；这里只算一次它自己的回退模型。 */
      const inputRow = useMemo(
        () => (group.input === undefined ? null : nodeRowOf(group.input, group.subagents)),
        [group],
      )

      const children = []
      if (group.input !== undefined) {
        // 用户说的话永远在最外层（`NativeNodeRow` 直接在回合块里，不进任何折叠体）。
        // 插队消息额外挂一个「插队」标记：同一个回合里出现第二个气泡时，读者要知道它是怎么来的。
        children.push(
          h(NativeNodeRow, {
            key: 'ask',
            node: group.input,
            row: inputRow,
            seat,
            t,
            sessionId,
            labels,
            marker: group.inputKind === 'steering' ? t('flow.steering') : null,
          }),
        )
      }

      // ---- 折进「任务过程」的部分：动手之前的规划段 + 每段的任务列表快照 + 子任务 + 过程明细 ----
      const stage = []
      if (group.planned && group.planNodes.length > 0) {
        /**
         * 「规划过程」不再单独成折叠体（用户要求「移除掉规划过程，全部算任务过程里面」）：
         * 首个 `todo_write` 之前的那一段（想过什么、说过什么）**排在任务过程的最前面**，
         * 与快照面板、子任务、过程明细同一个折叠体。
         *
         * ⚠️ 这里**不传 `mode`/`summary`**：规划段在定义上早于任何分段，永远不可能是本回合的收尾汇报，
         * 若跟着 `summary` 逻辑跳过最后一段正文，那一段就会从界面上彻底消失。
         */
        stage.push(
          h(NodeSequence, {
            key: 'plan-sequence',
            nodes: group.planNodes,
            blockKey: `proc:plan:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            liveKey: group.liveKey,
            subagents: group.subagents,
            seat,
          }),
        )
      }
      if (group.planned) {
        for (const segment of group.segments) {
          stage.push(
            h(SnapshotPlate, {
              key: `plate:${segment.key}`,
              segment,
              t,
              sessionId,
              unfinished,
            }),
          )
          stage.push(
            h(TaskFold, {
              key: `task:${segment.key}`,
              segment,
              t,
              sessionId,
              labels,
              live,
              unfinished,
              subagents: group.subagents,
              seat,
              liveKey: group.liveKey,
            }),
          )
          if (segment.activeTask === null && segment.nodes.length > 0) {
            // 这一段已经没有「进行中」的任务了，`TaskFold` 不渲染；它自己的过程与正文都放在这里。
            // 用默认 mode（两份都渲染）：正文如果只走 process 那一份就会被丢掉。
            stage.push(
              h(NodeSequence, {
                key: `seq:${segment.key}`,
                nodes: segment.nodes,
                blockKey: `proc:${segment.key}`,
                t,
                sessionId,
                labels,
                active: live,
                liveKey: group.liveKey,
                subagents: group.subagents,
                seat,
              }),
            )
          }
        }
      }
      /**
       * 模型是否**显式声明过**「总结从这里开始」（本回合调过 `chat_flow_summary`）。
       *
       * 声明过就不再猜：标记之后的内容就是总结，整段交给最外层渲染，一条也不留在
       * 「任务过程」里；没声明则沿用启发式（最后一段正文才是汇报），老会话照旧。
       */
      const marked = group.summaryMarked === true
      /**
       * 「任务过程」那一半要画的尾巴。
       *
       * - 声明过分界：过程只剩标记**之前**的散节点（有任务列表的回合里就是空数组），
       *   总结整段在下面单独画 —— 两边绝不重叠（同一批节点里外各画一份是明令禁止的）；
       * - 没声明：没有任务列表的回合用散节点，有任务列表的回合用 `closing`（旧行为）。
       */
      const tailNodes = marked || !group.planned ? group.looseNodes : group.closing
      /**
       * 任务是否已经结束。
       *
       * 它是「过程里穿插的正文放哪儿」的开关（用户要求）：任务结束时，**最后一段正文**才是
       * 「任务结束时对用户的汇报」，留在最外层；其余（包括跑动中穿插写的那些正文）全部收进任务过程。
       */
      const closed = group.closed === true
      stage.push(
        h(NodeSequence, {
          key: 'stage-process',
          nodes: tailNodes,
          blockKey: `proc:${group.planned ? 'closing' : 'loose'}:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
          liveKey: group.liveKey,
          subagents: group.subagents,
          mode: 'inside',
          // 声明过分界时**不用** run 下标分流（那一手会把过程尾巴的最后一段正文藏起来）。
          summary: marked ? false : closed,
          seat,
        }),
      )
      children.push(
        h(DisclosureLine, {
          key: 'stage',
          open: stageOpen,
          onToggle: toggleStage,
          // 跑动中**不允许关闭**：`locked` 让折叠头退化成静态行（点不动），完成后恢复成按钮。
          locked: live === true,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.stage'),
          summary: stageSummary,
          trailing: cutOff
            ? h(StatusChip, { key: 'cut', tone: 'warn', text: t('flow.status.cutOff') })
            : unfinished
              ? h(StatusChip, { key: 'stale', tone: 'muted', text: t('flow.status.unfinished') })
              : null,
        }, stage),
      )

      // ---- 留在最外面的部分：**总结**（任务没结束且模型没声明分界时什么都不放外面）----
      // 声明过分界时**立刻**拿出来（不等回合结束）：那正是模型说「接下来的话是给你的总结」的时刻，
      // 留到回合结束再拿出去，总结正文会在流式期间凭空消失几秒。
      if (closed || marked) {
        children.push(
          h(NodeSequence, {
            key: 'stage-summary',
            // 声明过分界：画 `closing` 的**全部**节点（总结里可能夹着交付工具调用或多段正文）；
            // 没声明：还是旧口径 —— `tailNodes` 里只画最后那一段连续正文。
            nodes: marked ? group.closing : tailNodes,
            blockKey: `summary:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            liveKey: group.liveKey,
            subagents: group.subagents,
            // `undefined` 即「不传 mode」：两种 run 都画（见 `60-process.js` 的分流闸门）。
            mode: marked ? undefined : 'summary',
            seat,
          }),
        )
      }

      // ---- 收尾节点固定排在**总结之后**（用户要求）：复制 / 点赞 / 点踩 /「在新对话中分支」在它里面。
      // 它们不进任何折叠体（`NodeSequence` 里也会把它们剔除），所以这里单独渲染一次。
      for (const node of group.footerNodes ?? []) {
        children.push(
          h(NativeNodeRow, {
            key: `footer:${node.key}`,
            node,
            row: null,
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }

      return h(
        'div',
        { className: 'dcf-turn', 'data-turn': String(group.turn), 'data-turn-anchor': String(group.turn) },
        children,
      )
    }