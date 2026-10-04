    /* ──────────────────────────── 「思考中 / 思考完成」块 ──────────────────────────── */

    /**
     * 把统计分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定。
     * 每一项都是**完整句子**（用户要求「思考 x 次 执行 y 条命令 读取 w 个文件 编辑 z 个文件
     * 这种说法」），所以计数作为参数传进模板，而不是在句子后面再挂一个裸数字——
     * 中文的量词是跟着名词走的，拼接会拼出「执行 5 命令」这种半截话。
     * **计数为 0 的类别完全不显示**（用户明确要求）；全部为 0 时退化成「N 个操作」或「无操作」。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @param t - locale 座位。
     * @returns 折叠态那一行统计文本。
     */
    function describeStats(stats, t) {
      const { segments, listed } = statsSummary(stats)
      if (segments.length === 0) return listed > 0 ? t('flow.ops', { count: listed }) : t('flow.noOps')
      return segments.map((segment) => t(CATEGORY_LOCALE_KEYS[segment.category], { count: segment.count })).join(' · ')
    }

    /**
     * 「思考中 / 思考完成」块：一段处理过程的折叠容器。
     *
     * - 标题随状态切换：还在跑 = **思考中**（带浮动光效），跑完 = **思考完成**，被停掉 = **未完成**；
     * - 折叠时只显示非零的统计项（思考 x 次 / 执行 y 条命令 / 读取 w 个文件 / 编辑 z 个文件 /
     *   调用 k 个 MCP 工具 / 提问 v 次，0 值不显示）；
     * - 默认展开条件 = 这段过程所属的任务/回合正在进行；结束后自动收起；
     * - **容器是插槽的，内容是核心的**：行内每一行都走原生座位（命令卡、工具卡、思考行…），
     *   多次上下文注入合并进同一个折叠点（{@link ContextFold}）。
     *
     * @param props - `blockKey`、`nodes`、`models`、`stats`、`t`、`sessionId`、`active`、`cutOff`、`labels`、`seat`。
     * @returns 折叠块。
     */
    function ThinkingBlock({ blockKey, nodes, models, stats, t, sessionId, active, cutOff, labels, seat }) {
      // **默认永远收起**（懒加载：收起时正文不进 DOM——本块是唯一传 `lazy: true` 的折叠体，
      // 因为它的明细最多且每条都要经原生座位走一遍核心渲染；展开时正文按需重建）。
      // 折叠头一行给出状态（思考中 / 思考已完成 / 思考被打断）与统计，需要看过程时点开。
      const [open, toggle] = useCollapse(sessionId, blockKey, false)
      const rows = useMemo(() => groupProcessNodes(nodes), [nodes])
      const body = []
      for (const row of rows) {
        if (row.kind === 'contexts') {
          body.push(
            h(ContextFold, {
              key: `ctx:${row.nodes[0].key}`,
              nodes: row.nodes,
              models,
              t,
              sessionId,
              seat,
              labels,
            }),
          )
          continue
        }
        body.push(
          h(NativeNodeRow, {
            key: row.node.key,
            node: row.node,
            row: models.get(row.node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }
      /**
       * 标题只看**这一块自己**有没有被中断（`cutOff`）。
       *
       * ⚠️ 不能把「回合还没收尾」（`unfinished`）当成被打断：回合级的标志里含着
       * 「后台子 agent 已派出但报告未到」这类正常情况，一挂上去就变成**每一块都写「被打断」**
       * （用户报告过）。回合级的标志只用在「任务过程」折叠头的警示 chip 上。
       */
      const title =
        active === true
          ? t('flow.thinking.live')
          : cutOff === true
            ? t('flow.thinking.cutOff')
            : t('flow.thinking.done')
      return h(
        'div',
        { className: 'dcf-thinking', 'data-live': active === true ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-row dcf-thinkinghead',
            'aria-expanded': open === true,
            // 折叠键写进 DOM：本块是全插件**唯一**懒加载的折叠体，收起时正文根本不在树里，
            // 「这一块的键是什么」就成了排查与测试都绕不开的信息（同时也是 localStorage 里的键）。
            'data-fold-key': blockKey,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h('span', { className: 'dcf-thinkingtitle', 'data-shimmer': active === true ? 'true' : 'false' }, title),
          // 折叠点后面不加数字（用户要求）：统计本身就说明了这一段做了什么。
          h('span', { className: 'dcf-summary' }, describeStats(stats, t)),
        ),
        h(Fold, { open, className: 'dcf-body', lazy: true }, body),
      )
    }

    /**
     * 渲染一段节点：按「过程 run / 正文 run」交替排列。
     *
     * **为什么按 run 切**（用户要求）：一段过程里一旦出现对用户可见的正文，
     * 前面的思考块就**封口**（结束），后面的动作属于**下一个**思考块——
     * 于是「思考中」不再是一整段任务的巨大容器，而是「一次思考 → 一段输出 → 再思考」的节奏。
     *
     * `mode` 决定渲染哪一半（两份互斥，同一节点不会被画两次）：
     * - `inside`（默认）：画进「任务过程」的那一份。`summary === true` 时**跳过最后一段正文**
     *   （那一段要留在最外层当汇报）；
     * - `summary`：只画**最后一段正文**（任务结束时对用户的汇报）。
     *
     * 用户当轮要求「思考过程中穿插的对用户输出的内容应该合并到任务过程的节点里面去，
     * 而不应该显示在最外层的层级」：所以跑动中（`summary` 不为真、外面也不画）过程中写的正文
     * 全都在任务过程里；只有任务结束后的那一段留在最外层。
     *
     * **收尾节点（`turn-tail`）在这里被剔除**：它的位置由回合层固定在「总结之后」单独渲染
     * （见 `isFooterNode`），任何折叠体都不该把它卷进去——否则复制/点赞/点踩/分支按钮会
     * 跑到「任务过程」里面去（用户报告过）。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`、`liveKey`、`subagents`、`mode`、`summary`、`seat`。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active, liveKey, subagents, mode, summary, seat }) {
      // 最外层节点（用户发言 / 插队 / 收尾控件）由回合层渲染：这里剔除它们；run 也会在它们处断开。
      const seatNodes = useMemo(() => seatNodesOf(nodes).filter((node) => !isTopLevelNode(node)), [nodes])
      const runs = useMemo(() => nodeRunsOf(seatNodes), [seatNodes])
      // 回退模型只在这里算一次：正文行与过程块共用这份 Map，避免重复解析工具块。
      const models = useMemo(() => rowModelsOf(seatNodes, subagents), [seatNodes, subagents])
      const summaryIndex = lastInlineRunIndex(runs)
      const children = []
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index]
        if (mode === 'summary' ? index !== summaryIndex : summary === true && index === summaryIndex) continue
        if (run.kind === 'process') {
          // 整块都渲染成空的过程（见 {@link isBlankNode}）不画：画出来只有一个「无操作」的折叠头，
          // 看起来就像一个凭空的思考块（用户报告过最前面那块残留）。
          if (run.nodes.every(isBlankNode)) continue
          const first = run.nodes[0]
          /**
           * 这一块**正在写**吗？判据是「回合在跑 **且** 本块包含回合的最后一个可渲染节点」。
           * 只判回合会让同一回合里早已写完的块一直显示「思考中」（用户报告过）；
           * 只判节点又会让回合结束后的最后一块永远停在「思考中」。
           */
          const blockActive =
            active === true &&
            liveKey !== null &&
            liveKey !== undefined &&
            run.nodes.some((node) => node.key === liveKey)
          children.push(
            h(ThinkingBlock, {
              // 每个 run 一块：key 与折叠状态键都用该 run 的第一个节点（稳定且唯一）。
              key: `run:${first.key}`,
              blockKey: `${blockKey}:${first.key}`,
              nodes: run.nodes,
              models,
              stats: statsOfNodes(run.nodes, subagents),
              t,
              sessionId,
              active: blockActive,
              cutOff: cutOffOf(run.nodes),
              labels,
              seat,
            }),
          )
          continue
        }
        for (const node of run.nodes) {
          children.push(
            h(NativeNodeRow, {
              key: node.key,
              node,
              row: models.get(node.key),
              seat,
              t,
              sessionId,
              labels,
            }),
          )
        }
      }
      if (children.length === 0) return null
      return h('div', { className: 'dcf-block' }, children)
    }
