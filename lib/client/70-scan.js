
    /* ──────────────────────── 从别的客户端导入 ──────────────────────── */

    /** 一个候选项的稳定键：来源 + 类型 + 名称。 */
    function scanKey(kind, source, name) {
      return `${kind}:${source}:${name}`
    }

    /** 导入结果 → 浮窗文案（多行；细节只列前几条，避免浮窗被撑长）。 */
    function importSummary(result) {
      const lines = [
        `MCP：新增 ${result.mcp.imported.length}、跳过 ${result.mcp.skipped.length}、失败 ${result.mcp.failed.length}`,
        `技能：新增 ${result.skills.imported.length}、跳过 ${result.skills.skipped.length}、失败 ${result.skills.failed.length}`,
      ]
      const skipped = [...result.mcp.skipped, ...result.skills.skipped]
      const failed = [...result.mcp.failed, ...result.skills.failed]
      for (const item of skipped.slice(0, 4)) lines.push(`跳过 ${item.name}：${item.reason}`)
      for (const item of failed.slice(0, 4)) lines.push(`失败 ${item.name}：${item.error}`)
      if (skipped.length + failed.length > 8) lines.push(`……另有 ${skipped.length + failed.length - 8} 条明细`)
      return { tone: failed.length > 0 ? 'danger' : skipped.length > 0 ? 'warn' : 'ok', text: lines.join('\n') }
    }

    function ScanTab({ state, act, error }) {
      const [scan, setScan] = useState(null)
      const [loading, setLoading] = useState(false)
      const [selected, setSelected] = useState(() => new Set())
      const [overwrite, setOverwrite] = useState(false)
      const [importing, setImporting] = useState(false)

      const run = useCallback(async () => {
        setLoading(true)
        try {
          const payload = await getJson('/scan')
          setScan(payload.scan)
        } catch (failure) {
          act.report(failure)
        } finally {
          setLoading(false)
        }
      }, [act])

      useEffect(() => {
        run()
      }, [run])

      const importable = (() => {
        if (scan === null) return []
        const list = []
        for (const source of scan.sources) {
          for (const item of source.mcp) {
            if (item.error === undefined && item.server !== undefined) list.push(scanKey('mcp', source.id, item.name))
          }
          for (const item of source.skills) list.push(scanKey('skill', source.id, item.name))
        }
        return list
      })()

      const toggle = (key) =>
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })

      const importSelection = async () => {
        if (selected.size === 0) return
        const servers = []
        const skills = []
        for (const key of selected) {
          const [kind, source, name] = key.split(':')
          if (kind === 'mcp') servers.push({ source, name })
          else skills.push({ source, name })
        }
        setImporting(true)
        try {
          const { ok, result } = await act.run({ section: 'scan', op: 'import', selection: { servers, skills, overwrite } })
          if (!ok) return // 原因已经由 act.run 显示在页面的校验条上；失败时保留勾选，用户改完能直接重试。
          setSelected(new Set())
          act.flash(importSummary(result))
          await run()
        } finally {
          setImporting(false)
        }
      }

      const present = scan === null ? [] : scan.sources.filter((source) => source.present)
      const absent = scan === null ? [] : scan.sources.filter((source) => !source.present)

      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconRefreshOutline16, { size: 14 }), disabled: loading, onClick: run }, loading ? '扫描中…' : '重新扫描'),
          h(Button, { variant: 'outline', disabled: importable.length === 0, onClick: () => setSelected(new Set(importable)) }, `全选可导入 · ${importable.length}`),
          h(Button, { variant: 'outline', disabled: selected.size === 0, onClick: () => setSelected(new Set()) }, '清除选择'),
          h('span', { className: 'dcc-grow' }),
          h(Toggle, { checked: overwrite, onChange: setOverwrite, label: '覆盖 DSH 里的同名项' }),
          h(Button, { variant: 'primary', disabled: selected.size === 0 || importing, onClick: importSelection }, importing ? '导入中…' : `导入选中 · ${selected.size}`),
        ),
        h(ErrorLine, { text: error }),
        scan === null
          ? h(Empty, { text: loading ? '正在扫描本机的其他客户端…' : '还没有扫描结果。' })
          : h(
              'div',
              { className: 'dcc-list' },
              h('div', { className: 'dcc-stat' },
                h('span', null, h('b', null, String(scan.totals.present)), ' 个客户端有可导入内容'),
                h('span', null, h('b', null, String(scan.totals.mcp)), ' 个 MCP 服务器'),
                h('span', null, h('b', null, String(scan.totals.skills)), ' 个技能'),
                h('span', null, '来源：', h('code', null, state.scan.targets.skills))),
              present.length === 0 ? h(Empty, { text: '本机没找到任何别的客户端配置。' }) : null,
              ...present.map((source) =>
                h(
                  'div',
                  { key: source.id, className: 'dcc-card' },
                  h(
                    'div',
                    { className: 'dcc-col' },
                    h(
                      'div',
                      { className: 'dcc-name' },
                      source.label,
                      h(Badge, { key: 'id' }, source.id),
                      h(Badge, { key: 'm', tone: source.mcp.length > 0 ? 'always' : 'plain' }, `MCP ${source.mcp.length}`),
                      h(Badge, { key: 's', tone: source.skills.length > 0 ? 'always' : 'plain' }, `技能 ${source.skills.length}`),
                    ),
                    h(ErrorLine, { text: source.error, tone: 'warn' }),
                    source.mcp.length === 0 && source.skills.length === 0
                      ? h('div', { className: 'dcc-desc' }, '没有可导入的条目')
                      : h(
                          'div',
                          { className: 'dcc-grid', style: { marginTop: '6px' } },
                          ...source.mcp.map((item) => {
                            const key = scanKey('mcp', source.id, item.name)
                            const disabled = item.error !== undefined || item.server === undefined
                            return h(
                              'label',
                              { key, className: 'dcc-pick dcc-pick-check', 'data-on': selected.has(key), 'data-off': disabled },
                              h('input', { type: 'checkbox', checked: selected.has(key), disabled, onChange: () => toggle(key) }),
                              h(
                                'div',
                                { className: 'dcc-narrow' },
                                h('div', { className: 'dcc-name' }, item.name, h(Badge, { key: 'k' }, 'MCP')),
                                h('div', { className: 'dcc-meta' },
                                  disabled
                                    ? item.error ?? '无法翻译'
                                    : item.server.transport === 'stdio'
                                      ? `${item.server.command} ${(item.server.args ?? []).join(' ')}`.trim()
                                      : item.server.url),
                                disabled ? null : h(ErrorLine, { text: item.server.transport === 'stdio' && Object.keys(item.server.env ?? {}).length > 0 ? `带 ${Object.keys(item.server.env).length} 个环境变量` : undefined, tone: 'warn' }),
                              ),
                            )
                          }),
                          ...source.skills.map((item) => {
                            const key = scanKey('skill', source.id, item.name)
                            return h(
                              'label',
                              { key, className: 'dcc-pick dcc-pick-check', 'data-on': selected.has(key) },
                              h('input', { type: 'checkbox', checked: selected.has(key), onChange: () => toggle(key) }),
                              h(
                                'div',
                                { className: 'dcc-narrow' },
                                h('div', { className: 'dcc-name' }, item.name, h(Badge, { key: 'k' }, item.kind === 'bundle' ? '技能目录' : '技能文件')),
                                h('div', { className: 'dcc-meta' }, item.description === '' ? item.path : item.description),
                              ),
                            )
                          }),
                        ),
                  ),
                ),
              ),
              absent.length === 0
                ? null
                : h(
                    'div',
                    { className: 'dcc-card' },
                    h(
                      'div',
                      { className: 'dcc-col' },
                      h('div', { className: 'dcc-name' }, '本机未发现', h(Badge, { key: 'n' }, `${absent.length} 个`)),
                      h('div', { className: 'dcc-desc' }, absent.map((source) => source.label).join('、')),
                    ),
                  ),
            ),
      )
    }
