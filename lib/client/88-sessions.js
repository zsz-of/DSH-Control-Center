
    /* ──────────────────────────── 会话标签页（彻底删除） ──────────────────────────── */

    /**
     * 会话列表快照源（`ctx.sessions.list`），由 `apply` 在服务就绪时接上。
     *
     * 形状是 `{ ids, byId, phase, projectionsBySession }`：`ids` 是**顶层**会话，
     * 子代理会话（`origin === 'subagent'` / 带 `parentId`）在 `byId` 里、挂在父会话名下。
     */
    let sessionListSource = null

    /**
     * 把某个会话从**列表**里摘掉（`ctx.sessions.handleSessionRemoved`）。
     *
     * 平台没有「删掉会话」的 API，宿主存储只提供 `create` / `enter` / `announce` / `get` /
     * `list`；文件由 host 那半侧删（`lib/sessions.js`），行则只能从这里摘。
     * 对「持久的子代理会话」它只会把状态改成不可用——平台把它们当作父会话名下的产物，
     * 那条行要等重启 DSH 之后才随文件一起消失。
     */
    let sessionRowRemover = null

    /** 空快照：服务还没接上（或读失败）时用它，页面照样能画。 */
    const EMPTY_SESSION_SNAPSHOT = { ids: [], byId: {}, phase: 'pending', projectionsBySession: {} }

    /**
     * 接上会话服务（`lib/client/99-tail.js` 调用）。
     *
     * @param services - `{ list, remove }`，缺项按「没有这个能力」处理。
     * @returns 无。
     */
    function connectSessionServices(services) {
      sessionListSource = services?.list ?? null
      sessionRowRemover = typeof services?.remove === 'function' ? services.remove : null
    }

    /** 读一次会话列表快照（任何异常都退回空快照：列表坏了不该把整页带崩）。 */
    function readSessionSnapshot() {
      try {
        if (sessionListSource === null || typeof sessionListSource.getSnapshot !== 'function') return EMPTY_SESSION_SNAPSHOT
        const value = sessionListSource.getSnapshot()
        if (value === null || typeof value !== 'object') return EMPTY_SESSION_SNAPSHOT
        return {
          ids: Array.isArray(value.ids) ? value.ids : [],
          byId: value.byId ?? {},
          phase: value.phase ?? 'ready',
          projectionsBySession: value.projectionsBySession ?? {},
        }
      } catch {
        return EMPTY_SESSION_SNAPSHOT
      }
    }

    /** 订阅会话列表快照。 */
    function useSessionSnapshot() {
      const [snapshot, setSnapshot] = useState(() => readSessionSnapshot())
      useEffect(() => {
        if (sessionListSource === null || typeof sessionListSource.subscribe !== 'function') return undefined
        const sync = () => setSnapshot(readSessionSnapshot())
        // 挂载与订阅之间可能已经变过：订阅后立刻对齐一次。
        sync()
        const unsubscribe = sessionListSource.subscribe(sync)
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [])
      return snapshot
    }

    /** 某个会话在列表里直接/间接挂着的全部子代理会话 id（按父链递归）。 */
    function sessionSubagentIds(byId, id) {
      const found = []
      const seen = new Set([id])
      const queue = [id]
      while (queue.length > 0) {
        const current = queue.shift()
        for (const [childId, row] of Object.entries(byId)) {
          if (row === null || typeof row !== 'object') continue
          if (row.parentId !== current || seen.has(childId)) continue
          seen.add(childId)
          found.push(childId)
          queue.push(childId)
        }
      }
      return found
    }

    /**
     * 列表快照 → 页面要显示的会话行（**只列顶层会话**）。
     *
     * 子代理会话单独列出来没有意义：它们随父会话一起删（`sessionSubagentIds`），
     * 而且平台不允许把子代理行从列表里摘掉（`handleSessionRemoved` 只改状态），
     * 单独给它们一个删除按钮就会留下一个删不掉的行。
     *
     * @param snapshot - 会话列表快照。
     * @returns `[{ id, title, cwd, running, updatedAt, subagents }]`，新的在前。
     */
    function sessionRowsOf(snapshot) {
      const byId = snapshot?.byId ?? {}
      const rows = []
      for (const id of snapshot?.ids ?? []) {
        const row = byId[id]
        if (row === null || typeof row !== 'object') continue
        if (row.origin === 'subagent' || typeof row.parentId === 'string') continue
        rows.push({
          id,
          title: typeof row.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : id,
          cwd: typeof row.cwd === 'string' ? row.cwd : '',
          running: row.running === true,
          updatedAt: Number(row.updatedAt) || 0,
          subagents: sessionSubagentIds(byId, id),
        })
      }
      return rows.sort((left, right) => right.updatedAt - left.updatedAt)
    }

    /** 时间戳 → 本地时间（列表排序依据，也给用户一个「哪条是新的」的抓手）。 */
    function formatSessionTime(value) {
      if (!Number.isFinite(value) || value <= 0) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /**
     * 「会话」标签页：列出会话，逐条**彻底删除**（文件 + 列表行）。
     *
     * 「彻底」分两步，缺一个都会留下用户能看见的残余：
     * 1. host 删磁盘落点（正文目录 / 回滚快照 / 投影缓存 / 溢出目录）并复核，
     *    正在使用的会话直接拒绝（见 `lib/api.js` 的 `session` 分区与 `lib/sessions.js`）；
     * 2. 浏览器侧把行从列表里摘掉（`handleSessionRemoved`）。
     *
     * @param props - `{ act, busy, error }`（与其他标签页一致）。
     * @returns 会话列表页。
     */
    function SessionsTab({ act, busy, error }) {
      const snapshot = useSessionSnapshot()
      const [confirming, setConfirming] = useState(null)
      const rows = sessionRowsOf(snapshot)

      const remove = async (row) => {
        const ids = [row.id, ...row.subagents]
        const outcome = await act.run({ section: 'session', op: 'delete', ids })
        setConfirming(null)
        if (!outcome.ok) return
        // host 已经删完文件：现在把行从列表里摘掉（子代理会话要挨个摘）。
        for (const id of ids) {
          try {
            sessionRowRemover?.(id)
          } catch {
            /* 摘行失败不影响文件已删的事实 */
          }
        }
        const result = outcome.result ?? {}
        const remaining = Array.isArray(result.remaining) ? result.remaining : []
        const files = Number(result.removed) || 0
        const extra = row.subagents.length === 0 ? '' : `（含 ${row.subagents.length} 个子代理会话）`
        act.flash(
          remaining.length === 0
            ? { tone: 'ok', text: `已删除「${row.title}」${extra}：清掉 ${files} 处文件，无残留` }
            : {
                tone: 'warn',
                text: `「${row.title}」清掉 ${files} 处文件，仍有 ${remaining.length} 处残留：${remaining
                  .map((item) => `${item.kind}/${item.id}`)
                  .join('、')}`,
              },
        )
      }

      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h('span', { className: 'dcc-grow' }, h('span', { className: 'dcc-desc' }, '删除会话会一并删掉磁盘上的会话正文、回滚快照与投影缓存，**不可恢复**。')),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, `共 ${rows.length} 个会话`),
          h('span', null, `其中 ${rows.filter((row) => row.running).length} 个正在运行`),
          sessionListSource === null ? h('span', null, '会话服务未就绪：列表可能不完整') : null,
        ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-hint' },
          '正在本进程里使用（打开中或运行中）的会话会被 host 拒绝——先切走或重启 DSH 再删，否则删掉的文件会被内存里的会话写回来。',
        ),
        h(
          'div',
          { className: 'dcc-list' },
          rows.length === 0 ? h(Empty, { text: '还没有会话。' }) : null,
          ...rows.map((row) =>
            h(Card, {
              key: row.id,
              off: row.running,
              title: row.title,
              badges: [
                row.running ? h(Badge, { key: 'run', tone: 'warn' }, '运行中') : h(Badge, { key: 'idle' }, '空闲'),
                row.subagents.length === 0 ? null : h(Badge, { key: 'sub' }, `${row.subagents.length} 个子代理会话`),
              ],
              meta: [formatSessionTime(row.updatedAt), row.cwd, row.id].filter((part) => part !== '').join(' · '),
              desc:
                row.subagents.length === 0
                  ? '删除后磁盘上的会话正文、回滚快照与投影缓存一起清掉。'
                  : `删除时连同 ${row.subagents.length} 个子代理会话一起清掉（它们的文件独立存放）。`,
              actions: h(RowActions, {
                id: row.id,
                confirming,
                setConfirming,
                busy,
                onDelete: () => remove(row),
              }),
            }),
          ),
        ),
      )
    }
