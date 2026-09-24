
    /* ──────────────────────────── 备份标签页 ──────────────────────────── */

    /**
     * 还原确认：把「会覆盖掉什么」摆到弹窗里说清楚。
     *
     * 还原是破坏性操作，所以不做成页面里的一段提示——用户点「还原」时它必须挡住视线，
     * 且必须逐项列出：每个分区会覆盖几个文件、新建几个文件，以及当前配置是否已先另存。
     */
    function RestoreDialog({ target, onClose, onConfirm, busy }) {
      const sections = target.sections ?? []
      return h(
        Modal,
        {
          open: true,
          onClose,
          title: '还原备份',
          closeLabel: '关闭',
          className: 'dcc-dialog',
          footer: h(
            'div',
            { className: 'dcc-foot' },
            busy ? h('span', { className: 'dcc-busy' }, h(IconLoadingOutline16, { size: 13 }), '还原中…') : null,
            h(Button, { variant: 'outline', onClick: onClose }, '取消'),
            h(Button, { variant: 'primary', disabled: busy, onClick: onConfirm }, '确认还原'),
          ),
        },
        h(
          'div',
          { className: 'dcc-form' },
          h(
            'div',
            { className: 'dcc-warnbox' },
            h('div', { className: 'dcc-name' }, h(IconWarningOutline16, { size: 15 }), '这会用备份覆盖当前配置'),
            h('div', null, `备份来自 ${formatTime(target.manifest?.createdAt ?? '')}。各分区的影响：`),
            h(
              'ul',
              { className: 'dcc-replacelist' },
              ...sections.map((section) =>
                h('li', { key: section.id }, `${section.label}：覆盖 ${section.overwrite ?? 0} 个、新建 ${section.create ?? 0} 个`),
              ),
            ),
          ),
          h('div', { className: 'dcc-hint' },
            target.snapshot ? '还原前会另存一份当前配置。' : '已关闭「恢复前自动快照」，当前配置不会留存。'),
        ),
      )
    }

    /**
     * 备份页：**备份**（把选中分区打包）与**还原**（用备份产物覆盖当前配置）。
     *
     * 刻意不做下载按钮：产物就在备份目录里，要拿走直接去目录拷。
     * 还原是破坏性的，所以一律先给确认弹窗，把会覆盖的文件数逐项列清楚。
     */
    function BackupTab({ state, act, error }) {
      const sections = state.backup.sections
      const [picked, setPicked] = useState(() => new Set(sections.filter((section) => section.sensitive !== true).map((section) => section.id)))
      const [label, setLabel] = useState('')
      const [working, setWorking] = useState(false)
      const [pending, setPending] = useState(null)
      const [uploading, setUploading] = useState(false)
      const fileRef = useRef(null)

      const togglePick = (id) =>
        setPicked((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })

      const create = async () => {
        if (picked.size === 0) return
        setWorking(true)
        try {
          const { ok, result } = await act.run({ section: 'backup', op: 'create', sections: [...picked], label })
          if (!ok) return // 原因已经由 act.run 显示在页面的校验条上。
          const skipped = result.stats.reduce((sum, item) => sum + item.skipped.length, 0)
          act.flash({
            tone: skipped === 0 ? 'ok' : 'warn',
            text: `已备份 ${result.stats.reduce((sum, item) => sum + item.files, 0)} 个文件（${formatBytes(result.bytes)}）：${result.file.split(/[\\/]/).pop()}${skipped === 0 ? '' : `\n有 ${skipped} 个文件超出上限被跳过`}`,
          })
          setLabel('')
        } finally {
          setWorking(false)
        }
      }

      /** 点某一行的「还原」：先只读分析该产物，拿到「会覆盖什么」再弹确认。 */
      const previewFile = async (file) => {
        setWorking(true)
        try {
          const { ok, result } = await act.run({ section: 'backup', op: 'inspect', file })
          if (!ok) return
          setPending({ file, ...result, snapshot: state.backup.snapshotBeforeImport })
        } finally {
          setWorking(false)
        }
      }

      /** 上传外部备份包：解析后同样先给确认弹窗。 */
      const chooseFile = async (event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file === undefined) return
        setUploading(true)
        try {
          const payload = await uploadBackup(file)
          setPending({ token: payload.token, manifest: payload.manifest, sections: payload.sections, counts: payload.counts, snapshot: state.backup.snapshotBeforeImport })
        } catch (failure) {
          act.report(failure)
        } finally {
          setUploading(false)
        }
      }

      const confirmRestore = async () => {
        if (pending === null) return
        setWorking(true)
        try {
          const { ok, result } = await act.run({
            section: 'backup',
            op: 'restore',
            ...(pending.file === undefined ? { token: pending.token } : { file: pending.file }),
            sections: (pending.sections ?? []).map((section) => section.id),
          })
          if (!ok) return
          act.flash({
            tone: result.failed.length === 0 ? 'ok' : 'warn',
            text: `已还原 ${result.written} 个文件${result.failed.length === 0 ? '' : `\n${result.failed.length} 个失败：${result.failed.map((item) => item.target).join('、')}`}${result.snapshot === null ? '' : `\n还原前的配置已另存为 ${result.snapshot.split(/[\\/]/).pop()}`}${result.snapshotError == null ? '' : `\n还原前快照没做成：${result.snapshotError}`}`,
          })
          setPending(null)
        } finally {
          setWorking(false)
        }
      }

      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconArchiveOutline20, { size: 15 }), disabled: working || picked.size === 0, onClick: create }, working ? '处理中…' : '备份'),
          h('span', { className: 'dcc-grow' }, h(Input, { placeholder: '备份名', value: label, onChange: (e) => setLabel(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: state.backup.dir }, act) }, '打开备份目录'),
          h(Button, { variant: 'outline', icon: h(IconDownloadOutline16, { size: 14 }), disabled: uploading, onClick: () => fileRef.current?.click() }, uploading ? '解析中…' : '导入备份包…'),
          h('input', { ref: fileRef, type: 'file', accept: '.zip,application/zip', style: { display: 'none' }, onChange: chooseFile }),
        ),
        h(ErrorLine, { text: error }),

        h('div', { className: 'dcc-name' }, '备份哪些分区'),
        h(
          'div',
          { className: 'dcc-grid' },
          ...sections.map((section) =>
            h(
              PickCard,
              { key: section.id, on: picked.has(section.id), onToggle: () => togglePick(section.id) },
              h('div', { className: 'dcc-name' }, section.label, section.sensitive === true ? h(Badge, { key: 's', tone: 'warn' }, '含密钥') : null),
              h('div', { className: 'dcc-desc' }, section.hint),
            ),
          ),
        ),

        h('div', { className: 'dcc-name', style: { marginTop: '6px' } }, '历史备份', h(Badge, { key: 'n' }, `${state.backup.items.length} 个`)),
        state.backup.items.length === 0
          ? h(Empty, { text: '还没有备份产物。' })
          : h(
              'div',
              { className: 'dcc-scrollbox' },
              h(
                'table',
                { className: 'dcc-table' },
                h('thead', null, h('tr', null, h('th', null, '文件'), h('th', null, '大小'), h('th', null, '时间'), h('th', null, '操作'))),
                h(
                  'tbody',
                  null,
                  ...state.backup.items.map((item) =>
                    h(
                      'tr',
                      { key: item.file },
                      h('td', null, item.file),
                      h('td', null, formatBytes(item.bytes)),
                      h('td', null, formatTime(item.createdAt)),
                      h(
                        'td',
                        { style: { whiteSpace: 'nowrap' } },
                        h(Button, { variant: 'outline', size: 'sm', disabled: working, onClick: () => previewFile(item.file) }, '还原'),
                        h(Button, { variant: 'ghost', size: 'sm', icon: h(IconTrashOutline16, { size: 13 }), onClick: () => act.run({ section: 'backup', op: 'delete', file: item.file }) }, '删除'),
                      ),
                    ),
                  ),
                ),
              ),
            ),

        pending === null
          ? null
          : h(RestoreDialog, {
              target: pending,
              busy: working,
              onClose: () => setPending(null),
              onConfirm: confirmRestore,
            }),
      )
    }
