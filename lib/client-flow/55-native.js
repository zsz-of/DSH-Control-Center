    /* ──────────────────────────── 原生节点座位 ──────────────────────────── */

    /**
     * 核心的**对话节点插槽**：本视图的每一行内容都从这里渲染。
     *
     * 用户要求「命令运行、工具调用、思考的展示方式都用原生的 DSH 的，自己只处理节点之间的层级关系」。
     * 这个槽就是核心的叶子渲染面：17 个 kind 全部有原生条目——14 个在 `dsh-client-ui-chat`
     * （`user` / `steering` / `context` / `system-prompt` / `assistant-step` / `command` /
     * `manual-compaction` / `compaction` / `model-retry` / `turn-error` / `turn-max-tokens` /
     * `turn-process` / `turn-tail` / `unknown`），另有 `tool-call`（ui-tool，内部再按工具名分派到
     * 命令卡 / 差异块 / 读取块 / 搜索块 / 提问卡…）、`command-input`（ui-goal）、
     * `workflow-run`（ui-workflow-run）。事实与行号见 `docs/references/core-seams.md` §13。
     */
    const NATIVE_NODE_SLOT = 'conversation.chat.node'

    /** 消息图片插槽：原生用户/助手座位经它渲染附件（ui-attachment 注册的条目）。 */
    const NATIVE_IMAGES_SLOT = 'conversation.message.images'

    /** 本插件自己的会话作用域子槽：只为让渲染器给本条目 `renderSlot` 与 `SessionProvider`。 */
    const OWN_SEAT_SLOT = 'chat-flow.seat'

    /**
     * ⚠️ **本视图自己接管的合成节点**（不交给原生座位）定义在派生层：`20-derive.js` 的
     * `OWNED_NODE_KINDS`——那里同时说明为什么 `turn-tail` 必须交给核心而不是自己画。
     * 放在派生层是因为「哪些节点属于本插件」是**模型层的事实**：座位筛选（`seatNodesOf`）
     * 与「空块」判定（`isBlankNode`）都从同一处读，避免两份名单走偏。
     */

    /**
     * 本条目声明的子槽表。
     *
     * ⚠️ **这里有一个刻意的技巧，依据是核心源码而不是猜测**：`register()` 的子槽冲突检查只枚举
     * **自有可枚举**键（`dsh-client-ui-slots/lib/index.js:100` 的 `Object.keys(options.children)`），
     * 而 `renderSlot` 的所有权检查只做属性读取（`dsh-client-ui-renderer/lib/client.js:285`
     * 的 `entry.children?.[key]`）。核心 ui-chat 的视图条目**已经声明**了
     * `conversation.chat.node` 与 `conversation.message.images`，直接写进 children 会抛
     * 「slot is already declared」。把这两个核心子槽挂成**不可枚举属性**：冲突检查看不到它们，
     * 所有权检查读得到它们，于是本条目获得 `renderSlot` 的授权，却既不去声明、也永远不会
     * 在释放时连带把别人的子槽收掉（`releaseEntry` 同样只枚举自有可枚举键，见 §13）。
     *
     * `chat-flow.seat` 是本插件**自己**的会话作用域子槽（空实现）：条目一旦声明了 children，
     * 渲染器才会把 `renderSlot` 放进 kit；其中有会话作用域子槽时才会给 `SessionProvider`。
     *
     * @returns children 表。
     */
    function nativeViewChildren() {
      const children = {}
      children[OWN_SEAT_SLOT] = { kind: 'single', scope: 'session' }
      const coreSlots = [
        [NATIVE_NODE_SLOT, { kind: 'keyed', scope: 'session' }],
        [NATIVE_IMAGES_SLOT, { kind: 'single', scope: 'session' }],
      ]
      for (const [key, spec] of coreSlots) {
        Object.defineProperty(children, key, {
          value: spec,
          enumerable: false,
          writable: false,
          configurable: true,
        })
      }
      return children
    }

    /**
     * 节点所在回合的**数据存储**，作为插槽的 `hookContext` 传下去。
     *
     * 与核心 `turnDataOf`（`dsh-client-ui-chat/lib/client.js:1467-1470`）逐字同义：
     * 只有 `location.kind` 是 `turn` / `step` 时才有；`unresolved` 或没有 location 时是 `undefined`。
     * 这个值必须**每次渲染都传**（哪怕是 `undefined`），因为该槽子规格上挂着上下文 hook 工厂
     * （`CHAT_NODE_INJECT`，见 §13）；渲染器发现「有上下文 hook 却没给 hookContext」会直接抛
     * `SlotAssemblyError`（`dsh-client-ui-renderer/lib/client.js:635`）。
     *
     * @param node - 对话节点。
     * @returns 回合数据存储，或 `undefined`。
     */
    function turnDataOfNode(node) {
      const location = node?.location
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.data : undefined
    }

    /** 节点所在回合号（原生座位没有这个属性，本视图用它输出核心同款的 `data-chat-turn`）。 */
    function turnOfChatNode(node) {
      const location = node?.location
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
    }

    /**
     * 原生座位外层的错误边界。
     *
     * **为什么必须有**：本视图把整块界面交给别人的组件渲染，任何一次原生渲染抛错都会顺着
     * React 冒泡到插槽条目的错误边界，条目被判「让位」（abdicate）——整块对话区变成
     * `data-slot-error`，代价远大于少渲染一行。这里把失败收敛在**单个节点**的范围内：
     * 那一行退化成自绘叶子，其余行照常。
     */
    class NativeLeafBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        // 显式报错而不是静默吞掉：真机出问题时这条日志是唯一的线索。
        console.warn('[chat-flow] 原生节点座位渲染失败，该行改用自绘叶子：', error)
      }

      render() {
        return this.state.failed === true ? (this.props.fallback ?? null) : this.props.children
      }
    }

    /**
     * 真正调用插槽的那一层（抛错发生在它的渲染里，因此被外层边界接住）。
     *
     * `fallback` 同时交给核心：某个 kind 没有任何条目时，插槽自己会渲染它
     * （`dsh-client-ui-renderer/lib/client.js:828`），所以「核心没装 ui-tool」这类情况
     * 也会退化成自绘卡片，而不是留一片空白。
     */
    function NativeSeatInner({ node, owner, renderSlot, fallback }) {
      return renderSlot(
        NATIVE_NODE_SLOT,
        { ...owner, node },
        {
          entryKey: typeof node?.kind === 'string' ? node.kind : 'unknown',
          hookContext: turnDataOfNode(node),
          fallback,
        },
      )
    }

    /**
     * 一个节点的原生座位。
     *
     * @param props - `node`、`owner`（原生座位需要的主人参数）、`renderSlot`、`fallback`。
     * @returns 座位；`renderSlot` 不可用（例如装配里没有 ui-chat）时直接给回退叶子。
     */
    function NativeSeat({ node, owner, renderSlot, fallback }) {
      const safeFallback = fallback ?? null
      if (typeof renderSlot !== 'function') return safeFallback
      return h(
        NativeLeafBoundary,
        { fallback: safeFallback },
        h(NativeSeatInner, { node, owner, renderSlot, fallback: safeFallback }),
      )
    }

    /**
     * 自绘叶子：原生座位不可用时的退路，复用本插件原有的卡片层。
     *
     * @param props - `node`、`row`（{@link nodeRowOf} 的结果）、`t`、`sessionId`、`labels`。
     * @returns 叶子；该节点没有可渲染模型时返回 `null`。
     */
    function ChatFlowLeaf({ node, row, t, sessionId, labels }) {
      if (row === null || row === undefined) return null
      if (row.kind === 'tool') {
        return h(ToolCard, { card: row.card, t, sessionId, labels, keyPrefix: `n:${row.key}` })
      }
      if (row.kind === 'thinking') return h(ThinkingEntry, { entry: row, t, sessionId })
      if (row.kind === 'row') return h(ProcessRowEntry, { entry: row, t })
      if (row.kind === 'message') {
        return h(UserBubble, { text: row.text, nodeKey: node?.key, kind: node?.kind, t })
      }
      if (row.kind === 'assistant') return h(AssistantText, { text: row.text, labels, t })
      return h(ClampedPre, { text: row.text, t })
    }

    /**
     * 一行节点：**原生座位优先、自绘叶子兜底**，并补上核心的 DOM 约定属性。
     *
     * `data-chat-anchor-key` / `data-chat-flow-kind` / `data-chat-flow-key` / `data-chat-turn`
     * 是核心 `ChatNodeSeat` 外层容器（`dsh-client-ui-chat/lib/client.js:1535-1544`）输出的属性，
     * 别人的插件按它们找座位——例如回退插件用
     * `[data-chat-flow-kind="user"][data-chat-anchor-key]` 定位用户发言，再往行内的按钮容器里
     * 挂一个「还原到此处」按钮（`dsh-rewind-plugin/lib/client.js:1111-1123`）。
     *
     * @param props - `node`、`row`、`seat`（`{owner, renderSlot}`）、`t`、`sessionId`、`labels`、`marker`（可选的状态标记文字）。
     * @returns 行。
     */
    function NativeNodeRow({ node, row, seat, t, sessionId, labels, marker }) {
      const fallback = h(ChatFlowLeaf, { node, row, t, sessionId, labels })
      const attributes = {
        className: marker === null || marker === undefined ? 'dcf-leaf' : 'dcf-leaf dcf-leaf-marked',
        'data-chat-flow-kind': node.kind,
        'data-chat-flow-key': node.key,
        'data-chat-anchor-key': node.key,
      }
      const turn = turnOfChatNode(node)
      if (turn !== undefined) attributes['data-chat-turn'] = String(turn)
      const content = [
        h(NativeSeat, {
          key: 'seat',
          node,
          owner: seat?.owner,
          renderSlot: seat?.renderSlot,
          fallback,
        }),
      ]
      // 状态标记（目前只有插队消息用）：挂在行首，说明「这条消息是怎么进来的」。
      if (marker !== null && marker !== undefined) {
        content.unshift(h('span', { key: 'marker', className: 'dcf-chip dcf-leafmarker', 'data-tone': 'warn' }, marker))
      }
      return h('div', attributes, content)
    }

    /** 一批节点的回退模型（按节点 key 索引）；空结果不建 Map，避免每行都白查一次。 */
    function rowModelsOf(nodes, subagents) {
      const models = new Map()
      for (const node of nodes) {
        const row = nodeRowOf(node, subagents)
        if (row !== null) models.set(node.key, row)
      }
      return models
    }

    /**
     * 会话相对路径 → 主机可用的绝对路径。
     *
     * 与核心的 `resolveWorkspacePath`（`@deepseek-ai/dsh-util-workspace-path/lib/index.js:16-20`）
     * 同义：`/` 开头与 Windows 盘符/UNC 前缀视为绝对路径，其余拼到会话 cwd 下。
     * 那个助手是包内私有导出、不在平台 seed 模块表里，所以这里自己实现同义逻辑。
     *
     * @param cwd - 会话工作区根。
     * @param path - 绝对或用例相对路径。
     * @returns 绝对路径；cwd 未知时原样返回。
     */
    function resolveSeatPath(cwd, path) {
      if (typeof path !== 'string' || path === '') return path
      if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
      if (typeof cwd !== 'string' || cwd === '') return path
      return `${cwd.replace(/[/\\]+$/, '')}/${path.replace(/^[/\\]+/, '')}`
    }

    /**
     * 原生叶子需要的**注入面**：核心 ui-chat 在它自己的视图条目里提供的同款能力
     * （`dsh-client-ui-chat/lib/client.js:8108-8151`），本视图必须自己造一份。
     *
     * 可选服务一律用 `ctx.get(name)` 取，**不写进 `inject` 列表**：cordis 的 `inject` 是强依赖，
     * 服务缺席会让整个插件干脆不装配（对话区连任务视图都不会出现）；而 `ctx.get` 缺席只返回
     * `undefined`，能力降级、视图照常。核心自己也用 `ctx.get('chatFileMentions')`（`ui-chat:8123`）。
     *
     * @param ctx - 客户端插件上下文。
     * @param sessionId - 本条目所属会话。
     * @returns 注入面。
     */
    function nativeSeatFace(ctx, sessionId) {
      const optional = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
      const uiConversation = optional('uiConversation')
      const remote = optional('remote')
      return {
        /** 按会话 cwd 打开文件（原生叶子里点文件名会走到这里）。 */
        openFile: async (path) => {
          if (remote?.session === undefined) throw new Error('chat-flow: remote.session 不可用，无法打开路径')
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const result = await remote.session.openWorkspacePath({ path: resolveSeatPath(cwd, path) })
          if (result.ok !== true) throw new Error(`chat-flow: 打开路径失败（${result.error?.message ?? '未知原因'}）`)
        },
        /** 附件图片 URL；核心在同一个位置提供同名的 `{peek}` 挂件（`ui-chat:8133`）。 */
        loadImage:
          uiConversation === undefined
            ? undefined
            : Object.assign((attachment) => uiConversation.imageUrl(sessionId, attachment), {
                peek: (attachment) => uiConversation.peekImageUrl(sessionId, attachment),
              }),
        /** 助手消息里的文件引用；服务缺席时给 `undefined`，原生叶子会跳过提及渲染（`ui-chat:8123`）。 */
        fileMentions: (owner) => {
          const service = optional('chatFileMentions')
          return typeof service?.forClosing === 'function' ? service.forClosing(owner) : undefined
        },
        /** 从某个 seq 分叉出新会话（回合尾部的分支按钮用，`ui-chat:8141-8149`）。 */
        forkAt: (seq) => {
          const sessions = ctx.sessions
          if (typeof sessions?.fork !== 'function') return
          sessions.fork({ sessionId, atSeq: seq, increaseTitle: true }).then(
            (childId) => sessions.open(childId),
            // 分叉失败（会话已被释放等）不该打断阅读：显式忽略，不写空 catch。
            () => undefined,
          )
        },
      }
    }

    /** 要渲染的节点：剔除本视图自己接管的合成节点（见 {@link OWNED_NODE_KINDS}）。 */
    function seatNodesOf(nodes) {
      return nodes.filter((node) => node !== null && node !== undefined && !OWNED_NODE_KINDS.has(node.kind))
    }

    /**
     * 「上下文注入」折叠点：一段里的多次注入**合并进同一个折叠点**（用户要求）。
     *
     * 折叠态只显示注入段数，展开后每一段仍是**原生座位**（核心的 `context` 条目带来源与形态标签），
     * 只是被收进了同一个折叠容器里——层级由本插件给，内容仍由核心画。
     *
     * @param props - `nodes`（该段全部 context 节点）、`models`、`t`、`sessionId`、`seat`、`labels`。
     * @returns 折叠点。
     */
    function ContextFold({ nodes, models, t, sessionId, seat, labels }) {
      const [open, toggle] = useCollapse(sessionId, `ctx:${nodes[0].key}`, false)
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.row.context'),
          trailing: h('span', { className: 'dcf-badge' }, t('flow.context.count', { count: nodes.length })),
        },
        nodes.map((node) =>
          h(NativeNodeRow, {
            key: node.key,
            node,
            row: models.get(node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        ),
      )
    }
