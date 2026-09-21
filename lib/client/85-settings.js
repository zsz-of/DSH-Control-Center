
    /* ──────────────────────────── 设置标签页 ──────────────────────────── */

    function SettingsTab({ state, act, busy, error }) {
      const [form, setForm] = useState(() => JSON.parse(JSON.stringify(state.settings)))
      const [routes, setRoutes] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [advancedOpen, setAdvancedOpen] = useState(false)
      const [custom, setCustom] = useState({ id: '', label: '', kind: 'json', path: '', mcpKey: '', section: '' })

      useEffect(() => {
        let alive = true
        getJson('/routes')
          .then((payload) => {
            if (!alive) return
            setRoutes(payload.routes)
          })
          .catch(() => {
            if (alive) setRoutes([])
          })
        return () => {
          alive = false
        }
      }, [])

      const patch = (group, values) => {
        setForm((previous) => ({ ...previous, [group]: { ...previous[group], ...values } }))
        setDirty(true)
      }

      const save = async () => {
        const { ok } = await act.run({ section: 'settings', op: 'save', settings: form })
        if (ok) {
          setDirty(false)
          // 输入框上的优化按钮读的是 /flags 缓存：保存后强制刷新，按钮立刻跟着开关变。
          loadFlags(true)
          act.flash({ tone: 'ok', text: '设置已保存。' })
        }
      }

      const reset = () => {
        setForm(JSON.parse(JSON.stringify(state.settings)))
        setDirty(false)
      }

      const providerOptions = routes === null ? [] : [...new Set(routes.map((route) => route.provider))]
      const modelOptions = routes === null ? [] : routes.filter((route) => route.provider === form.optimize.provider)

      const toggleSource = (id) =>
        patch('scan', {
          disabled: form.scan.disabled.includes(id) ? form.scan.disabled.filter((item) => item !== id) : [...form.scan.disabled, id],
        })

      const addCustom = () => {
        if (custom.id.trim() === '' || custom.path.trim() === '') {
          act.report(new Error('自定义源至少要填 id 与路径'))
          return
        }
        patch('scan', {
          custom: [
            ...form.scan.custom,
            {
              id: custom.id.trim(),
              label: custom.label.trim(),
              kind: custom.kind,
              path: custom.path.trim(),
              ...(custom.mcpKey.trim() === '' ? {} : { mcpKey: custom.mcpKey.trim() }),
              ...(custom.section.trim() === '' ? {} : { section: custom.section.trim() }),
            },
          ],
        })
        setCustom({ id: '', label: '', kind: 'json', path: '', mcpKey: '', section: '' })
      }

      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', disabled: busy || !dirty, onClick: save }, dirty ? '保存设置' : '已保存'),
          h(Button, { variant: 'outline', disabled: !dirty, onClick: reset }, '放弃改动'),
          h('span', { className: 'dcc-grow' }),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ dir: state.paths.config }, act) }, '打开配置目录'),
        ),
        h(ErrorLine, { text: error }),

        h(
          'div',
          { className: 'dcc-list' },
          /* ── 提示词优化 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconSparkle16, { size: 14 }), '输入框上的 AI 提示词优化'),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '启用优化按钮'),
                  state.optimize.available ? null : h('div', { className: 'dcc-hint' }, 'LLM 服务未就绪，按钮当前不可用。')),
                h(Toggle, { checked: form.optimize.enabled, onChange: (value) => patch('optimize', { enabled: value }), label: '' }),
              ),
              h(
                'div',
                { className: 'dcc-row2', style: { marginTop: '8px' } },
                h(Field, { label: 'provider' },
                  h(
                    'select',
                    { value: form.optimize.provider, onChange: (e) => patch('optimize', { provider: e.target.value, model: '' }) },
                    h('option', { value: '' }, '跟随默认模型'),
                    ...providerOptions.map((id) => h('option', { key: id, value: id }, id)),
                  )),
                h(Field, { label: 'model' },
                  h(
                    'select',
                    { value: form.optimize.model, onChange: (e) => patch('optimize', { model: e.target.value }) },
                    h('option', { value: '' }, '跟随默认模型'),
                    ...modelOptions.map((route) => h('option', { key: route.model, value: route.model }, route.modelName ?? route.model)),
                  )),
              ),
              h(Toggle, {
                checked: advancedOpen,
                onChange: setAdvancedOpen,
                label: '高级选项',
              }),
              advancedOpen
                ? h(
                    'div',
                    { className: 'dcc-row2', style: { marginTop: '6px' } },
                    h(Field, { label: '思考强度' },
                      h('input', { value: form.optimize.reasoningEffort, onChange: (e) => patch('optimize', { reasoningEffort: e.target.value }), placeholder: '留空 = 关闭思考' })),
                    h(Field, { label: '自定义提示词' },
                      h('input', { value: form.optimize.prompt, onChange: (e) => patch('optimize', { prompt: e.target.value }), placeholder: '留空 = 内置提示词' })),
                  )
                : null,
            ),
          ),

          /* ── 记忆 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconPersonalizationOutline16, { size: 14 }), '长期记忆'),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '启用记忆功能'),
                  form.memory.enabled ? null : h('div', { className: 'dcc-hint' }, '「记忆」标签页只做展示，新记忆不再写入。')),
                h(Toggle, { checked: form.memory.enabled, onChange: (value) => patch('memory', { enabled: value }), label: '' }),
              ),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '把记忆注入每个会话'),
                  h('div', { className: 'dcc-hint' }, `预算 ${(state.budget.memory / 1024).toFixed(1)} KB`)),
                h(Toggle, { checked: form.memory.inject, onChange: (value) => patch('memory', { inject: value }), label: '' }),
              ),
            ),
          ),

          /* ── 备份 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconArchiveOutline20, { size: 15 }), '备份'),
              h(
                'div',
                { className: 'dcc-row2', style: { marginTop: '6px' } },
                h(Field, { label: '备份目录保留份数', hint: '填 0 表示不自动清理' },
                  h('input', {
                    type: 'number',
                    min: 0,
                    value: String(form.backup.retention),
                    onChange: (e) => patch('backup', { retention: Number(e.target.value) }),
                  })),
                h(Field, { label: '恢复前自动快照' },
                  h(Toggle, { checked: form.backup.snapshotBeforeImport, onChange: (value) => patch('backup', { snapshotBeforeImport: value }), label: '导入备份前先另存一份当前配置' })),
              ),
            ),
          ),

          /* ── 扫描源 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconDownloadOutline16, { size: 14 }), '扫描别的客户端'),
              h(
                'div',
                { className: 'dcc-grid', style: { marginTop: '6px' } },
                ...state.scan.sources.map((source) =>
                  h(
                    PickCard,
                    {
                      key: source.id,
                      on: !form.scan.disabled.includes(source.id),
                      onToggle: () => toggleSource(source.id),
                    },
                    h('div', { className: 'dcc-name' }, source.label, h(Badge, { key: 'i' }, source.id)),
                  ),
                ),
              ),
              h('div', { className: 'dcc-name', style: { marginTop: '10px' } }, '自定义扫描源', h(Badge, { key: 'n' }, `${form.scan.custom.length} 个`)),
              form.scan.custom.length === 0
                ? h('div', { className: 'dcc-hint' }, '没有自定义源。')
                : h(
                    'div',
                    { className: 'dcc-grid' },
                    ...form.scan.custom.map((source, index) =>
                      h(
                        'div',
                        { key: `${source.id}-${index}`, className: 'dcc-pick dcc-pick-static', 'data-on': true },
                        h(
                          'div',
                          { className: 'dcc-narrow' },
                          h('div', { className: 'dcc-name' }, source.label === '' ? source.id : source.label, h(Badge, { key: 'k' }, source.kind)),
                          h('div', { className: 'dcc-meta' }, source.path),
                        ),
                        h(Button, {
                          variant: 'ghost',
                          size: 'sm',
                          icon: h(IconTrashOutline16, { size: 13 }),
                          onClick: () => patch('scan', { custom: form.scan.custom.filter((_, position) => position !== index) }),
                        }, ''),
                      ),
                    ),
                  ),
              h(
                'div',
                { className: 'dcc-row3', style: { marginTop: '8px' } },
                h(Field, { label: 'id' }, h('input', { value: custom.id, onChange: (e) => setCustom({ ...custom, id: e.target.value }), placeholder: 'my-agent' })),
                h(Field, { label: '显示名' }, h('input', { value: custom.label, onChange: (e) => setCustom({ ...custom, label: e.target.value }), placeholder: '我的另一个客户端' })),
                h(Field, { label: '类型' },
                  h(
                    'select',
                    { value: custom.kind, onChange: (e) => setCustom({ ...custom, kind: e.target.value }) },
                    h('option', { value: 'json' }, 'JSON · mcpServers'),
                    h('option', { value: 'toml' }, 'TOML · mcp_servers'),
                    h('option', { value: 'dir' }, '技能目录'),
                  )),
              ),
              h(
                'div',
                { className: 'dcc-row2' },
                h(Field, { label: '路径' }, h('input', { value: custom.path, onChange: (e) => setCustom({ ...custom, path: e.target.value }), placeholder: 'C:\\Users\\me\\.myagent\\config.json' })),
                custom.kind === 'json'
                  ? h(Field, { label: '键名' }, h('input', { value: custom.mcpKey, onChange: (e) => setCustom({ ...custom, mcpKey: e.target.value }), placeholder: 'mcpServers' }))
                  : custom.kind === 'toml'
                    ? h(Field, { label: '段名' }, h('input', { value: custom.section, onChange: (e) => setCustom({ ...custom, section: e.target.value }), placeholder: 'mcp_servers' }))
                    : h('span', null),
              ),
              h('div', { className: 'dcc-bar', style: { marginBottom: 0 } },
                h(Button, { variant: 'outline', icon: h(IconPlusOutline16, { size: 14 }), onClick: addCustom }, '添加自定义源')),
            ),
          ),

          /* ── 界面 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconSettingsOutline16, { size: 14 }), '界面与关于'),
              h(Field, { label: '打开控制中心时默认停留的页面' },
                h(
                  'select',
                  { value: form.ui.defaultTab, onChange: (e) => patch('ui', { defaultTab: e.target.value }) },
                  ...[['rule', '规则'], ['mcp', 'MCP 服务器'], ['skill', '技能'], ['memory', '记忆'], ['scan', '导入'], ['backup', '备份'], ['settings', '设置']].map(([id, label]) =>
                    h('option', { key: id, value: id }, label),
                  ),
                )),
              h('div', { className: 'dcc-hint' }, `规则注入预算 ${(state.budget.rules / 1024).toFixed(1)} KB · 记忆注入预算 ${(state.budget.memory / 1024).toFixed(1)} KB`),
            ),
          ),
        ),
      )
    }
