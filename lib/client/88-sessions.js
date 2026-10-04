
    /* ────────── 每个对话的「⋯ 更多」里的「彻底删除会话」 ────────── */

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

    /** 在指定工作目录新建会话（`ctx.sessions.create({ cwd })`）：`session-live` 补救路径要用。 */
    let sessionCreator = null

    /**
     * 把主视图切到某个会话（`uiWorkspace.openSession`）。
     *
     * 由 `ctx.inject(['uiWorkspace'])` 单独接（这个服务不在本插件的 `inject` 里，缺席时只少这一步，
     * 删除流程照旧先新建再重试）。
     */
    let sessionOpener = null

    /** 空快照：服务还没接上（或读失败）时用它。 */
    const EMPTY_SESSION_SNAPSHOT = { ids: [], byId: {}, phase: 'pending', projectionsBySession: {} }

    /**
     * 接上会话服务（`lib/client/99-tail.js` 调用）。
     *
     * @param services - `{ list, remove, create }`，缺项按「没有这个能力」处理。
     * @returns 无。
     */
    function connectSessionServices(services) {
      sessionListSource = services?.list ?? null
      sessionRowRemover = typeof services?.remove === 'function' ? services.remove : null
      sessionCreator = typeof services?.create === 'function' ? services.create : null
    }

    /** 接上「切到某个会话」的能力（`uiWorkspace.openSession` 就绪后）。 */
    function connectSessionOpener(open) {
      sessionOpener = typeof open === 'function' ? open : null
    }

    /** 读一次会话列表快照（任何异常都退回空快照：列表坏了不该把菜单项带崩）。 */
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
     * 取一条会话行的摘要（菜单项只知道自己那一条的 id）。
     *
     * 子代理会话随父会话一起删：它们的文件独立存放，逐个点删只会留下一行删不掉的鬼影
     * （平台对子代理行的删除只改状态、不摘行），所以这里一次就把整族 id 收齐。
     * 列表里查不到（服务未就绪 / 已经不是列表成员）时返回 `null`，调用方用 id 兜底。
     *
     * @param snapshot - 会话列表快照。
     * @param sessionId - 会话 id。
     * @returns `{ id, title, cwd, running, updatedAt, subagents }` 或 `null`。
     */
    function sessionRowOf(snapshot, sessionId) {
      const byId = snapshot?.byId ?? {}
      const row = byId[sessionId]
      if (row === null || typeof row !== 'object') return null
      return {
        id: sessionId,
        title: typeof row.displayTitle === 'string' && row.displayTitle !== '' ? row.displayTitle : sessionId,
        cwd: typeof row.cwd === 'string' ? row.cwd : '',
        running: row.running === true,
        updatedAt: Number(row.updatedAt) || 0,
        subagents: sessionSubagentIds(byId, sessionId),
      }
    }

    /** 时间戳 → 本地时间（确认框里给用户一个「这是哪条」的抓手）。 */
    function formatSessionTime(value) {
      if (!Number.isFinite(value) || value <= 0) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (number) => String(number).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /* ────────────────── 删除请求的状态机（菜单项发起 → 确认框执行） ────────────────── */

    /** 空态：`request` 非空时确认框才出现。 */
    const EMPTY_SESSION_DELETE = { request: null, phase: 'idle', error: null, report: null }

    /** 模块级状态：菜单项与确认框是两个插槽条目，靠它对接（组件树里没有公共祖先）。 */
    const sessionDelete = { current: EMPTY_SESSION_DELETE, listeners: new Set() }

    function setSessionDelete(next) {
      sessionDelete.current = next
      for (const listener of sessionDelete.listeners) listener(next)
    }

    /** 菜单项：只发起请求（真正的删除在确认框里执行）。 */
    function requestSessionDelete(row) {
      setSessionDelete({ request: row, phase: 'confirm', error: null, report: null })
    }

    /** 关掉确认框（执行中不允许关：删除已经发出去了）。 */
    function closeSessionDelete() {
      if (sessionDelete.current.phase === 'working') return
      setSessionDelete(EMPTY_SESSION_DELETE)
    }

    /** 订阅删除状态。 */
    function useSessionDelete() {
      const [value, setValue] = useState(() => sessionDelete.current)
      useEffect(() => {
        const sync = (next) => setValue(next)
        sessionDelete.listeners.add(sync)
        // 订阅与首次渲染之间可能已经变过：订阅后立刻对齐一次。
        sync(sessionDelete.current)
        return () => sessionDelete.listeners.delete(sync)
      }, [])
      return value
    }

    /**
     * 在同一工作目录新建一个对话并切过去；做不到时返回 `undefined`。
     *
     * 切过去是关键：平台按引用计数持有主视图那个会话，切走之后旧会话才会从内存里让位，
     * host 的 `sessionLive` 才不再拦这次删除。
     */
    async function openFreshSession(cwd) {
      if (sessionCreator === null) return undefined
      try {
        const sessionId = await sessionCreator(typeof cwd === 'string' && cwd !== '' ? { cwd } : {})
        try {
          sessionOpener?.(sessionId)
        } catch {
          /* 切不过去也已经新建了：下面的删除重试照旧 */
        }
        return sessionId
      } catch {
        return undefined
      }
    }

    /**
     * 执行一次「彻底删除」。
     *
     * host 会拒绝**本进程里还活着**的会话（正文还在内存里，删完下一次落盘就写回来，
     * 用户看到的是「删了又回来了」）。用户要的行为是：正在用的那一条，先在同一工作目录
     * 新建一个对话并切过去，再删旧的——所以第一次被拒（`code === 'session-live'`）时走这条
     * 补救路径，然后**只重试一次**；仍然失败就把 host 的原话摆给用户（它会说清怎么办）。
     *
     * @param request - {@link sessionRowOf} 的结果。
     * @returns 无（结果写进 {@link sessionDelete}）。
     */
    async function runSessionDelete(request) {
      const ids = [request.id, ...request.subagents]
      setSessionDelete({ request, phase: 'working', error: null, report: null })
      let outcome
      try {
        outcome = await postAction({ section: 'session', op: 'delete', ids })
      } catch (failure) {
        if (failure.code !== 'session-live') {
          setSessionDelete({ request, phase: 'error', error: failure.message, report: null })
          return
        }
        const created = await openFreshSession(request.cwd)
        if (created === undefined) {
          setSessionDelete({
            request,
            phase: 'error',
            error: `${failure.message}（也没能在同一工作目录新建对话：会话服务未就绪）`,
            report: null,
          })
          return
        }
        try {
          outcome = await postAction({ section: 'session', op: 'delete', ids })
        } catch (retry) {
          setSessionDelete({ request, phase: 'error', error: retry.message, report: null })
          return
        }
      }
      // host 已经删完文件：把行从列表里摘掉（子代理会话要挨个摘）。
      for (const id of ids) {
        try {
          sessionRowRemover?.(id)
        } catch {
          /* 摘行失败不影响文件已删的事实 */
        }
      }
      const payload = outcome.result ?? {}
      setSessionDelete({
        request,
        phase: 'done',
        error: null,
        report: {
          removed: Number(payload.removed) || 0,
          remaining: Array.isArray(payload.remaining) ? payload.remaining : [],
        },
      })
    }

    /* ──────────────────────────── 两个插槽条目 ──────────────────────────── */

    /**
     * 「⋯ 更多」菜单里的最后一项：彻底删除。
     *
     * 平台自带那一排（置顶 / 重命名 / 分叉 / 归档）都注册在
     * `sidebar.workspaces.session.menu.item`，这里排到它们之后（order 500）并标成 `danger`。
     * 点它**不删**任何东西——只把这条会话交给确认框（不可恢复的操作必须二次确认）。
     *
     * @param props - 条目主人参数：`{ sessionId, displayTitle }` 与菜单开合 hook。
     * @returns 菜单项。
     */
    function SessionDeleteMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(MenuItemButton, {
        danger: true,
        separatorBefore: true,
        icon: h(IconTrashOutline16, { size: 14 }),
        onSelect: () => {
          setMenuOpen(false)
          requestSessionDelete(
            sessionRowOf(readSessionSnapshot(), sessionId) ?? {
              id: sessionId,
              title: displayTitle === undefined || displayTitle === '' ? sessionId : displayTitle,
              cwd: '',
              running: false,
              updatedAt: 0,
              subagents: [],
            },
          )
        },
      }, '彻底删除')
    }

    /**
     * 确认框（`shell.overlay`）。
     *
     * 会把「删的是哪一条、工作目录在哪、连带几个子代理、最后更新于何时」逐条写清楚，
     * 因为这一步不可恢复；删完把 host 的复核结果（清掉几处文件 / 还有哪些残留）原样报出来，
     * 不假装成功。
     *
     * @returns 对话框，或没有待办时的 `null`。
     */
    function SessionDeleteDialog() {
      const state = useSessionDelete()
      const request = state.request
      if (request === null) return null
      const busy = state.phase === 'working'
      const running = request.running === true
      const subagents = request.subagents.length
      const report = state.report
      const lines = []
      if (state.phase === 'done' && report !== null) {
        lines.push(report.remaining.length === 0
          ? `已清掉 ${report.removed} 处文件，复核无残留。`
          : `已清掉 ${report.removed} 处文件，仍有 ${report.remaining.length} 处残留：${report.remaining
              .map((item) => `${item.kind}/${item.id}`)
              .join('、')}`)
      }
      return h(
        Modal,
        {
          open: true,
          onClose: closeSessionDelete,
          title: '彻底删除对话',
          closeLabel: '关闭',
          className: 'dcc-dialog',
          contentClassName: 'dcc-modal',
          footer: h(
            'div',
            { className: 'dcc-foot' },
            busy ? h('span', { className: 'dcc-busy' }, h(IconLoadingOutline16, { size: 13 }), '删除中…') : null,
            state.phase === 'done' || state.phase === 'error'
              ? h(Button, { variant: 'primary', onClick: closeSessionDelete }, '知道了')
              : null,
            state.phase === 'confirm' ? h(Button, { variant: 'outline', onClick: closeSessionDelete }, '取消') : null,
            state.phase === 'confirm'
              ? h(Button, { variant: 'primary', disabled: running, onClick: () => runSessionDelete(request) }, '彻底删除')
              : null,
          ),
        },
        h(
          'div',
          { className: 'dcc-form' },
          h(ErrorLine, { text: state.error }),
          ...lines.map((text) => h('div', { className: 'dcc-hint', key: text }, text)),
          h('div', { className: 'dcc-hint' }, `对话：${request.title}`),
          h('div', { className: 'dcc-hint' }, `工作目录：${request.cwd === '' ? '（未知）' : request.cwd}`),
          h('div', { className: 'dcc-hint' }, subagents === 0
            ? '连带删除：无子代理会话'
            : `连带删除：${subagents} 个子代理会话（它们的文件独立存放）`),
          h('div', { className: 'dcc-hint' }, `最后更新：${formatSessionTime(request.updatedAt) === '' ? '（未知）' : formatSessionTime(request.updatedAt)}`),
          state.phase === 'confirm'
            ? [
                h('div', { className: 'dcc-hint', key: 'warn' }, '这会删掉磁盘上的会话正文、回滚快照与投影缓存，**不可恢复**。'),
                running
                  ? h('div', { className: 'dcc-hint', key: 'run' }, '这条对话正在运行：先停止它再删（平台会拒绝删除正在使用的会话）。')
                  : h('div', { className: 'dcc-hint', key: 'live' }, '如果这条对话正开着，插件会先在同一工作目录新建一个对话再删它。'),
              ]
            : null,
        ),
      )
    }
