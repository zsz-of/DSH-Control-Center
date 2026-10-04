
    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册控制中心整页、侧边栏入口、输入框优化按钮与会话「规则」视图。
     *
     * 各插槽的出现时机由宿主决定，所以统一用 `slots.inject(name, cb)`——
     * 它在目标插槽就绪时才执行 cb，因此这里不关心加载顺序。
     * 输入框与会话视图需要 `conversation` 服务，放在 `ctx.inject(['conversation'])` 里注册：
     * 该服务缺失时（非 web 组合）整页与侧边栏入口照旧可用，只是少了这两处扩展。
     */
    /**
     * 给控制中心自己的审批提问卡打上 `data-dcc-rule-ask`，由样式表把它画成带淡黄警示条的
     * 显眼卡（平台默认那张是无色输入卡，四档选项挤在灰底上很容易点错档位）。
     *
     * 卡片由平台的「提问」通道渲染，本插件拿不到它的组件树，只能用 DOM 观察认领；
     * 判据是卡片开头的文字——插件问的每张卡，header 都以「控制中心」开头。
     */
    function watchRuleAskCards() {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
      if (document.body === null || typeof document.querySelectorAll !== 'function') return
      let pending = false
      const mark = () => {
        pending = false
        document.querySelectorAll('[data-question-key]').forEach((frame) => {
          if (frame.getAttribute('data-dcc-rule-ask') === '1') return
          const head = (frame.textContent ?? '').slice(0, 60)
          if (head.includes('控制中心')) frame.setAttribute('data-dcc-rule-ask', '1')
        })
      }
      const schedule = () => {
        if (pending) return
        pending = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mark)
        else setTimeout(mark, 0)
      }
      mark()
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    }

    function apply(ctx) {
      installStyles()
      watchRuleAskCards()
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ name: 'sidebar.footer.action', id: 'control-center-entry', priority: 50 }, ControlCenterEntry),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'control-center-panel', priority: 50 }, ControlCenterPanel),
      )
      ctx.inject(['conversation'], (conversationCtx) => {
        conversationCtx.slots.inject('conversation.view', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.view',
              // priority 5：夹在「对话」(0) 与「轨迹」(10) 之间。NEXT 的 slots.register 只认 priority。
              id: 'control-center-rules',
              priority: 5,
              label: () => '规则',
              inject: (sessionId) => ({ sessionId }),
            },
            ProjectRulesView,
          ),
        )
        conversationCtx.slots.inject('conversation.input.right', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'control-center-optimize',
              priority: 400,
              inject: (sessionId) => ({ sessionId }),
            },
            OptimizeButton,
          ),
        )
        conversationCtx.slots.inject('conversation.input.overlay', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'control-center-optimize-veil',
              priority: 10,
              inject: (sessionId) => ({ sessionId }),
            },
            ComposerVeil,
          ),
        )
      })

      // 「会话删除」页要读会话列表、把删掉的行从列表里摘走。两样都只有插件 ctx 里才有，
      // 所以在这里显式接进去（平台没有删会话的 API，磁盘文件由 host 半侧删，行只能这样摘）。
      connectSessionServices({
        list: ctx.sessions?.list ?? null,
        remove: (sessionId) => ctx.sessions?.handleSessionRemoved?.(sessionId),
      })
    }

    exports.apply = apply
    /** 注入面：`slots`（插槽注册）+ `sessions`（会话列表与删行）。 */
    exports.inject = inject
    /**
     * 测试接缝：`test/client-bundle.test.js` / `test/client-render-react.test.js` 在 node 侧
     * 把浏览器半侧跑起来时，需要直接拿到各页面组件（渲染器里 effect 不会真的跑，
     * 没法靠点界面走到它们）。仅此导出，不对外使用。
     */
    exports.__internals = {
      withDefaults,
      panelStore,
      // 认领平台「提问」卡片的 DOM 观察器：靠 DOM 认领，只能这样测（SSR 下没有真 DOM）。
      dom: { watchRuleAskCards },
      // 「会话删除」页的纯逻辑（行怎么切、子代理怎么归族）：渲染测试点不动删除按钮，
      // 而这两个函数的判据（只列顶层会话、按父链递归收子代理）正是页面正确性的全部。
      sessions: { connectSessionServices, readSessionSnapshot, sessionRowsOf, sessionSubagentIds, formatSessionTime },
      tabs: { RulesSection, McpTab, SkillsTab, MemoryTab, ScanTab, BackupTab, SettingsTab, SessionsTab, ProjectRulesView, ControlCenterPanel, ControlCenterEntry },
      composer: {
        OptimizeButton,
        ComposerVeil,
        // 撤销按钮的显示条件是个纯函数，测试直接断言它（effect 在 SSR 下不跑，见上）。
        canUndoOptimize,
        // 这两个 store 也是给测试的：渲染测试要把「优化失败」这类状态**种进去**才能验它可点、
        // 可读——它们靠 effect 与网络才进得来，SSR 下走不到。
        optimizeStore,
        flagsStore,
      },
    }
    return module.exports
  },
})
