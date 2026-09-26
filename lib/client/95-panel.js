
    /* ──────────────── 控制中心整页 + 侧边栏入口 + 会话「规则」视图 ──────────────── */

    const TABS = [
      { id: 'rule', label: '规则', icon: IconContextInjectionOutline16 },
      { id: 'mcp', label: 'MCP 服务器', icon: IconCordisPluginOutline14 },
      { id: 'skill', label: '技能', icon: IconSkillOutline16 },
      { id: 'memory', label: '记忆', icon: IconPersonalizationOutline16 },
      { id: 'scan', label: '导入', icon: IconDownloadOutline16 },
      { id: 'backup', label: '备份', icon: IconArchiveOutline20 },
      { id: 'settings', label: '设置', icon: IconSettingsOutline16 },
    ]

    /**
     * 侧边栏底部入口（`sidebar.footer.action`，正好在「设置」上方）。
     *
     * 这一格是 list 型插槽，「设置」自己是 single 型（已被平台占用），
     * 所以「放在设置旁边」的官方接缝就是它。
     */
    function ControlCenterEntry({ wide }) {
      const panel = usePanelState()
      return h(
        'button',
        {
          type: 'button',
          className: 'dcc-sideentry',
          'data-active': panel.open,
          'data-rail': wide ? undefined : 'true',
          title: '控制中心',
          onClick: () => (panel.open ? panelStore.close() : panelStore.open()),
        },
        h(IconSettingsOutline16, { size: wide ? 16 : 18 }),
        wide ? h('span', null, '控制中心') : null,
      )
    }

    /** 每个标签页右上角的条目数（没有可数的就不显示）。 */
    function tabCount(state, id) {
      if (state === null) return null
      if (id === 'rule') return state.rules.items.length
      if (id === 'mcp') return state.mcp.items.length
      if (id === 'skill') return state.skills.items.length
      if (id === 'memory') return state.memory.items.length
      if (id === 'backup') return state.backup.items.length
      return null
    }

    /**
     * 控制中心整页。
     *
     * 挂在 `shell.overlay`（list 型、root 作用域）上，覆盖整个窗口——所以它是一个**网页**，
     * 而不是设置里的一个弹窗分区，横向空间也宽得多。
     *
     * 顶部留白由 `useTitleBarGuard` 量出来：只在面板顶边真的压到 Windows 窗口按钮那一条时
     * 才补 padding，因此既不会挡住最小化/最大化/关闭，也不会白占一条空白。
     *
     * **这里只管全局规则**：项目规则由会话里的「规则」视图负责（那里的工作区来自会话本身）。
     */
    function ControlCenterPanel() {
      const panel = usePanelState()
      const rootRef = useRef(null)
      const guard = useTitleBarGuard(rootRef)
      const [tab, setTab] = useState('rule')
      const ctl = useController({})
      const { state, error, busy, flash, setFlash, act } = ctl

      // 外部（侧边栏入口）把面板叫起来时，切到它要求的那一页。
      useEffect(() => {
        if (!panel.open) return
        if (panel.tab !== null && panel.tab !== undefined) setTab(panel.tab)
      }, [panel.open, panel.tab])

      // Esc 关闭整页。
      useEffect(() => {
        if (!panel.open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') panelStore.close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [panel.open])

      if (!panel.open) return null

      return h(
        'div',
        { className: 'dcc dcc-panel', ref: rootRef, style: { paddingTop: `${guard.top}px`, paddingLeft: `${guard.left}px` } },
        h(
          'div',
          { className: 'dcc-panel-head' },
          h('h2', { className: 'dcc-title' }, '控制中心'),
          h('div', { className: 'dcc-sub' }, state === null ? '加载中…' : `数据根目录 ${state.root}`),
          h(Button, { variant: 'outline', icon: h(IconCloseOutline16, { size: 14 }), onClick: () => panelStore.close() }, '关闭'),
        ),
        h(
          'div',
          { className: 'dcc-tabs' },
          ...TABS.map((item) =>
            h(
              'button',
              { key: item.id, type: 'button', className: 'dcc-tab', 'data-active': tab === item.id, onClick: () => setTab(item.id) },
              h(item.icon, { size: 14 }),
              item.label,
              tabCount(state, item.id) === null ? null : h('span', { className: 'dcc-count' }, tabCount(state, item.id)),
            ),
          ),
        ),
        h(Toast, { flash, onClose: () => setFlash(null) }),
        state === null
          ? h(Empty, { text: error === null ? '正在读取…' : `读取失败：${error}` })
          : h(
              'div',
              { className: 'dcc-panel-body' },
              tab === 'rule' ? h(RulesSection, { state, act, busy, error, scope: 'global', workspace: '' }) : null,
              tab === 'mcp' ? h(McpTab, { state, act, busy, error }) : null,
              tab === 'skill' ? h(SkillsTab, { state, act, busy, error }) : null,
              tab === 'memory' ? h(MemoryTab, { state, act, busy, error }) : null,
              tab === 'scan' ? h(ScanTab, { state, act, error }) : null,
              tab === 'backup' ? h(BackupTab, { state, act, error }) : null,
              tab === 'settings' ? h(SettingsTab, { state, act, busy, error }) : null,
            ),
      )
    }

    /**
     * 会话里的「规则」视图（`conversation.view`，与「对话」「轨迹」并排）。
     *
     * 这是**项目规则**的唯一编辑入口。编辑的是当前会话工作区的项目规则：
     * host 用 session id 反查工作目录，浏览器侧因此不需要猜会话快照的形状，
     * 用户也不需要自己去挑文件夹。
     */
    function ProjectRulesView({ sessionId }) {
      const ctl = useController({ session: sessionId })
      // 平台的输入框与左右两条宽度拖动边缘跟规则页无关，本页在位时给 <body> 打标记，
      // 由样式表把它们藏起来。必须写在下面那句提前 return 之前，否则两态 hook 数量不一致。
      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        document.body.setAttribute('data-dcc-rules-view', '')
        return () => document.body.removeAttribute('data-dcc-rules-view')
      }, [])
      const { state, error, busy, act } = ctl
      if (state === null) return h(Empty, { text: error === null ? '正在读取项目规则…' : `读取失败：${error}` })
      const workspace = state.project?.workspace ?? ''
      return h(
        'div',
        { className: 'dcc dcc-view' },
        h(Toast, { flash: ctl.flash, onClose: () => ctl.setFlash(null) }),
        h(RulesSection, { state, act, busy, error, scope: 'project', workspace }),
      )
    }
