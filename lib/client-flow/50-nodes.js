    /* ──────────────────────────── 消息 ──────────────────────────── */

    /** 复制一段文本到剪贴板，并把「已复制」状态显示一小会儿。 */
    function useCopyAction(text) {
      const [copied, setCopied] = useState(false)
      const onCopy = useCallback(() => {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            navigator.clipboard.writeText(text)
          }
        } catch {
          // 剪贴板不可用（非安全上下文等）：静默失败，不打断阅读。
        }
        setCopied(true)
        if (typeof window !== 'undefined') window.setTimeout(() => setCopied(false), 1500)
      }, [text])
      return [copied, onCopy]
    }

    /**
     * 单个文本节点的渲染上限（字符）。
     *
     * 历史里出现过单条正文几十万字符的情况（把整个文件贴进回复、模型一次吐出超长答案）：整段交给
     * `MarkdownText` 或塞进 `<pre>`，浏览器要花几百毫秒到几秒排版、再吃掉几十上百 MB 内存，
     * 面板看起来就像卡死了。这里统一截断，并在下面补一行「已截断」说明——**不静默丢内容**。
     */
    const MAX_RENDER_CHARS = 200000

    /**
     * 截断超长正文。
     *
     * @param value - 原文本（非字符串当成空串）。
     * @param max - 上限（默认 {@link MAX_RENDER_CHARS}）。
     * @returns `{text, truncated, total}`：`total` 只在截断时给出（原始字符数）。
     */
    function clampText(value, max = MAX_RENDER_CHARS) {
      const text = typeof value === 'string' ? value : ''
      if (!(max > 0) || text.length <= max) return { text, truncated: false }
      return { text: text.slice(0, max), truncated: true, total: text.length }
    }

    /**
     * 超长正文的截断说明行（没截断时什么都不画）。
     *
     * @param props - `clamped`（{@link clampText} 的结果）、`t`。
     * @returns 说明行；`t` 缺席时退回裸键（与视图其余部分的降级口径一致）。
     */
    function TruncationNote({ clamped, t }) {
      if (clamped === null || typeof clamped !== 'object' || clamped.truncated !== true) return null
      const translate = typeof t === 'function' ? t : (key) => key
      return h(
        'div',
        { className: 'dcf-note' },
        translate('flow.text.truncated', { shown: clamped.text.length, total: clamped.total }),
      )
    }

    /**
     * 一段等宽正文（`<pre>`）+ 超长时的截断说明。
     *
     * 文件卡的入参/结果、上下文注入、子代理的任务描述都走这里：这些都是**原文照排**的长文本，
     * 也是历史上真正把面板拖卡的那一类。
     *
     * @param props - `text`、`t`。
     * @returns 正文块（内部自带说明行）。
     */
    function ClampedPre({ text, t }) {
      const clamped = clampText(text)
      return h(
        'div',
        { className: 'dcf-ctxpart' },
        h('pre', { className: 'dcf-pre' }, clamped.text),
        h(TruncationNote, { clamped, t }),
      )
    }

    /**
     * 用户消息气泡（字面文本，不做 markdown 解析——与核心的用户气泡语义一致）。
     *
     * 行内内容走 {@link UserText}（平台的 `projectUserText`，`@文件` / `/技能` 是 chip）。
     *
     * ⚠️ **这里必须照着核心的 DOM 约定输出属性**，否则别人的插件挂不上来：
     * 回退插件（`dsh-rewind-plugin`）用一段 DOM 桥，按
     * `[data-chat-flow-kind="user"][data-chat-anchor-key]` 找用户消息座位，
     * 再往座位里的 `[data-actions-reveal]` 容器的**最后一个子元素**里 portal 一个「还原到此处」按钮
     * （它要求那个容器里**已经有一个按钮**，否则整条座位被跳过）。
     * 所以这里给座位打上这两个属性，并在里面放一个真实的「复制」按钮：
     * 既是有用的功能，也是那个容器被认领的前提。
     *
     * @param props - `text`、`nodeKey`（该消息节点的 key，用作锚点）、`kind`（`user` / `steering`）、`t`。
     * @returns 用户消息行。
     */
    function UserBubble({ text, nodeKey, kind, t }) {
      const [copied, onCopy] = useCopyAction(typeof text === 'string' ? text : '')
      if (typeof text !== 'string' || text.trim() === '') return null
      // 复制按钮始终拿**原文**，只有渲染走截断后的文本。
      const clamped = clampText(text)
      const anchors =
        nodeKey === undefined
          ? {}
          : { 'data-chat-flow-kind': kind ?? 'user', 'data-chat-anchor-key': nodeKey }
      return h(
        'div',
        { className: 'dcf-ask', ...anchors },
        h('div', { className: 'dcf-bubble' }, h(UserText, { text: clamped.text })),
        h(TruncationNote, { clamped, t }),
        h(
          'div',
          { className: 'dcf-askactions', 'data-actions-reveal': 'true' },
          h(
            'div',
            { className: 'dcf-askbuttons' },
            h(
              'button',
              { type: 'button', className: 'dcf-mini', title: t('flow.copy'), onClick: onCopy },
              copied ? t('flow.copied') : t('flow.copy'),
            ),
          ),
        ),
      )
    }

    /**
     * 助手正文。
     *
     * 用核心的 `MarkdownText` 而不是自造渲染：它已经处理了不可信输出（丢弃原始 HTML、
     * 失效不安全链接、增量流式高亮），自己写会把这些安全与性能细节一并丢掉。
     *
     * @param props - `text`、`labels`、`t`（只为超长正文的截断说明行，缺席时退回裸键）。
     */
    function AssistantText({ text, labels, t }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      const clamped = clampText(text)
      return h(
        'div',
        { className: 'dcf-text' },
        h(MarkdownText, { text: clamped.text, labels }),
        h(TruncationNote, { clamped, t }),
      )
    }

    /* ──────────────────────────── 基础零件 ──────────────────────────── */

    /** 每个卡片类型对应的行首图标（同一类型用同一个字形，一眼能扫出操作类型）。 */
    const CARD_ICONS = {
      command: 'IconCodeOutline16',
      file: 'IconEditOutline16',
      mcp: 'IconCordisPluginOutline14',
      question: 'IconQuestionOutline14',
      subagent: 'IconAgentPresetOutline16',
      plain: 'IconInspectOutline12',
    }

    /**
     * 取某个卡片类型的图标组件。
     *
     * @param kind - 卡片类型。
     * @returns 图标组件；primitives 里没有该字形时返回 `null`（渲染层留等宽占位）。
     */
    function iconForCard(kind) {
      const icon = primitives[CARD_ICONS[kind] ?? '']
      if (typeof icon === 'function' || (icon !== null && typeof icon === 'object' && icon !== undefined)) return icon
      const fallback = primitives.IconInspectOutline12
      return typeof fallback === 'function' ? fallback : null
    }

    /**
     * 可折叠行左端的箭头：**状态与旋转都挂在包裹容器上**。
     *
     * ⚠️ primitives 的图标组件只接受 `size` / `className` 两个 prop
     * （`({ size = 14, className }) => jsx('svg', {...})`），`data-*` **不会**透传到 `<svg>`。
     * 所以 `data-open` 与旋转都放在外层 `<span class="dcf-chev">` 上，否则 CSS 的
     * `[data-open=true]` 永远匹配不到、箭头永远不转（这是本视图第一个真实缺陷）。
     *
     * @param props - `open`：展开时向右旋转 90°，指向下。
     * @returns 箭头容器。
     */
    function Chevron({ open }) {
      const icon = primitives.IconChevronRightOutline14
      return h(
        'span',
        { className: 'dcf-chev', 'data-open': open === true ? 'true' : 'false' },
        typeof icon === 'function' ? h(icon, {}) : null,
      )
    }

    /**
     * 折叠容器：切换 CSS grid 轨道高度（`0fr ↔ 1fr`）并过渡，可选**懒加载**。
     *
     * 三个设计点：
     * 1. **默认保持挂载**——展开状态归组件自己所有（例如展开的任务里那个展开的「思考中」），
     *    卸载会把它丢掉；核心的 `ChatNodeSeat` 也奉行「稳定 seat、只隐藏不卸载」。所以
     *    `lazy` 默认关闭：收起只改 CSS，子树留在树里。
     * 2. **`lazy` 只给装了重子树的折叠体用**（当前只有「思考中 / 思考完成」块）——它默认收起、
     *    而正文里的每一条明细都要经原生座位 `conversation.chat.node` 走一遍核心渲染，一个长
     *    会话里这就是几百次白跑。这类折叠体在收起时只留**空壳**（`.dcf-fold` + 空白 `.dcf-body`），
     *    展开时才把子树挂上。空壳留在 DOM 里是为了让「展开」那一帧仍有 CSS 过渡可插值
     *    （连容器一起卸载就变成瞬间替换而不是滑开）。
     *    卸载**不会**丢嵌套块的展开状态：状态归 `useCollapse` 所有，存在 localStorage 里，
     *    重新挂载时按同一个键读回来（见 `30-collapse.js`）。
     * 3. **不量高度**——`grid-template-rows` 的过渡由浏览器插值，无需 `useLayoutEffect` +
     *    `scrollHeight`，内容流式增长时也不会抖。收起时再用 `visibility: hidden`（延迟到动画
     *    结束）把子树从 Tab 顺序里摘出去。
     *
     * @param props - `open`、`className`（内层类名，承载 padding/gap）、`children`、`lazy`。
     * @returns 折叠容器；**没有内容**时返回 `null`（不留下无意义的空壳）。
     */
    function Fold({ open, className, children, lazy }) {
      if (children === undefined || children === null) return null
      // 懒加载路径：收起即不渲染子树；其余折叠体照旧「收起只改 CSS」。
      const body = open === true || lazy !== true ? children : null
      return h(
        'div',
        { className: 'dcf-fold', 'data-open': open === true ? 'true' : 'false' },
        h('div', { className: className ?? 'dcf-body' }, body),
      )
    }

    /**
     * 通用折叠行：一行标题 + 摘要 + 右侧徽标，展开体经 {@link Fold}。
     *
     * 交互与核心的工具行一致（点整行切换、`aria-expanded` 可读），因为这是同一个心智模型：
     * 先看一行摘要，需要时再展开看明细。不可展开的行走纯文本行（`div`）而不是 disabled 按钮
     * ——它是一条标签，不是一个失效控件。
     *
     * `locked` 表示「此刻不允许开合」（例如任务还在跑时的「任务过程」）：整行退化成静态行并带
     * `data-locked`，用户点不动它；`open` 与摘要照常显示，所以读者仍然看得到状态。
     *
     * @param props - `open`、`onToggle`、`leading`、`title`、`summary`、`trailing`、`children`、`className`、`locked`。
     * @returns 可折叠行。
     */
    function DisclosureLine({ open, onToggle, leading, title, summary, trailing, children, className, locked }) {
      const interactive = typeof onToggle === 'function' && locked !== true
      const cells = [
        h(Chevron, { open }),
        leading ?? null,
        title === undefined || title === null ? null : h('span', { className: 'dcf-title' }, title),
        summary === undefined || summary === null || summary === ''
          ? null
          : h('span', { className: 'dcf-summary' }, summary),
        trailing ?? null,
      ]
      const row = interactive
        ? h(
            'button',
            { type: 'button', className: 'dcf-row', 'aria-expanded': open === true, onClick: onToggle },
            ...cells,
          )
        : h(
            'div',
            { className: 'dcf-row', 'data-static': 'true', 'data-locked': locked === true ? 'true' : undefined },
            ...cells,
          )
      return h('div', { className: className ?? 'dcf-block' }, row, h(Fold, { open }, children))
    }

    /* ──────────────────────────── 卡片 ──────────────────────────── */

    /** 状态徽标：命令/提问/子 agent 的四态都用它，颜色由 `data-tone` 决定。 */
    function StatusChip({ tone, text }) {
      if (typeof text !== 'string' || text === '') return null
      return h('span', { className: 'dcf-chip', 'data-tone': tone }, text)
    }

    /** 命令卡的状态文案（四态）。 */
    function commandStatusText(t, status) {
      if (status === 'running') return t('flow.status.running')
      if (status === 'failed') return t('flow.status.failed')
      if (status === 'cancelled') return t('flow.status.cancelled')
      return t('flow.status.done')
    }

    /** 状态 → 色调（复用同一套颜色语义，避免每张卡自己发明一套）。 */
    function toneOfStatus(status) {
      if (status === 'failed') return 'err'
      if (status === 'cancelled') return 'warn'
      if (status === 'running') return 'live'
      return 'ok'
    }

    /**
     * 卡片外壳：图标 + 标题 + 摘要 + 状态徽标，展开体在下方。
     *
     * 所有专属卡片都用它，因此「卡片长什么样、展开怎么动」只有一处实现。
     *
     * @param props - `kind`（决定图标）、`title`、`summary`、`chips`、`live`、`open`、`onToggle`、`children`。
     * @returns 卡片。
     */
    function Card({ kind, title, summary, chips, live, open, onToggle, children }) {
      const icon = iconForCard(kind)
      const leading = icon === null ? h('span', { className: 'dcf-chev' }) : h(icon, { className: 'dcf-cardicon' })
      return h(
        'div',
        { className: 'dcf-card', 'data-kind': kind, 'data-live': live === true ? 'true' : 'false' },
        h(
          'button',
          { type: 'button', className: 'dcf-cardhead', 'aria-expanded': open === true, onClick: onToggle },
          h(Chevron, { open }),
          leading,
          h('span', { className: 'dcf-cardtitle' }, title),
          summary === undefined || summary === null || summary === ''
            ? null
            : h('span', { className: 'dcf-cardsummary' }, summary),
          ...(Array.isArray(chips) ? chips : []),
        ),
        h(Fold, { open, className: 'dcf-cardbody' }, children),
      )
    }

    /** 文件编辑卡的差异徽标：红色 `−N`、绿色 `+N`。 */
    function DiffChips({ added, removed }) {
      const chips = []
      if (removed > 0) chips.push(h('span', { key: 'minus', className: 'dcf-chip', 'data-tone': 'del' }, `−${removed}`))
      if (added > 0) chips.push(h('span', { key: 'plus', className: 'dcf-chip', 'data-tone': 'add' }, `+${added}`))
      if (chips.length === 0) chips.push(h('span', { key: 'none', className: 'dcf-chip', 'data-tone': 'muted' }, '±0'))
      return chips
    }

    /** 命令卡：头部一行状态，展开后是终端卡片（命令 + 输出）。 */
    function CommandCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, card.status === 'running')
      const chips = [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: commandStatusText(t, card.status) })]
      if (card.exitCode !== undefined && card.exitCode !== 0) {
        chips.push(h(StatusChip, { key: 'exit', tone: 'err', text: t('flow.exitCode', { code: card.exitCode }) }))
      }
      if (card.signal !== undefined) {
        chips.push(h(StatusChip, { key: 'signal', tone: 'warn', text: t('flow.signal', { signal: card.signal }) }))
      }
      return h(
        Card,
        {
          kind: 'command',
          title: t('flow.category.command'),
          summary: card.commandShort,
          chips,
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(TerminalBlock, {
          command: card.command,
          output: card.output,
          running: card.status === 'running',
          exitCode: card.exitCode,
          signal: card.signal,
          maxLines: 14,
          labels: terminalLabels(t),
        }),
      )
    }

    /** 文件编辑卡：头部显示路径与 `−N/+N`，展开后是入参与结果。 */
    function FileCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      const counts = card.diff ?? { added: 0, removed: 0 }
      return h(
        Card,
        {
          kind: 'file',
          title: t('flow.category.file'),
          summary: card.fileName,
          chips: DiffChips(counts),
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h('div', { className: 'dcf-note' }, t('flow.card.diffNote')),
        h(ClampedPre, { text: card.argsRaw === '' ? t('flow.noOutput') : card.argsRaw, t }),
        card.output === '' ? null : h(ClampedPre, { text: card.output, t }),
      )
    }

    /** MCP 卡：头部只写函数名，展开才给输入与返回值。 */
    function McpCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      const title = card.server === '' ? card.mcpTool : `${card.server} · ${card.mcpTool}`
      return h(
        Card,
        {
          kind: 'mcp',
          title: t('flow.category.mcp'),
          summary: title,
          chips: [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: commandStatusText(t, card.status) })],
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(JsonBlock, { label: t('flow.card.input'), payload: card.args }),
        card.output === '' ? null : h(JsonBlock, { label: t('flow.card.result'), payload: card.output }),
      )
    }

    /** 提问卡：头部是问题本身，展开后是选项与用户回答（按问题 id 回配）。 */
    function QuestionCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, card.answered !== true)
      const first = card.prompts[0]
      const summary =
        first === undefined ? card.summary : first.header !== '' ? `${first.header}：${first.question}` : first.question
      const body = []
      for (const prompt of card.prompts) {
        const parts = [h('div', { key: 'q', className: 'dcf-questiontext' }, prompt.question)]
        for (const option of prompt.options) {
          const chosen = prompt.selected.includes(option)
          parts.push(
            h('div', { key: `o:${option}`, className: 'dcf-option', 'data-chosen': chosen ? 'true' : 'false' }, option),
          )
        }
        if (prompt.custom !== '') parts.push(h('div', { key: 'custom', className: 'dcf-option' }, prompt.custom))
        body.push(h('div', { key: prompt.id === '' ? prompt.question : prompt.id, className: 'dcf-question' }, parts))
      }
      if (card.output !== '') {
        body.push(h(JsonBlock, { key: 'answer', label: t('flow.card.answer'), payload: card.output }))
      }
      return h(
        Card,
        {
          kind: 'question',
          title: t('flow.category.question'),
          summary,
          chips: [
            h(StatusChip, {
              key: 'status',
              tone: card.status === 'cancelled' ? 'warn' : card.answered === true ? 'ok' : 'live',
              text:
                card.status === 'cancelled'
                  ? t('flow.status.cancelled')
                  : card.answered === true
                    ? t('flow.status.done')
                    : t('flow.card.waiting'),
            }),
          ],
          live: card.answered !== true && card.status !== 'cancelled',
          open,
          onToggle: toggle,
        },
        body,
      )
    }

    /**
     * 子 agent 卡：**输出默认展开**，子 agent 结束后**自动折叠**这个节点。
     *
     * 与「思考中」同一层（都是任务下的处理过程），因此层级是
     * 任务处理流 > 子任务 > 小处理过程 = 子 agent 操作（用户当轮要求的分级）。
     * 展开体是子 agent 交回的报告文本；报告下方还有一块「子代理过程」——子会话的内部步骤
     * 不在父会话的节点树里（子会话是独立会话），只有**读子会话自己的事件流**才看得见，
     * 见 `58-subagent.js`（拿不到时那块面板自己消失，卡片行为与以前完全一致）。
     */
    function SubagentCard({ card, t, sessionId, keyPrefix }) {
      const report = card.report
      // 默认展开的时机不是「收到 tool/result」而是「收到结算通知」：后台派发时结果只是一行
      // `started subagent <id>`，子 agent 那时还在跑（见 core-seams.md §8.7）。
      const live = report === undefined && card.status !== 'failed' && card.status !== 'cancelled'
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, live)
      const statusText2 = card.status === 'started' ? t('flow.status.started') : commandStatusText(t, card.status)
      const body = []
      if (card.prompt !== '') body.push(h(ClampedPre, { key: 'prompt', text: card.prompt, t }))
      if (report === undefined) {
        body.push(h('div', { key: 'await', className: 'dcf-note' }, t('flow.card.awaitReport')))
      } else {
        if (report.summary !== '') body.push(h('div', { key: 'summary', className: 'dcf-note' }, report.summary))
        if (report.text !== '') {
          const reportText = clampText(report.text)
          body.push(h('div', { key: 'report', className: 'dcf-text' }, h(MarkdownText, { text: reportText.text, labels: card.markdownLabels })))
          body.push(h(TruncationNote, { key: 'report-note', clamped: reportText, t }))
        }
      }
      // 子代理过程：卡片展开时才读子会话（`active` 就是卡片自己的展开态）。
      body.push(h(SubagentProcess, { key: 'process', card, t, sessionId, keyPrefix, active: open }))
      return h(
        Card,
        {
          kind: 'subagent',
          title: t('flow.card.subagent'),
          summary: card.summary === '' ? card.prompt.split('\n', 1)[0] : card.summary,
          chips: [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: statusText2 })],
          live,
          open,
          onToggle: toggle,
        },
        body,
      )
    }

    /** 兜底卡：没有专属卡片的工具（只读内置、未知插件工具）——一行标题 + 摘要，展开是入参与结果。 */
    function PlainCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      return h(
        Card,
        {
          kind: 'plain',
          title: card.name,
          summary: card.summary,
          chips: card.status === 'failed'
            ? [h(StatusChip, { key: 'status', tone: 'err', text: t('flow.status.failed') })]
            : [],
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(JsonBlock, { label: t('flow.card.input'), payload: card.args }),
        card.output === '' ? null : h(JsonBlock, { label: t('flow.card.output'), payload: card.output }),
      )
    }

    /** 按卡片类型分派。所有展开态用同一个 `keyPrefix` 作为持久化键前缀（= 节点 key）。 */
    function ToolCard({ card, t, sessionId, labels, keyPrefix }) {
      const shared = { card: { ...card, markdownLabels: labels }, t, sessionId, keyPrefix }
      if (card.kind === 'command') return h(CommandCard, shared)
      if (card.kind === 'file') return h(FileCard, shared)
      if (card.kind === 'mcp') return h(McpCard, shared)
      if (card.kind === 'question') return h(QuestionCard, shared)
      if (card.kind === 'subagent') return h(SubagentCard, shared)
      return h(PlainCard, shared)
    }

    /** 「思考」行：默认折叠，展开后是原始推理文本。 */
    function ThinkingEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `think:${entry.key}`, false)
      const clamped = clampText(entry.text)
      const lines = clamped.text.split('\n').length
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.category.thinking'),
          trailing: h('span', { className: 'dcf-badge' }, String(lines)),
        },
        h('pre', { className: 'dcf-pre' }, clamped.text),
        h(TruncationNote, { clamped, t }),
      )
    }

    /** 「思考」块里的一行非工具过程（斜杠命令、上下文压缩、重试…）：只显示标题。 */
    function ProcessRowEntry({ entry, t }) {
      return h(DisclosureLine, {
        open: false,
        leading: h('span', { className: 'dcf-chev' }),
        title: t(entry.titleKey),
      })
    }

    /**
     * 「上下文注入」折叠点：把这一段的多次注入**合并**在一个折叠点里（用户要求）。
     *
     * 折叠时只显示段数，展开后逐段显示注入正文（原文保留换行）。
     */
    function ContextEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `ctx:${entry.key}`, false)
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t(entry.titleKey),
          trailing: h('span', { className: 'dcf-badge' }, t('flow.context.count', { count: entry.items.length })),
        },
        entry.items.map((item) => h(ClampedPre, { key: item.key, text: item.text, t })),
      )
    }
