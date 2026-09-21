
    /* ──────────────────────────── 记忆标签页 ──────────────────────────── */

    function MemoryEditor({ draft, onClose, onSubmit, busy }) {
      const [form, setForm] = useState({
        ...draft,
        tagsText: (draft.tags ?? []).join(', '),
      })
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isNew = draft.file === undefined
      return h(
        FormModal,
        {
          title: isNew ? '新建记忆' : '编辑记忆',
          onClose,
          busy,
          wide: true,
          onSubmit: () =>
            onSubmit({
              ...form,
              tags: form.tagsText.split(/[,，、]/).map((tag) => tag.trim()).filter((tag) => tag !== ''),
              workspace: form.scope === 'workspace' ? form.workspace : '',
            }),
        },
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '标题' },
            h('input', { value: form.name, onChange: (e) => patch({ name: e.target.value }), placeholder: '例如：回答一律用中文' })),
          h(Field, { label: '标签' },
            h('input', { value: form.tagsText, onChange: (e) => patch({ tagsText: e.target.value }), placeholder: '偏好, 语言' })),
        ),
        h(Field, { label: '描述' },
          h('input', { value: form.description, onChange: (e) => patch({ description: e.target.value }), placeholder: '例如：用户要求所有回答与代码注释都用中文' })),
        h(
          Field,
          { label: '作用域' },
          h(
            'div',
            { className: 'dcc-modes' },
            ...[['global', '全局'], ['workspace', '项目']].map(([scope, title]) =>
              h(
                'div',
                { key: scope, className: 'dcc-mode', 'data-on': form.scope === scope, onClick: () => patch({ scope }) },
                h('span', { className: 'dcc-dot' }),
                title,
              ),
            ),
          ),
        ),
        form.scope === 'workspace'
          ? h(Field, { label: '项目目录' },
              h('input', { value: form.workspace ?? '', onChange: (e) => patch({ workspace: e.target.value }), placeholder: 'D:\\Code\\MyProject' }))
          : null,
        h(Field, { label: '内容' },
          h('textarea', { rows: 10, value: form.body, onChange: (e) => patch({ body: e.target.value }), placeholder: '例如：本机 Python 一律用 uv 管理依赖，不要用 pip 直接装。' })),
        h(
          'div',
          { className: 'dcc-row2' },
          h(Toggle, { checked: form.pinned === true, onChange: (value) => patch({ pinned: value }), label: '置顶' }),
          h(Toggle, { checked: form.enabled !== false, onChange: (value) => patch({ enabled: value }), label: '启用' }),
        ),
      )
    }

    function MemoryTab({ state, act, busy, error }) {
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const memory = state.memory
      const items = memory.items.filter((item) => {
        if (query.trim() === '') return true
        const needle = query.trim().toLowerCase()
        return `${item.name} ${item.description} ${item.tags.join(' ')} ${item.workspace}`.toLowerCase().includes(needle)
      })
      const openEdit = async (item) => {
        try {
          const body = await fetchBody('memory', item.file)
          setEditor({ ...item, body })
        } catch (failure) {
          act.report(failure)
        }
      }
      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, {
            variant: 'primary',
            icon: h(IconPlusOutline16, { size: 14 }),
            onClick: () => setEditor({ name: '', description: '', scope: 'global', workspace: '', tags: [], tagsText: '', body: '', pinned: false, enabled: true }),
          }, '新建记忆'),
          h('span', { className: 'dcc-grow' }, h(Input, { icon: h(IconSearchOutline16, { size: 14 }), placeholder: '搜索记忆…', value: query, onChange: (e) => setQuery(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.refresh() }, '刷新'),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ dir: state.paths.memory }, act) }, '打开目录'),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, memory.injectEnabled ? '已开启注入' : '注入已关闭'),
          h('span', null, `启用 ${memory.enabledCount} 条 · 全局 ${memory.globalCount} · 项目 ${memory.workspaceCount}`),
          h('span', null, `占用 ${(memory.injectBytes / 1024).toFixed(1)} KB`),
        ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0 ? h(Empty, { text: query.trim() === '' ? '还没有记忆。' : '没有匹配的记忆。' }) : null,
          ...items.map((item) =>
            h(Card, {
              key: item.file,
              off: item.enabled !== true,
              title: item.name,
              badges: [
                item.pinned === true ? h(Badge, { key: 'p', tone: 'always' }, '置顶') : null,
                h(Badge, { key: 's', tone: item.scope === 'workspace' ? 'always' : 'plain' }, item.scope === 'workspace' ? '项目' : '全局'),
                item.source === 'auto' ? h(Badge, { key: 'a' }, 'AI 提炼') : null,
                item.enabled !== true ? h(Badge, { key: 'o', tone: 'warn' }, '已停用') : null,
                item.error !== undefined ? h(Badge, { key: 'e', tone: 'danger' }, '文件损坏') : null,
              ],
              desc: item.description === '' ? '未填描述' : item.description,
              meta: `${item.scope === 'workspace' ? `${item.workspace} · ` : ''}${item.file} · ${formatBytes(item.bytes)} · 更新于 ${formatTime(item.updatedAt)}`,
              error: item.error,
              actions: h(RowActions, {
                id: item.file,
                confirming,
                setConfirming,
                busy,
                extras: [
                  h(Button, {
                    key: 'pin',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: () => act.run({ section: 'memory', op: 'pin', file: item.file, pinned: item.pinned !== true }),
                  }, item.pinned === true ? '取消置顶' : '置顶'),
                ],
                toggle: h(Toggle, {
                  checked: item.enabled === true,
                  onChange: (value) => act.run({ section: 'memory', op: 'toggle', file: item.file, enabled: value }),
                  label: '',
                }),
                onEdit: () => openEdit(item),
                onDelete: () => act.run({ section: 'memory', op: 'delete', file: item.file }),
              }),
            }),
          ),
        ),
        editor === null
          ? null
          : h(MemoryEditor, {
              draft: editor,
              busy,
              onClose: () => setEditor(null),
              onSubmit: async (form) => {
                const { ok } = await act.run({ section: 'memory', op: 'save', memory: form })
                if (ok) setEditor(null)
              },
            }),
      )
    }
