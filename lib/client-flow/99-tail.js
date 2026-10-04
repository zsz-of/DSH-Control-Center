    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册任务视图。
     *
     * **视图内容分两层**：
     * - **层级是插槽的**：回合分组 / 任务阶段折叠 / 任务列表快照 / 子任务 / 右侧导轨，全部由本插件画；
     * - **叶子是核心的**：每一行节点都经 `renderSlot('conversation.chat.node', …)` 交给核心的原生
     *   条目渲染（命令卡、差异块、读取块、搜索块、提问卡、思考行…），只有座位缺席或渲染失败时才
     *   退化成自绘叶子（见 `lib/client/55-native.js`）。
     *
     * 声明 `children` 有两层作用：一是渲染器**只有看到 children 才会给出 `renderSlot`**
     * （`dsh-client-ui-renderer/lib/client.js:613-621`），二是顺带拿到会话作用域的 `SessionProvider`。
     * 详见 {@link nativeViewChildren} 里的注释（含核心行号依据）。
     *
     * **为什么用独立 id（不再遮蔽核心「对话」）**：视图选择的 fallback 硬编码为
     * 「存储的偏好 → `id === 'chat'` → 否则不渲染」。遮蔽（同 id + 更低 priority）能让本视图
     * 成为默认，但核心条目仍在账本里，而标签栏读的正是账本 → 两个标签、两个都带激活下划线。
     * 核心**不允许注销别人的条目**，所以遮蔽必然留下重复标签；改用独立 id 后标签栏只有一个高亮，
     * 原生「对话」仍是默认，需要任务流时点「任务」标签（选择持久化）。
     *
     * @param ctx - 客户端插件上下文。
     * @returns 无。
     */function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-flow: dictionaries')
      const t = ctx.locale.bind(NS)

      /**
       * 会话被删掉之后，把本插件给那个会话留下的存储痕迹一起带走。
       *
       * **为什么挂在插件级而不是任务视图里**：视图级的清理只在「任务」标签页挂着时跑，
       * 而用户完全可能在原生「对话」视图（或根本没打开任何一个会话）里删掉某个会话——
       * 那时残留的 `localStorage` 折叠表与 `sessionStorage` 滚动记录会一直留着。
       * 这里直接盯会话列表快照：会话列表是唯一能观察到「某个 id 已经不在世上」的接缝
       * （核心没有删除事件，只有 `api-session/removed`，那只有列表被踢掉之后才来）。
       *
       * **代价说清楚**：判据是「存储里有键、列表里没这个 id」（`staleSessionIds`），
       * 它自带「列表为空一律不动手」的护栏（重连时列表会短暂变空，那不是删除）。
       * 极端情况下（会话还活着、但这一轮快照里恰好没有它）会误清一份 UI 状态——
       * 本插件只存折叠与滚动位置，误清最多是观感回退；相比之下「删了会话却留下痕迹」
       * 是用户明确要求避免的（「删除要彻底移除文件，不留残余」）。
       *
       * @returns 取消订阅的函数。
       */
      ctx.effect(() => {
        const list = ctx.sessions?.list
        if (list === undefined || list === null || typeof list.subscribe !== 'function') return () => {}
        const sweep = () => {
          const snapshot = typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
          const ids = snapshot?.ids
          if (!Array.isArray(ids)) return
          for (const stale of staleSessionIds(window, new Set(ids))) {
            purgeSessionData(stale, window)
            forgetCollapse(stale)
          }
        }
        const unsubscribe = list.subscribe(sweep)
        sweep()
        return typeof unsubscribe === 'function' ? unsubscribe : () => {}
      }, 'chat-flow: purge deleted sessions')
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: TAB_VIEW_ID,
            order: TAB_VIEW_ORDER,
            label: () => t('view.flow'),
            locale: NS,
            children: nativeViewChildren(),
            inject: (sessionId) => ({
              sessionId,
              /**
               * 拉更早的历史页。
               *
               * **必须把核心的 promise 交出去**（返回它），不能吞掉：滚动层靠「这次加载落地之后
               * 窗口有没有真的变长」来决定要不要继续补页，而核心的 `loadOlder` 可能在
               * 「什么都没加载」的情况下照样 resolve（请求赶在窗口安装前发出 → 拿回一页重复记录
               * → 组装器按 seq 去重 → 界面纹丝不动）。吞掉返回值，滚动层就失去了唯一的落地信号，
               * 只能等下一次无关的渲染，于是表现为用户报的「加载之后没有任何新内容」。
               *
               * 仍然**不抛异常**：会话 binding 可能已经释放（切走会话的竞态），
               * 取不到时返回一个已 resolve 的 promise，让滚动层的补页预算去处理这种「空转」。
               *
               * @returns 加载落地的 promise（永不 reject），仅供「落地后重算」使用，成功与否要回看窗口。
               */
              loadOlder: () => {
                try {
                  return ctx.sessions.binding(sessionId)?.session.loadOlder() ?? Promise.resolve()
                } catch {
                  // 会话已释放：返回已 resolve 的 promise，调用方按「没加载到」处理。
                  return Promise.resolve()
                }
              },
              /**
               * 翻页加载到指定 seq（导轨点未加载回合用）。
               *
               * 与 `loadOlder` 的差别：它内部**循环**加载直到窗口覆盖该 seq（每页 200 条），
               * 全程把 `loadingOlder` 置真，且返回的 promise **永不 reject**（失败也 resolve）。
               * 因此调用方不能拿「promise 完成」当成功，必须回看目标回合是否已加载。
               */
              loadThrough: (seq) => {
                try {
                  return ctx.sessions.binding(sessionId)?.session.loadThrough(seq) ?? Promise.resolve()
                } catch {
                  // 会话已释放：立即 resolve，调用方按「没加载到」处理。
                  return Promise.resolve()
                }
              },
              // 原生叶子需要的主人/注入能力（openFile / loadImage / fileMentions / forkAt）。
              ...nativeSeatFace(ctx, sessionId),
              /**
               * 子代理席位：给子代理卡内联读「子会话自己的过程」用（见 `58-subagent.js`）。
               *
               * 放在这里而不是 `nativeSeatFace` 里：后者是「原生叶子需要的主人参数」，
               * 这一项只服务本插件自绘的子代理卡。
               */
              agentSeat: subagentSeatFace(ctx, sessionId),
            }),
          },
          TaskFlowView,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    /**
     * 测试接缝：纯函数与常量直接暴露，node 侧测试不必模拟整套插槽就能验证派生逻辑，
     * 也能逐字断言注册参数（id / priority / order）。
     */
    exports.__internals = {
      TAB_VIEW_ID,
      TAB_VIEW_ORDER,
      NS,
      ZH,
      EN,
      NATIVE_NODE_SLOT,
      NATIVE_IMAGES_SLOT,
      OWN_SEAT_SLOT,
      OWNED_NODE_KINDS,
      nativeViewChildren,
      nativeSeatFace,
      subagentSeatFace,
      SubagentSeatContext,
      subagentRowsOf,
      subagentRowOf,
      useSubagentChat,
      MAX_SUBAGENT_ROWS,
      MAX_SUBAGENT_TREE_ROWS,
      MAX_SUBAGENT_TREE_DEPTH,
      SUBAGENT_STATES,
      SUBAGENT_STATE_GLYPH,
      SUBAGENT_STATE_TONE,
      subagentStateOfSettlement,
      subagentTreeOf,
      shortChildId,
      resolveSeatPath,
      turnDataOfNode,
      turnOfChatNode,
      seatNodesOf,
      rowModelsOf,
      categoryOfTool,
      cardKindOfTool,
      statsOfNodes,
      statsSummary,
      describeStats,
      summarizeToolCall,
      diffCountsOf,
      parseCommandOutcome,
      toolStatusOf,
      toolCardOf,
      processEntries,
      nodeRowOf,
      groupProcessNodes,
      cutOffOf,
      observedRpcIdsOf,
      pendingSeatsOf,
      nodeRunsOf,
      isTopLevelNode,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      diffTodos,
      MAX_JSON_PARSE_CHARS,
      MAX_RENDER_CHARS,
      clampText,
      parseJsonSafe,
      SUMMARY_TOOL_NAME,
      isSummaryMarkTool,
      isSummaryMarkNode,
      summaryMarkIndexOf,
      trailingAnswerOf,
      assistantTextOf,
      formatDuration,
      markdownLabels,
      terminalLabels,
      installStyles,
      jumpToTurn,
      TOP_LOAD_THRESHOLD_PX,
      BOTTOM_THRESHOLD_PX,
      isAwayFromBottom,
      scrollViewToBottom,
      SCROLL_RESTORE_MAX_FRAMES,
      MAX_CATCHUP_PAGES,
      MAX_JUMP_REPAGES,
      SCROLL_PIN_MAX_FRAMES,
      isLoadAnchorVisible,
      isDocumentVisible,
      readScrollState,
      applyScrollState,
      restoreScrollState,
      encodeScrollState,
      decodeScrollState,
      bottomScrollState,
      SESSION_KEY_PREFIXES,
      purgeSessionData,
      staleSessionIds,
      collapseEntry,
      forgetCollapse,
      useScroller,
      useTick,
      mergeRailItems,
      scrollRailToBottom,
      FLOW_CSS,
      /** 用户发言的行内渲染（平台的 `projectUserText` 投影，原语缺席时退回纯文本）。 */
      UserText,
      views: {
        TaskFlowView,
        FlowBody,
        ViewBodyBoundary,
        TurnGroup,
        TurnRail,
        SnapshotPlate,
        TaskFold,
        ThinkingBlock,
        NodeSequence,
        PendingBubble,
        NativeSeat,
        NativeNodeRow,
        ChatFlowLeaf,
        ContextFold,
        Fold,
        ToolCard,
        SubagentCard,
        SubagentProcess,
        SubagentBar,
        Card,
        DisclosureLine,
        UserBubble,
        AssistantText,
        TruncationNote,
        ClampedPre,
      },
    }

