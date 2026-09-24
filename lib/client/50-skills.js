
    /* ──────────────────────────── 技能标签页 ──────────────────────────── */

    function SkillEditor({ draft, onClose, onSubmit, busy }) {
      const [form, setForm] = useState(draft)
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isNew = draft.existing !== true
      return h(
        FormModal,
        {
          title: isNew ? '新建技能' : `编辑技能 · ${draft.id}`,
          onClose,
          busy,
          onSubmit: () => onSubmit(form),
        },
        h(Field, {
          label: '技能名',
          hint: isNew ? 'kebab-case；保存后不可改名。' : '技能名不可修改。',
        }, h('input', { value: form.id, disabled: !isNew, onChange: (e) => patch({ id: e.target.value }), placeholder: '例如：my-helper' })),
        h(Field, { label: '描述' },
          h('input', { value: form.description, onChange: (e) => patch({ description: e.target.value }), placeholder: '一句话说明这个技能解决什么问题、什么时候该用' })),
        h(Field, { label: 'whenToUse' },
          h('input', { value: form.whenToUse ?? '', onChange: (e) => patch({ whenToUse: e.target.value }) })),
        h(Field, { label: '正文' },
          h('textarea', { rows: 7, value: form.body, onChange: (e) => patch({ body: e.target.value }), placeholder: '技能正文…' })),
        h(
          'div',
          { className: 'dcc-row2' },
          h(Toggle, { checked: form.userInvocable !== false, onChange: (value) => patch({ userInvocable: value }), label: '允许手动调用' }),
        ),
      )
    }

    function SkillsTab({ state, act, busy, error }) {
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const [query, setQuery] = useState('')
      const items = state.skills.items.filter((skill) => {
        if (query.trim() === '') return true
        const needle = query.trim().toLowerCase()
        return `${skill.id} ${skill.description} ${skill.whenToUse}`.toLowerCase().includes(needle)
      })
      const openEdit = async (skill) => {
        try {
          const body = await fetchBody('skill', skill.id)
          setEditor({ ...skill, body, existing: true })
        } catch (failure) {
          act.report(failure)
        }
      }
      const offCount = state.skills.items.filter((skill) => skill.enabled === false).length
      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconPlusOutline16, { size: 14 }), onClick: () => setEditor({ id: '', description: '', whenToUse: '', body: '', enabled: true, modelInvocable: true, userInvocable: true }) }, '新建技能'),
          h('span', { className: 'dcc-grow' }, h(Input, { icon: h(IconSearchOutline16, { size: 14 }), placeholder: '搜索技能…', value: query, onChange: (e) => setQuery(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.refresh() }, '刷新'),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: state.paths.skills }, act) }, '打开目录'),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, `对 Agent 启用 ${state.skills.items.length - offCount} 条`),
          offCount === 0 ? null : h('span', null, `已关闭 ${offCount} 条`),
        ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0 ? h(Empty, { text: query.trim() === '' ? '还没有技能。' : '没有匹配的技能。' }) : null,
          ...items.map((skill) =>
            h(Card, {
              key: skill.id,
              off: skill.enabled === false,
              title: skill.id,
              badges: [
                h(Badge, { key: 'kind' }, skill.kind === 'bundle' ? '目录 bundle' : '平铺文件'),
                skill.enabled === false ? h(Badge, { key: 'off', tone: 'warn' }, '不对 Agent 启用') : null,
                skill.modelInvocable === false ? h(Badge, { key: 'm', tone: 'warn' }, '模型不可自动加载') : null,
                skill.userInvocable === false ? h(Badge, { key: 'u', tone: 'warn' }, '不可手动调用') : null,
                skill.warning !== undefined ? h(Badge, { key: 'w', tone: 'warn' }, '名称不一致') : null,
                skill.error !== undefined ? h(Badge, { key: 'err', tone: 'danger' }, '文件损坏') : null,
              ],
              desc: skill.description === '' ? '缺少描述' : skill.description,
              meta: skill.whenToUse === '' ? `${skill.path} · ${(skill.bytes / 1024).toFixed(1)} KB` : `${skill.whenToUse} · ${(skill.bytes / 1024).toFixed(1)} KB`,
              warning: skill.warning,
              error: skill.error,
              actions: h(RowActions, {
                id: skill.id,
                confirming,
                setConfirming,
                busy,
                toggle: h(Toggle, {
                  checked: skill.enabled !== false,
                  onChange: (value) => act.run({ section: 'skill', op: 'toggle', id: skill.id, enabled: value }),
                  label: '',
                }),
                onEdit: () => openEdit(skill),
                onDelete: () => act.run({ section: 'skill', op: 'delete', id: skill.id }),
              }),
            }),
          ),
        ),
        editor === null
          ? null
          : h(SkillEditor, {
              draft: editor,
              busy,
              onClose: () => setEditor(null),
              onSubmit: async (form) => {
                const { ok } = await act.run({ section: 'skill', op: 'save', skill: form })
                if (ok) setEditor(null)
              },
            }),
      )
    }
