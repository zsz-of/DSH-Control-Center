
    /* ──────────────────────────── 规则（全局 / 项目） ──────────────────────────── */

    /** 注入模式的两个选项：只给名字，不解释内部机制（用户知道这两个词就够了）。 */
    const RULE_MODES = [
      { id: 'always', label: '强加载' },
      { id: 'ondemand', label: '普通模式' },
    ]

    /** 模式在列表徽标上的显示名。 */
    function modeLabel(mode) {
      return mode === 'always' ? '强加载' : '普通模式'
    }

    /**
     * 「AI 改规则时的审批」三档，顺序即下拉顺序（与 host 侧 `settings.js` 的 `RULE_APPROVALS` 一一对应）。
     *
     * 这是**全局**档位，但项目规则视图与控制中心的规则页共用本组件，所以两个入口都能改——
     * 用户在「项目规则」页看到它才说得通：AI 改的规则里就包括项目规则。
     *
     * 「禁止一次」不在这里：它是「每次询问」时那个弹框上的一个按钮（只拒这一次，档位不动）。
     */
    const RULE_APPROVAL_CHOICES = [
      ['ask', '每次询问'],
      ['allow', '始终允许'],
      ['deny-always', '禁止且不再询问'],
    ]

    /** 选中某一档时的解释：说清「接下来会发生什么」。 */
    const RULE_APPROVAL_HINTS = {
      ask: 'AI 每次要改规则都弹框问你：本轮对话中始终允许 / 此工作区内始终允许 / 禁止一次 / 禁止且不再询问。',
      allow: 'AI 可以直接改规则，不再问你。',
      'deny-always': '一律拒绝 AI 改规则，不再询问；想恢复就改回「每次询问」。',
    }

    function RuleEditor({ draft, onClose, onSubmit, busy, scopeLabel }) {
      const [form, setForm] = useState(draft)
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isNew = draft.file === undefined
      return h(
        FormModal,
        {
          title: `${isNew ? '新建' : '编辑'}${scopeLabel === undefined ? '' : scopeLabel}规则`,
          onClose,
          busy,
          wide: true,
          onSubmit: () => onSubmit(form),
        },
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '名称' }, h('input', { value: form.name, onChange: (e) => patch({ name: e.target.value }), placeholder: '例如：驾驭工程核心规则' })),
          h(Field, { label: '描述' },
            h('input', { value: form.description, onChange: (e) => patch({ description: e.target.value }), placeholder: '一句话说清这条规则管什么' })),
        ),
        h(
          Field,
          { label: '模式' },
          h(
            'div',
            { className: 'dcc-modes' },
            ...RULE_MODES.map((mode) =>
              h(
                'div',
                { key: mode.id, className: 'dcc-mode', 'data-on': form.mode === mode.id, onClick: () => patch({ mode: mode.id }) },
                h('span', { className: 'dcc-dot' }),
                mode.label,
              ),
            ),
          ),
        ),
        h(Field, { label: '正文', hint: draft.file === undefined ? undefined : draft.path },
          h('textarea', { rows: 16, value: form.body, onChange: (e) => patch({ body: e.target.value }), placeholder: '规则正文…' })),
      )
    }

    /**
     * 规则列表 + 编辑，按作用域参数化。
     *
     * 全局规则（`~/.dsh/rules`）与项目规则（`<工作区>/.dsh/rules`）格式完全一样，
     * 所以整个界面只写一份：`scope` 决定读写哪个目录，`workspace` 决定是哪个项目。
     *
     * **作用域不是在这里切的**：控制中心只呈现全局规则，项目规则由会话里的「规则」视图负责
     * （那里的工作区来自会话本身，用户不必自己挑文件夹）。本组件因此不接受切换回调——
     * 作用域是调用方的事实，不是这一页的选项。
     *
     * @param props.scope - `'global'` 或 `'project'`。
     * @param props.workspace - 项目规则的工作区目录（scope=project 时用）。
     */
    function RulesSection({ state, act, busy, error, scope, workspace }) {
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const isProject = scope === 'project'
      const project = state.project
      const dir = isProject ? (project?.dir ?? '') : state.paths.rules
      const items = (isProject ? (project?.items ?? []) : state.rules.items).filter((rule) => {
        if (query.trim() === '') return true
        const needle = query.trim().toLowerCase()
        return `${rule.name} ${rule.description} ${rule.file}`.toLowerCase().includes(needle)
      })
      // 每个写操作都要带作用域：host 靠它决定落哪个目录。
      const scoped = (payload) => ({ ...payload, ...(isProject ? { scope: 'project', workspace } : {}) })

      // 「AI 改规则时的审批」存在插件设置里（全局档位，不分作用域）。
      const approval = state.settings?.rules?.approval ?? 'ask'
      const setApproval = async (value) => {
        const { ok } = await act.run({ section: 'settings', op: 'save', settings: { rules: { approval: value } } })
        if (ok) act.flash(`AI 改规则时的审批已设为「${RULE_APPROVAL_CHOICES.find(([id]) => id === value)?.[1] ?? value}」。`)
      }

      // 「此工作区内始终允许」豁免过的工作区：在审批弹框上点出来的，存在插件设置里。
      const exempt = state.settings?.rules?.allowedWorkspaces ?? []
      const clearExempt = async () => {
        const { ok } = await act.run({ section: 'settings', op: 'save', settings: { rules: { allowedWorkspaces: [] } } })
        if (ok) act.flash('已清除工作区豁免，AI 改规则会重新问你。')
      }

      const openCreate = () => setEditor({ name: '', description: '', mode: isProject ? 'always' : 'ondemand', enabled: true, body: '' })
      const openEdit = async (rule) => {
        try {
          const body = await fetchBody('rule', rule.file, isProject ? { workspace } : {})
          setEditor({ ...rule, body, enabled: rule.enabled !== false })
        } catch (failure) {
          act.report(failure)
        }
      }

      return h(
        'div',
        { className: 'dcc-layout' },
        isProject ? h('div', { className: 'dcc-pathbar' }, workspace === '' ? '这个会话还没有工作区' : `项目：${workspace}`) : null,
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconPlusOutline16, { size: 14 }), disabled: isProject && workspace === '', onClick: openCreate }, '新建规则'),
          h('span', { className: 'dcc-grow' }, h(Input, { icon: h(IconSearchOutline16, { size: 14 }), placeholder: '搜索规则…', value: query, onChange: (e) => setQuery(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.refresh() }, '刷新'),
          dir === '' ? null : h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: dir }, act) }, '打开目录'),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, `${isProject ? '项目' : '全局'}启用 ${isProject ? (project?.activeCount ?? 0) : state.rules.activeCount} 条`),
          h('span', null, `注入占用 ${(((isProject ? (project?.injectBytes ?? 0) : state.rules.injectBytes) || 0) / 1024).toFixed(1)} KB`),
        ),
        h(
          'div',
          { className: 'dcc-switchrow' },
          h(
            'div',
            { className: 'dcc-col' },
            h(Field, { label: 'AI 改规则时的审批', hint: RULE_APPROVAL_HINTS[approval] },
              h(
                'select',
                { value: approval, disabled: busy === true, onChange: (event) => setApproval(event.target.value) },
                ...RULE_APPROVAL_CHOICES.map(([id, label]) => h('option', { key: id, value: id }, label)),
              )),
          ),
        ),
        exempt.length === 0
          ? null
          : h(
              'div',
              { className: 'dcc-switchrow' },
              h(
                'div',
                { className: 'dcc-col' },
                h('span', { className: 'dcc-name' }, '已豁免的工作区'),
                h('span', { className: 'dcc-hint' }, `${exempt.join('、')} —— 这些工作区里 AI 改规则不再问你。`),
              ),
              h(Button, { variant: 'outline', disabled: busy === true, onClick: clearExempt }, '清除'),
            ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0
            ? h(Empty, { text: isProject && workspace === '' ? '这个会话还没有工作区。' : query.trim() === '' ? '还没有规则。点「新建规则」开始。' : '没有匹配的规则。' })
            : null,
          ...items.map((rule) =>
            h(Card, {
              key: rule.file,
              off: rule.enabled !== true,
              title: rule.name,
              badges: [
                h(Badge, { key: 'mode', tone: rule.mode === 'always' ? 'always' : 'plain' }, modeLabel(rule.mode)),
                rule.enabled !== true ? h(Badge, { key: 'off', tone: 'warn' }, '已停用') : null,
                rule.error !== undefined ? h(Badge, { key: 'bad', tone: 'danger' }, '文件损坏') : null,
              ],
              desc: rule.description,
              meta: `${rule.file} · ${(rule.bytes / 1024).toFixed(1)} KB`,
              error: rule.error,
              actions: h(RowActions, {
                id: rule.file,
                confirming,
                setConfirming,
                busy,
                toggle: h(Toggle, {
                  checked: rule.enabled === true,
                  onChange: (value) => act.run(scoped({ section: 'rule', op: 'toggle', file: rule.file, enabled: value })),
                  label: '',
                }),
                onEdit: () => openEdit(rule),
                onDelete: () => act.run(scoped({ section: 'rule', op: 'delete', file: rule.file })),
              }),
            }),
          ),
        ),
        editor === null
          ? null
          : h(RuleEditor, {
              draft: editor,
              busy,
              scopeLabel: isProject ? '项目' : undefined,
              onClose: () => setEditor(null),
              onSubmit: async (form) => {
                const { ok } = await act.run(scoped({ section: 'rule', op: 'save', rule: form }))
                if (ok) setEditor(null)
              },
            }),
      )
    }
