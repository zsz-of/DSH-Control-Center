    /* ────────────────────── 子代理过程（内联读子会话） ────────────────────── */

    /**
     * 子代理席位的 React 上下文。
     *
     * 子代理卡坐在很深的一层（`FlowBody → TurnGroup → NodeSequence → NativeNodeRow →
     * ChatFlowLeaf → ToolCard → SubagentCard`），把「读子会话」的能力逐层透传要动 5 处签名；
     * 改成上下文后，视图顶层（`TaskFlowView`）注入一次就够。
     *
     * `null` = 本视图拿不到子代理席位（宿主没装 ui-session / ui-conversation，或取不到会话
     * binding），此时子代理卡退回「只显示报告」的老行为，一个空壳都不多画。
     * 子代理过程内部也把它显式压成 `null`：子会话里的子代理卡只显示报告，不做无限递归。
     */
    const SubagentSeatContext = react.createContext(null)

    /** 未展开时的稳定空状态（`useState` 的初值必须是同一个引用，否则每次渲染都换对象）。 */
    const SUBAGENT_CHAT_IDLE = Object.freeze({ phase: 'idle' })

    /** 子代理过程最多画多少步：超出时从最近一步往前截，徽标仍显示真实总步数。 */
    const MAX_SUBAGENT_ROWS = 120

    /** 子代理下拉树最多列多少行（超出截断；正常会话远小于这个数）。 */
    const MAX_SUBAGENT_TREE_ROWS = 60

    /** 子代理树最多画几层（子代理还能再派子代理，但层数必须有底）：depth 从 0 起算，共 4 层。 */
    const MAX_SUBAGENT_TREE_DEPTH = 4

    /**
     * 子代理席位：把「某个子会话自己的对话快照」读给父会话里的卡片用。
     *
     * **为什么能这么读**（核心侧的依据见 `.agents/docs/references/core-seams.md` §16）：
     * - 父会话的节点树里**没有**子会话的内部步骤——子会话是独立会话，派发工具的结果只有
     *   一行 `started subagent <uuid>`，之后父流里只剩一条 `subagent-settled` 通知。
     *   所以「像 TRAE 一样看见子代理在干什么」只能读**子会话自己的事件流**；
     * - **必须先 retain**：平台的 binding 只存在于 retain 过的 scope 上（`sessions.binding(id)`
     *   读 `scopes.get(id)?.binding`，scopes 由 `retainScope`/`materializeScope` 写入），所以
     *   `sessions.retain(address, {source})` 是这条链路的入口；`reference.ready` 落地后
     *   `binding` 才有值。reference 由本文件按 watcher 引用计数保活，最后一个 watcher 退订时
     *   `release()`，不把子会话永久钉在内存里；
     * - `ctx.sessions.binding(childId)` 给的是子会话的 binding，其 `eventSource` 就是子会话
     *   的事件源；`uiConversation.binding(childId).target('chat')` 把它解成
     *   `{getSnapshot, subscribe}`，形状与本视图的 `useChat` 完全一致——派生与渲染都能原样复用；
     * - **不会切换舞台**：`sessions.open(id)` / `uiWorkspace.openSession(target)` 会把 stage 切到
     *   子会话（`manager.select` 里 `this.selected = childSessionId`），这里绕开它们，只走
     *   `retain` + `configureSubagent(address)` + `session.open()`——窗口打开 ⟺ 事件在流里，
     *   与「当前看的是谁」无关；
     * - 地址（`{parentSessionId, childSessionId, mode}`）来自平台记账：`sessions.subagentAddress(
     *   childId)` 先查本地地址表再查会话投影 `subagentCatalog`；`retain` 接受地址对象并把地址
     *   记进本地表，所以「父会话 + 子会话」这个最小地址也够用。目录水合入口是
     *   `sessions.refreshProjections(parent)`（子代理目录就是会话投影之一）。
     *
     * 拿不到任何一环就**如实降级**：面板显示一句说明，并留「打开子会话」按钮走核心自己的
     * `ctx.uiWorkspace.openSession(target)`（那条路一定会切舞台，但至少用户点得到）。
     *
     * @param ctx - 客户端插件上下文（`ctx.sessions` 必在；`uiConversation` / `uiWorkspace` 用
     *   `ctx.get()` 取，缺席是正常装配）。
     * @param sessionId - 当前视图的会话 id（= 子代理的父会话）。
     * @returns 子代理席位；`ctx.sessions` 不可用时返回空对象（视图照常渲染，只是没有过程面板）。
     */
    function subagentSeatFace(ctx, sessionId) {
      const sessions = ctx.sessions
      if (sessions === undefined || sessions === null || typeof sessions.binding !== 'function') return {}

      /** 可选服务一律 `ctx.get()`：缺席不阻塞本插件，也不写进 `inject`。 */
      const serviceOf = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)

      /**
       * 本会话子代理目录的条目。
       *
       * 权威来源是**会话投影** `subagentsByParent`→`subagentCatalog`：平台把目录做成会话投影
       * （`dsh-subagent/lib/index.js` 的投影键 `subagentCatalog`），客户端读
       * `sessions.list` 快照的 `projectionsBySession[sessionId].values.subagentCatalog`。
       * 条目形状是 `{id, createdAt, mode, label?}`——**没有 `kind` 字段**，所以这里不筛 `kind`。
       *
       * @param snapshot - 可选的会话列表快照（省一次 `getSnapshot`）。
       * @returns 条目数组；读不到时为空数组。
       */
      function catalogEntriesOf(snapshot) {
        const list =
          snapshot ?? (typeof sessions.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined)
        const projected = list?.projectionsBySession?.[sessionId]?.values?.subagentCatalog
        if (Array.isArray(projected)) return projected
        // 兼容更早的字段形状（历史版本塞在 list 快照顶层）；两个都没有就是空目录。
        const legacy = list?.subagentsByParent?.[sessionId]?.entries
        return Array.isArray(legacy) ? legacy : []
      }

      /** 目录里这个子会话的地址（`subagentAddress` 没记过时的来源）。 */
      function catalogAddressOf(childId) {
        const entry = catalogEntriesOf().find((candidate) => candidate?.id === childId)
        if (entry === undefined) return undefined
        return {
          parentSessionId: sessionId,
          childSessionId: childId,
          ...(typeof entry.mode === 'string' ? { mode: entry.mode } : {}),
        }
      }

      /**
       * 子会话的地址：平台的 `sessions.subagentAddress` 是权威来源（retain 过、或目录里已有），
       * 拿不到就退到目录条目，再退到「父会话 + 子会话」这个最小地址——`sessions.retain` 接受
       * 地址对象并把 `{parentSessionId, childSessionId, mode?}` 记进本地地址表。
       */
      function addressOf(childId) {
        const direct = typeof sessions.subagentAddress === 'function' ? sessions.subagentAddress(childId) : undefined
        if (direct !== undefined && direct !== null) return direct
        return catalogAddressOf(childId) ?? { parentSessionId: sessionId, childSessionId: childId }
      }

      /**
       * 子会话的 chat 源：`uiConversation.binding(childId).target('chat')`。
       *
       * 它要求该会话**已被 retain**（`uiConversation.binding` 内部断言
       * `this.sessions.binding(sessionId) === owner`，未保活时抛 `unknown session`），
       * 所以调用方必须先 `await ensureRetained(childId)`。
       */
      function chatOf(childId) {
        const conversation = serviceOf('uiConversation')
        if (conversation === undefined || typeof conversation.binding !== 'function') return undefined
        try {
          const target = conversation.binding(childId).target('chat')
          if (target !== undefined && target !== null && typeof target.getSnapshot === 'function') return target
        } catch {
          // 未保活/未登记的会话：核心的 `binding()` 会抛（`uiConversation.binding: unknown session …`），
          // 这里按「读不到」处理，让调用方走降级分支。
        }
        return undefined
      }

      /**
       * 拉一次本会话的会话投影（子代理目录就是投影之一）。
       *
       * 真 API 是 `sessions.refreshProjections(sessionId)`（“Load all Session projections once
       * per connection; retry an unsuccessful initial read”）；核心自己的目录 UI 也用它。
       * 幂等、失败只留痕：拉不动时地址可能已经在本地记账里（用户刚在头部目录里点过）。
       */
      function refreshCatalog() {
        if (typeof sessions.refreshProjections !== 'function') return
        try {
          const task = sessions.refreshProjections(sessionId)
          if (task !== undefined && task !== null && typeof task.catch === 'function') {
            task.catch((error) => {
              console.warn('[chat-flow] 拉取子代理目录失败：', error)
            })
          }
        } catch (error) {
          console.warn('[chat-flow] 拉取子代理目录失败：', error)
        }
      }

      /**
       * 保活记账：`retain` 的 reference 活到该 childId 的最后一个 watcher 退订为止。
       *
       * 平台的 binding **只在 retain 过的 scope 上存在**，所以「内联读子会话」必须先 retain；
       * 反之，永久 retain 会把每个看过一眼的子会话钉在内存里，因此按 watcher 引用计数释放。
       */
      const leases = new Map()

      function leaseOf(childId) {
        let lease = leases.get(childId)
        if (lease === undefined) {
          lease = { watchers: 0, reference: null, opening: null }
          leases.set(childId, lease)
        }
        return lease
      }

      /**
       * 保活一个子会话（幂等）。
       *
       * 成功才缓存；失败**不缓存**——目录或子会话可能随后才水合，而「第一次没读到就永久不可用」
       * 正是这条链路以前最大的坑。
       *
       * @param childId - 子会话 id。
       * @returns `'ready' | 'unlisted' | 'error'`。
       */
      function ensureRetained(childId) {
        const lease = leaseOf(childId)
        if (lease.reference !== null) return Promise.resolve('ready')
        if (lease.opening !== null) return lease.opening
        lease.opening = (async () => {
          if (typeof sessions.retain !== 'function') return 'no-retain'
          const reference = sessions.retain(addressOf(childId), { source: 'chatFlow' })
          lease.reference = reference ?? null
          if (reference !== null && reference !== undefined && reference.ready !== undefined) {
            await reference.ready
          }
          return 'ready'
        })().catch((error) => {
          console.warn('[chat-flow] 保活子会话失败：', error)
          lease.opening = null
          lease.reference = null
          return 'error'
        })
        return lease.opening
      }

      /** 释放一次保活；引用计数归零时真的 `release()`。 */
      function releaseLease(childId) {
        const lease = leases.get(childId)
        if (lease === undefined) return
        lease.watchers -= 1
        if (lease.watchers > 0) return
        leases.delete(childId)
        const reference = lease.reference
        if (reference !== null && reference !== undefined && typeof reference.release === 'function') {
          try {
            reference.release()
          } catch (error) {
            console.warn('[chat-flow] 释放子会话保活失败：', error)
          }
        }
      }

      /**
       * 打开子会话的窗口（幂等）。返回 `'ready' | 'unlisted' | 'error'`。
       *
       * 同一张卡在会话里可能反复挂载/卸载（切视图、翻页重组），所以**成功**结果按 childId 缓存；
       * 目录只拉一次。失败不留在缓存里，下一次展开会重试。
       */
      const opened = new Map()
      let catalogTouched = false
      function ensureOpen(childId) {
        const pending = opened.get(childId)
        if (pending !== undefined) return pending
        const task = (async () => {
          if (catalogTouched !== true) {
            catalogTouched = true
            refreshCatalog()
          }
          const status = await ensureRetained(childId)
          if (status !== 'ready') return status === 'no-retain' ? 'unlisted' : status
          const binding = sessions.binding(childId)
          if (binding === undefined) return 'unlisted'
          const address = addressOf(childId)
          if (address !== undefined && typeof binding.session?.configureSubagent === 'function') {
            binding.session.configureSubagent(address, true)
          }
          await binding.session?.open?.()
          return 'ready'
        })().catch((error) => {
          console.warn('[chat-flow] 打开子会话窗口失败：', error)
          return 'error'
        })
        opened.set(childId, task)
        void task.then((status) => {
          if (status !== 'ready') opened.delete(childId)
        })
        return task
      }

      return {
        /**
         * 订阅一个子会话的对话快照，返回退订函数。
         *
         * 监听器收到 `{phase}`：
         * - `'loading'` —— 正在拉目录 / 开窗口；
         * - `'ready'` —— 带 `snapshot`（形状同 `useChat` 的快照）；
         * - `'unavailable'` —— 带 `reason`（`'unlisted' | 'no-chat' | 'error'`），面板据此降级。
         *
         * @param childId - 子会话 id。
         * @param listener - 状态回调。
         * @returns 退订函数。
         */
        watch(childId, listener) {
          // 每个 watcher 持有一份保活；最后一个退订时才 `release()`。
          leaseOf(childId).watchers += 1
          let cancelled = false
          let unsubscribe = null
          const emit = () => {
            const chat = chatOf(childId)
            if (chat === undefined) {
              listener({ phase: 'unavailable', reason: 'no-chat' })
              return
            }
            listener({ phase: 'ready', snapshot: chat.getSnapshot() })
          }
          listener({ phase: 'loading' })
          void (async () => {
            const status = await ensureOpen(childId)
            if (cancelled) return
            if (status !== 'ready') {
              listener({ phase: 'unavailable', reason: status })
              return
            }
            const chat = chatOf(childId)
            if (chat === undefined) {
              listener({ phase: 'unavailable', reason: 'no-chat' })
              return
            }
            // 订阅本身会 `activate('chat')`（核心在 subscribe 里激活目标），所以先订阅再取快照。
            unsubscribe = typeof chat.subscribe === 'function' ? chat.subscribe(emit) : null
            emit()
          })()
          return () => {
            if (cancelled) return
            cancelled = true
            if (typeof unsubscribe === 'function') unsubscribe()
            releaseLease(childId)
          }
        },

        /**
         * 跳到子会话（降级按钮）：走核心的 `uiWorkspace.openSession(target)`——平台自己的
         * 目录行/侧栏跳转用的就是它，这条路会切舞台，只在用户明确点击时走。
         */
        openSubagent(childId) {
          const workspace = serviceOf('uiWorkspace')
          if (workspace === undefined || typeof workspace.openSession !== 'function') return false
          try {
            workspace.openSession(addressOf(childId))
            return true
          } catch (error) {
            console.warn('[chat-flow] 打开子会话失败：', error)
            return false
          }
        },

        /**
         * 读一次「子代理目录」的原始材料：会话列表快照 + 本会话的目录条目。
         *
         * 两样都要：列表快照（`byId` 里有全机的 `parentId` 链与 `running`）负责**树形结构与实时运行态**，
         * 目录条目负责**标签与模式（一次性/可续）**（目录是按需拉的，可能还没水合）。
         *
         * @returns `{list, catalog}`；读不到时字段为空。
         */
        catalog() {
          const snapshot =
            typeof sessions.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined
          return { list: snapshot, catalog: { entries: catalogEntriesOf(snapshot) } }
        },

        /**
         * 订阅会话列表快照（子代理新增/运行态变化都会推）。返回退订函数。
         *
         * @param listener - 变化回调。
         * @returns 退订函数；列表不可订阅时返回空函数。
         */
        subscribeCatalog(listener) {
          if (typeof sessions.list?.subscribe !== 'function') return () => {}
          return sessions.list.subscribe(listener)
        },

        /**
         * 拉一次本会话的子代理目录（幂等、单飞由核心保证）。
         *
         * 只在**真的要看的时候**调：下拉菜单展开、或已经确认有子代理时。空会话不打扰宿主。
         */
        refreshCatalog,
      }
    }

    /**
     * 子代理过程要画的行种类——与 {@link subagentRowOf} 的分派**一一对应**。
     *
     * 用白名单而不是「排除法」：`nodeRowOf` 还会产出 `context`（上下文压缩/注入）与 `row`
     * （斜杠命令、重试这类过程标注），它们是**父会话**的过程注解，在子代理过程里是噪音；
     * 而且 `subagentRowOf` 对它们没有分派，放行就会画出空叶子。
     */
    const SUBAGENT_ROW_KINDS = Object.freeze(['tool', 'thinking', 'assistant', 'message'])

    /**
     * 子代理过程的行模型：把子会话的快照拍平成「步骤行」。
     *
     * 复用单节点回退模型 {@link nodeRowOf}（它天然逐节点独立、不做跨节点合并），只做两件事：
     * - 保留 {@link SUBAGENT_ROW_KINDS} 列出的四种行；
     * - 顶层节点里只留用户发言（子会话的输入是什么），不画父视图那套分段头。
     *
     * @param snapshot - 子会话的 chat 快照（`{order, nodes}`）。
     * @returns 行数组（呈现序；每项带 `key` 与 `kind`）。
     */
    function subagentRowsOf(snapshot) {
      const nodes = orderedNodes(snapshot)
      if (nodes.length === 0) return []
      const subagents = collectSubagentContext(nodes)
      const rows = []
      for (const node of nodes) {
        const row = nodeRowOf(node, subagents)
        if (row === null || row === undefined) continue
        if (!SUBAGENT_ROW_KINDS.includes(row.kind)) continue
        // 顶层节点里只有用户发言/引导消息值得显示（子会话的输入是什么）。
        if (isTopLevelNode(node) && row.kind !== 'message') continue
        rows.push(row)
      }
      return rows
    }

    /**
     * 按「展开时才开始读」的方式订阅一个子会话。
     *
     * `seat` 或 `childId` 为空时**不订阅**（面板收起、卡片收起、或席位缺席），
     * 这样一张没展开的卡不会白白拉一个子会话的历史窗口。
     *
     * @param seat - {@link subagentSeatFace} 的产物，或 `null`。
     * @param childId - 子会话 id；空串表示不读。
     * @returns `{phase, snapshot?, reason?}`。
     */
    function useSubagentChat(seat, childId) {
      const [state, setState] = useState(SUBAGENT_CHAT_IDLE)
      useEffect(() => {
        if (seat === null || seat === undefined || childId === '') return undefined
        let alive = true
        const unsubscribe = seat.watch(childId, (next) => {
          if (alive) setState(next)
        })
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, [seat, childId])
      return state
    }

    /**
     * 「子代理过程」面板：子代理卡展开后，在报告下方内联列出子会话自己的步骤。
     *
     * 三条纪律：
     * - **只在展开时读**：`active`（卡片展开）与自身展开状态同时为真才调 `watch`；
     * - **拿不到就降级**：读不到快照时只显示一句说明 + 「打开子会话」按钮，绝不空转；
     * - **不递归**：面板内部把 {@link SubagentSeatContext} 压成 `null`，子会话里的子代理卡
     *   只显示报告（否则一层套一层，读窗口的数量会随深度指数增长）。
     *
     * @param props - `card`（子代理卡模型）、`t`、`sessionId`、`keyPrefix`、`active`（卡片是否展开）、
     *   `seat`（可选：显式席位，**测试接缝**；不传才走 context）。
     * @returns 过程面板；席位缺席或没有 childId 时返回 `null`。
     */
    function SubagentProcess({ card, t, sessionId, keyPrefix, active, seat: seatProp }) {
      /* 测试替身的手写 React 只有默认值语义（见 test/helpers/load-bundle.mjs 的 createContext），
         所以显式 `seat` 是对面板单独做用例的唯一入口。 */
      const seat = seatProp !== undefined ? seatProp : react.useContext(SubagentSeatContext)
      const childId = typeof card.childId === 'string' ? card.childId : ''
      const usable = childId !== '' && seat !== null && seat !== undefined && typeof seat.watch === 'function'
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:process`, active === true)
      const reading = usable && active === true && open === true
      const state = useSubagentChat(reading ? seat : null, reading ? childId : '')
      const rows = useMemo(() => (state.phase === 'ready' ? subagentRowsOf(state.snapshot) : []), [state])
      if (!usable) return null
      const labels = card.markdownLabels
      const shown = rows.length > MAX_SUBAGENT_ROWS ? rows.slice(rows.length - MAX_SUBAGENT_ROWS) : rows
      let summary = ''
      if (state.phase === 'loading') summary = t('flow.subagent.loading')
      else if (state.phase === 'unavailable') summary = t('flow.subagent.unavailable')
      else if (state.phase === 'ready') summary = t('flow.subagent.steps', { count: rows.length })
      const body = []
      if (state.phase === 'ready') {
        if (rows.length === 0) body.push(h('div', { key: 'empty', className: 'dcf-note' }, t('flow.subagent.empty')))
        else {
          const list = []
          for (const row of shown) {
            list.push(h('div', { key: row.key, className: 'dcf-leaf' }, subagentRowOf(row, { t, sessionId: childId, labels, keyPrefix })))
          }
          body.push(
            h(
              'div',
              { key: 'list', className: 'dcf-subprocess' },
              shown.length < rows.length
                ? h('div', { className: 'dcf-note' }, t('flow.subagent.truncated', { count: shown.length }))
                : null,
              list,
            ),
          )
        }
      }
      return h(
        'div',
        { className: 'dcf-subagent', 'data-dcf-subagent': 'true', 'data-phase': state.phase },
        h(
          DisclosureLine,
          {
            open,
            onToggle: toggle,
            title: t('flow.subagent.process'),
            summary,
            className: 'dcf-block',
          },
          // 子会话内部的子代理卡只显示报告：把席位显式压成 null。
          h(SubagentSeatContext.Provider, { value: null }, body),
        ),
        seat !== null && seat !== undefined && typeof seat.openSubagent === 'function'
          ? h(
              'button',
              {
                key: 'open',
                type: 'button',
                className: 'dcf-hint',
                'data-dcf-subagent-open': 'true',
                onClick: () => {
                  seat.openSubagent(childId)
                },
              },
              t('flow.subagent.open'),
            )
          : null,
      )
    }

    /**
     * 一行子代理步骤。工具卡 / 思考行 / 正文 / 用户发言各走各自的既有组件——
     * 子会话的节点形状与父会话一模一样，所以这里不需要第二套渲染。
     *
     * @param row - {@link subagentRowsOf} 的一行。
     * @param props - `t`、`sessionId`（传子会话 id：折叠键与父会话分开命名空间）、`labels`、`keyPrefix`。
     * @returns 行。
     */
    function subagentRowOf(row, { t, sessionId, labels, keyPrefix }) {
      if (row.kind === 'tool') {
        return h(ToolCard, { card: row.card, t, sessionId, labels, keyPrefix: `${keyPrefix}:${row.key}` })
      }
      if (row.kind === 'thinking') return h(ThinkingEntry, { entry: row, t, sessionId })
      if (row.kind === 'assistant') return h(AssistantText, { text: row.text, labels, t })
      if (row.kind === 'message') return h(UserBubble, { text: row.text, nodeKey: row.key, kind: 'user', t })
      return null
    }

    /* ─────────────────── 子代理下拉菜单（任务视图顶部） ─────────────────── */

    /**
     * 五态：三个是用户点名要的（工作中 / 失败 / 完成），另两个是**如实降级**必须留出来的——
     * 「已中断」（用户自己停的，不该说成失败）与「状态未知」（历史窗口里没有结算通知，不能猜）。
     */
    const SUBAGENT_STATES = Object.freeze(['running', 'done', 'failed', 'interrupted', 'unknown'])

    /** 状态图标（用户要求「每个子代理选项右端用图标显示工作状态」）。 */
    const SUBAGENT_STATE_GLYPH = Object.freeze({
      running: '●',
      done: '✓',
      failed: '✕',
      interrupted: '⊘',
      unknown: '○',
    })

    /** 状态 → 色调：复用卡片那套颜色语义（`data-tone`，见 `50-nodes.js` 的 `toneOfStatus`）。 */
    const SUBAGENT_STATE_TONE = Object.freeze({
      running: 'live',
      done: 'ok',
      failed: 'err',
      interrupted: 'warn',
      unknown: 'muted',
    })

    /**
     * 状态 → 文案键。
     *
     * 写成显式映射而不是 `flow.agents.state.${state}`：字典测试（`test/client-locale.test.js`）
     * 会静态扫描「每个键都被引用」，模板串拼出来的键它扫不到，会当成死文案判红。
     */
    const SUBAGENT_STATE_LABEL = Object.freeze({
      running: 'flow.agents.state.running',
      done: 'flow.agents.state.done',
      failed: 'flow.agents.state.failed',
      interrupted: 'flow.agents.state.interrupted',
      unknown: 'flow.agents.state.unknown',
    })

    /** 结算通知文本 → 状态。文本来自宿主的 `settlementSummary`（英文，与界面语言无关）。 */
    const SUBAGENT_SETTLEMENT_PATTERNS = Object.freeze([
      ['failed', /failed before it finished|ended abnormally|declined the task|ran out of room/],
      ['interrupted', /was stopped before it finished/],
      ['done', /finished and will do no further work/],
    ])

    /**
     * 结算通知文本 → 五态之一。
     *
     * 唯一权威来源是宿主写给父会话的那条 `subagent-settled` 通知：
     * `dsh-subagent/lib/index.js:641-654` 的 `settlementSummary(childId, stopReason)` 按
     * `completed / aborted / max-tokens / refusal / error` 各给一句话。会话列表里**没有**任何失败字段
     * （`dsh-api-session-controller/lib/types/list.js` 只有 `running` / `blank` / `title` / `parentId` /
     * `origin` / `projectionValues`），所以「失败」只能从这句话读；认不出来的文本一律算「未知」，
     * 不猜——猜错比不显示更糟。
     *
     * @param text - 通知的 `summary` 或正文。
     * @returns 状态字符串。
     */
    function subagentStateOfSettlement(text) {
      if (typeof text !== 'string' || text === '') return 'unknown'
      for (const [state, pattern] of SUBAGENT_SETTLEMENT_PATTERNS) {
        if (pattern.test(text)) return state
      }
      return 'unknown'
    }

    /**
     * 一个子代理的地址缩写（拿不到标签时的兜底显示）。
     *
     * @param childId - 子会话 id。
     * @returns 前 8 位。
     */
    function shortChildId(childId) {
      return typeof childId === 'string' && childId.length > 8 ? childId.slice(0, 8) : String(childId ?? '')
    }

    /**
     * 子代理树（下拉菜单的行模型）——纯函数，不碰 React、不碰 ctx。
     *
     * 结构来源是**会话列表的 `parentId` 链**（`byId[id].parentId`），而不是目录条目：目录只给
     * 「本会话的直接子代理」，而子代理还能再派子代理；`byId` 里有全机的父子关系，可以一直往下走
     * （核心自己的下拉也是这么做的：`indexSubagentDescendants(summaries)`）。目录条目用来补齐
     * **标签、模式**与**诊断行**，列表里没有它们。
     *
     * 状态优先级（见 {@link subagentStateOfSettlement} 的说明）：
     * 1. 诊断行 → `failed`（子会话本身不健康，核心用 error 点表示）；
     * 2. 正在跑（`byId.running` 或目录 `activity:'running'`）→ `running`；
     * 3. 有结算通知 → 按通知文本判 `done` / `failed` / `interrupted`；
     * 4. 其余 → `unknown`（多半是历史窗口里没有那条通知，或目录还没水合）。
     *
     * @param parentSessionId - 父会话 id（= 本视图的会话）。
     * @param options - `{list, catalog, notices}`：会话列表快照、本会话目录、结算通知表
     *   （`Map<子会话 id, {summary, text}>`，由 `20-derive.js` 的 `collectSubagentNotices` 产出）。
     * @returns `{rows, total}`；`rows` 已按上限截断，`total` 就是列出的行数（上限就是上限，徽标不虚报）。
     */
    function subagentTreeOf(parentSessionId, options) {
      const list = options?.list
      const byId = list !== undefined && list !== null && typeof list.byId === 'object' && list.byId !== null ? list.byId : {}
      const entries = Array.isArray(options?.catalog?.entries) ? options.catalog.entries : []
      const notices = options?.notices instanceof Map ? options.notices : undefined
      const catalogChildren = new Map()
      const diagnostics = []
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') continue
        // 平台的目录条目形状是 `{id, createdAt, mode, label?}`——**没有 `kind`**，所以「有 id 就是
        // 子会话」；只有显式 `kind: 'diagnostic'` 才当诊断行（兼容更早的形状）。
        if (entry.kind === 'diagnostic') diagnostics.push(entry)
        else if (typeof entry.id === 'string' && entry.id !== '') catalogChildren.set(entry.id, entry)
      }

      /** 一个子会话 → 一行。 */
      function rowOf(childId, depth) {
        const summary = byId[childId]
        const entry = catalogChildren.get(childId)
        const notice = notices === undefined ? undefined : notices.get(childId)
        const detail = notice === undefined ? '' : notice.summary !== '' ? notice.summary : notice.text
        let state = 'unknown'
        if (summary?.running === true || entry?.activity === 'running' || entry?.running === true) state = 'running'
        else if (notice !== undefined) state = subagentStateOfSettlement(`${notice.summary}\n${notice.text}`)
        const label =
          typeof entry?.label === 'string' && entry.label !== ''
            ? entry.label
            : typeof summary?.title === 'string' && summary.title !== ''
              ? summary.title
              : typeof summary?.displayTitle === 'string' && summary.displayTitle !== ''
                ? summary.displayTitle
                : shortChildId(childId)
        return {
          key: childId,
          childId,
          kind: 'child',
          depth,
          state,
          detail: String(detail ?? ''),
          label: String(label),
          mode: typeof entry?.mode === 'string' ? entry.mode : '',
        }
      }

      const rows = []
      const seen = new Set()
      function walk(id, depth) {
        if (depth >= MAX_SUBAGENT_TREE_DEPTH) return
        // 直接子代理：目录（有标签/模式）∪ 列表（有实时运行态）取并集。
        const candidates = []
        if (depth === 0) for (const childId of catalogChildren.keys()) candidates.push(childId)
        for (const childId of Object.keys(byId)) {
          if (byId[childId]?.parentId !== id) continue
          if (!candidates.includes(childId)) candidates.push(childId)
        }
        for (const childId of candidates) {
          if (seen.has(childId)) continue
          seen.add(childId)
          rows.push(rowOf(childId, depth))
          if (rows.length >= MAX_SUBAGENT_TREE_ROWS) return
          walk(childId, depth + 1)
          if (rows.length >= MAX_SUBAGENT_TREE_ROWS) return
        }
      }
      walk(typeof parentSessionId === 'string' ? parentSessionId : '', 0)

      // 目录诊断行（子会话不可读之类的目录级问题）：没有 childId，不可点，但要看得见。
      for (const entry of diagnostics) {
        if (rows.length >= MAX_SUBAGENT_TREE_ROWS) break
        rows.push({
          key: `diagnostic:${rows.length}:${String(entry.id ?? '')}`,
          childId: '',
          kind: 'diagnostic',
          depth: 0,
          state: 'failed',
          detail: '',
          label: String(entry.reason ?? entry.label ?? entry.id ?? ''),
          mode: '',
        })
      }
      const total = rows.length
      return { rows: total > MAX_SUBAGENT_TREE_ROWS ? rows.slice(0, MAX_SUBAGENT_TREE_ROWS) : rows, total }
    }

    /**
     * 「子代理」下拉菜单：任务视图顶部的一条工具条。
     *
     * **为什么画在这里**：标签栏由核心渲染，`viewTabs()`（`dsh-client-ui-conversation/lib/client.js:16555`）
     * 只产出 `{id, label}`——标签上挂不了菜单；`conversation.view` 的注册形状也没有 actions 字段。
     * 所以菜单放在**任务视图自己的顶部**：它就在标签栏正下方，且只在**这个会话真的有子代理**时才出现。
     *
     * 三条纪律：
     * - 没有子代理 → 整个工具条不渲染（一个像素都不占）；
     * - 不打扰宿主：目录只在「已确认有子代理」或「菜单展开」时才拉（`seat.refreshCatalog()`）；
     * - 点击一行 = `seat.openSubagent(childId)`，走进那个子代理的对话（这条路会切舞台，正是用户要的）。
     *
     * @param props - `seat`（子代理席位）、`sessionId`、`t`、`notices`（结算通知表）。
     * @returns 工具条；没有子代理或席位缺席时返回 `null`。
     */
    function SubagentBar({ seat, sessionId, t, notices }) {
      const usable = seat !== null && seat !== undefined && typeof seat.catalog === 'function'
      const [open, setOpen] = useState(false)
      const [, force] = useState(0)
      const rootRef = useRef(null)
      const data = usable ? seat.catalog() : undefined
      const tree = usable
        ? subagentTreeOf(sessionId, { list: data?.list, catalog: data?.catalog, notices })
        : { rows: [], total: 0 }

      // 列表快照一变就重画（子代理新增、运行态变化都会推）。
      useEffect(() => {
        if (!usable || typeof seat.subscribeCatalog !== 'function') return undefined
        const unsubscribe = seat.subscribeCatalog(() => force((value) => value + 1))
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [usable, seat])

      // Escape 与点外关闭。
      useEffect(() => {
        if (open !== true) return undefined
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onDown = (event) => {
          const node = rootRef.current
          if (node !== null && node !== undefined && typeof node.contains === 'function' && node.contains(event.target)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown)
        }
      }, [open])

      if (!usable || tree.rows.length === 0) return null
      const running = tree.rows.filter((row) => row.state === 'running').length
      const toggle = () => {
        const next = open !== true
        setOpen(next)
        // 展开时拉一次目录：标签/模式/诊断行都在目录里，列表快照给不了。
        if (next && typeof seat.refreshCatalog === 'function') seat.refreshCatalog()
      }
      const rows = []
      for (const row of tree.rows) {
        const stateLabel = t(SUBAGENT_STATE_LABEL[row.state] ?? 'flow.agents.state.unknown')
        rows.push(
          h(
            'button',
            {
              key: row.key,
              type: 'button',
              role: 'menuitem',
              className: 'dcf-agentrow',
              'data-dcf-agentrow': 'true',
              'data-state': row.state,
              'data-depth': String(row.depth),
              'data-kind': row.kind,
              disabled: row.childId === '',
              title: row.detail === '' ? row.label : `${row.label} — ${row.detail}`,
              onClick: () => {
                if (row.childId === '') return
                setOpen(false)
                if (typeof seat.openSubagent === 'function') seat.openSubagent(row.childId)
              },
            },
            h('span', { className: 'dcf-agentlabel' }, row.label),
            row.mode === 'one-shot' || row.mode === 'continuable'
              ? h(
                  'span',
                  { className: 'dcf-agentmode' },
                  t(row.mode === 'one-shot' ? 'flow.agents.mode.oneShot' : 'flow.agents.mode.continuable'),
                )
              : null,
            h(
              'span',
              {
                className: 'dcf-agentstate',
                'data-state': row.state,
                'data-tone': SUBAGENT_STATE_TONE[row.state] ?? 'muted',
                'aria-label': stateLabel,
                title: stateLabel,
              },
              SUBAGENT_STATE_GLYPH[row.state] ?? '○',
            ),
          ),
        )
      }
      return h(
        'div',
        {
          className: 'dcf-agentbar',
          'data-dcf-agentbar': 'true',
          'data-running': running > 0 ? 'true' : 'false',
          ref: rootRef,
        },
        h(
          'div',
          { className: 'dcf-agent' },
          h(
            'button',
            {
              type: 'button',
              className: 'dcf-agenttrigger',
              'data-dcf-agenttrigger': 'true',
              'aria-expanded': open === true,
              onClick: toggle,
            },
            h(
              'span',
              { className: 'dcf-agentglyph', 'data-state': running > 0 ? 'running' : 'idle' },
              running > 0 ? SUBAGENT_STATE_GLYPH.running : SUBAGENT_STATE_GLYPH.unknown,
            ),
            h('span', { className: 'dcf-agenttitle' }, t('flow.agents.title')),
            h(
              'span',
              { className: 'dcf-agentcount' },
              running > 0
                ? t('flow.agents.running', { count: running })
                : t('flow.agents.count', { count: tree.total }),
            ),
            h(Chevron, { open }),
          ),
          open === true
            ? h('div', { className: 'dcf-agentmenu', 'data-dcf-agentmenu': 'true', role: 'menu' }, rows)
            : null,
        ),
      )
    }
