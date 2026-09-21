
    /* ───────────────────────────── MCP 标签页 ───────────────────────────── */

    /** `KEY=VALUE` 多行文本 ↔ 对象。 */
    function parsePairs(text) {
      const out = {}
      for (const line of String(text).split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('#')) continue
        const index = trimmed.indexOf('=')
        if (index <= 0) continue
        out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
      }
      return out
    }

    function formatPairs(record) {
      return Object.entries(record ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    }

    const STATUS_TEXT = { mounted: '已挂载', disabled: '已停用', error: '挂载失败', pending: '等待挂载' }

    function McpEditor({ draft, onClose, onSubmit, busy }) {
      const [form, setForm] = useState({
        ...draft,
        argsText: (draft.args ?? []).join('\n'),
        envText: formatPairs(draft.env),
        headersText: formatPairs(draft.headers),
        timeoutText: draft.toolCallTimeoutMs === undefined ? '' : String(draft.toolCallTimeoutMs),
      })
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isStdio = form.transport !== 'streamable-http'
      return h(
        FormModal,
        {
          title: draft.name === '' || draft.name === undefined ? '添加 MCP 服务器' : `编辑 MCP 服务器 · ${draft.name}`,
          onClose,
          busy,
          submitLabel: '保存并立即生效',
          onSubmit: () =>
            onSubmit({
              name: form.name,
              enabled: form.enabled !== false,
              transport: form.transport,
              command: form.command,
              args: form.argsText.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
              env: parsePairs(form.envText),
              cwd: form.cwd,
              url: form.url,
              headers: parsePairs(form.headersText),
              toolCallTimeoutMs: form.timeoutText.trim() === '' ? undefined : Number(form.timeoutText),
              failOnStartupError: form.failOnStartupError === true,
            }),
        },
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '服务器名', hint: '字母/数字/下划线/连字符，1–32 位' },
            h('input', { value: form.name, onChange: (e) => patch({ name: e.target.value }), placeholder: '例如：playwright' })),
          h(Field, { label: '传输方式' },
            h(
              'select',
              { value: form.transport, onChange: (e) => patch({ transport: e.target.value }) },
              h('option', { value: 'stdio' }, 'stdio'),
              h('option', { value: 'streamable-http' }, 'streamable-http'),
            )),
        ),
        isStdio
          ? h(
              react.Fragment,
              null,
              h(Field, { label: '启动命令' },
                h('input', { value: form.command ?? '', onChange: (e) => patch({ command: e.target.value }), placeholder: '例如：npx 或 C:\\Tools\\my-mcp\\server.exe' })),
              h(Field, { label: '参数' },
                h('textarea', { rows: 3, value: form.argsText, onChange: (e) => patch({ argsText: e.target.value }), placeholder: '-y\n@playwright/mcp@latest' })),
              h(
                'div',
                { className: 'dcc-row2' },
                h(Field, { label: '环境变量', hint: '一行一个 KEY=VALUE' },
                  h('textarea', { rows: 3, value: form.envText, onChange: (e) => patch({ envText: e.target.value }), placeholder: 'GITHUB_TOKEN=xxx' })),
                h(Field, { label: '工作目录' },
                  h('input', { value: form.cwd ?? '', onChange: (e) => patch({ cwd: e.target.value }), placeholder: '留空则用会话工作目录' })),
              ),
            )
          : h(
              react.Fragment,
              null,
              h(Field, { label: '服务地址' },
                h('input', { value: form.url ?? '', onChange: (e) => patch({ url: e.target.value }), placeholder: 'http://localhost:3000/mcp' })),
              h(Field, { label: '请求头', hint: '一行一个 KEY=VALUE' },
                h('textarea', { rows: 3, value: form.headersText, onChange: (e) => patch({ headersText: e.target.value }), placeholder: 'Authorization=Bearer xxx' })),
            ),
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '单次调用超时' },
            h('input', { value: form.timeoutText, onChange: (e) => patch({ timeoutText: e.target.value }), placeholder: '60000' })),
          h(Field, { label: '选项' },
            h(Toggle, { checked: form.enabled !== false, onChange: (value) => patch({ enabled: value }), label: '对 Agent 启用' }),
            h(Toggle, { checked: form.failOnStartupError === true, onChange: (value) => patch({ failOnStartupError: value }), label: '启动失败时拒绝激活' })),
        ),
      )
    }

    function McpTab({ state, act, busy, error }) {
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const items = state.mcp.items
      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconPlusOutline16, { size: 14 }), onClick: () => setEditor({ name: '', transport: 'stdio', args: [], env: {}, enabled: true }) }, '添加服务器'),
          h('span', { className: 'dcc-grow' }),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.run({ section: 'mcp', op: 'sync' }) }, '重新加载'),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ file: state.paths.mcp }, act) }, '打开配置'),
        ),
        h(ErrorLine, { text: error }),
        h(ErrorLine, { text: state.mcp.fileError }),
        h(ErrorLine, { text: state.mcp.syncError }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0 ? h(Empty, { text: '还没有 MCP 服务器。' }) : null,
          ...items.map((server) => {
            const status = server.status ?? { state: 'pending' }
            return h(Card, {
              key: server.name,
              off: server.enabled === false,
              title: server.name,
              badges: [
                h(StateDot, {
                  key: 'dot',
                  state: status.state === 'mounted' ? 'done' : status.state === 'error' ? 'error' : status.state === 'disabled' ? 'warning' : 'ongoing',
                  size: 9,
                }),
                h(Badge, { key: 't', tone: status.state === 'mounted' ? 'ok' : status.state === 'error' ? 'danger' : 'plain' }, STATUS_TEXT[status.state] ?? status.state),
                h(Badge, { key: 'tr' }, server.transport),
                server.enabled === false ? h(Badge, { key: 'off', tone: 'warn' }, '不对 Agent 启用') : null,
              ],
              desc: server.transport === 'stdio' ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim() : server.url,
              meta: server.transport === 'stdio' && server.cwd !== undefined ? `cwd: ${server.cwd}` : '',
              error: status.error,
              actions: h(RowActions, {
                id: server.name,
                confirming,
                setConfirming,
                busy,
                toggle: h(Toggle, { checked: server.enabled !== false, onChange: (value) => act.run({ section: 'mcp', op: 'toggle', name: server.name, enabled: value }), label: '' }),
                onEdit: () => setEditor(server),
                onDelete: () => act.run({ section: 'mcp', op: 'delete', name: server.name }),
              }),
            })
          }),
        ),
        editor === null
          ? null
          : h(McpEditor, {
              draft: editor,
              busy,
              onClose: () => setEditor(null),
              onSubmit: async (server) => {
                const { ok } = await act.run({ section: 'mcp', op: 'save', server })
                if (ok) setEditor(null)
              },
            }),
      )
    }
