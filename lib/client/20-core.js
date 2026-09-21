
    /* ─────────────────────────── 与 host 通信 ─────────────────────────── */

    /**
     * 把 host 返回的 state 补齐成客户端需要的形状。
     *
     * 存在的理由是一个**真实会发生的窗口**：客户端 bundle 是浏览器按 URL 取的（改完刷新页面就是新的），
     * 而 host 半侧要重启 DSH Desktop 才会重新加载。于是「新客户端 + 旧 host」必然出现一瞬——
     * 旧 host 的 `/state` 里没有 project / memory / backup / scan 这些分区，
     * 直接读 `state.memory.items` 会让整页白屏。补齐成空形状后，用户看到的是空列表而不是崩溃。
     */
    function withDefaults(raw) {
      const state = raw ?? {}
      return {
        root: state.root ?? '',
        paths: state.paths ?? {},
        budget: state.budget ?? { rules: 0, memory: 0 },
        rules: { items: [], activeCount: 0, alwaysCount: 0, ondemandCount: 0, injectBytes: 0, ...(state.rules ?? {}) },
        project: state.project ?? null,
        skills: { items: [], ...(state.skills ?? {}) },
        mcp: { items: [], error: null, fileError: null, syncError: null, ...(state.mcp ?? {}) },
        memory: { items: [], enabledCount: 0, globalCount: 0, workspaceCount: 0, injectBytes: 0, injectEnabled: false, ...(state.memory ?? {}) },
        backup: { dir: '', items: [], sections: [], retention: 0, snapshotBeforeImport: false, ...(state.backup ?? {}) },
        scan: { targets: { mcp: '', skills: '' }, sources: [], custom: [], ...(state.scan ?? {}) },
        settings: {
          optimize: { enabled: false, provider: '', model: '', reasoningEffort: '', prompt: '' },
          memory: { enabled: false, inject: false },
          backup: { retention: 0, snapshotBeforeImport: false },
          scan: { disabled: [], custom: [] },
          ui: { defaultTab: 'rule' },
          ...(state.settings ?? {}),
        },
        optimize: { enabled: false, provider: '', model: '', reasoningEffort: '', prompt: '', available: false, hasCustomPrompt: false, ...(state.optimize ?? {}) },
      }
    }

    /**
     * 读取完整状态。
     *
     * 项目规则按「工作区」隔离，所以 state 需要知道看哪个工作区：`workspace` 是显式路径，
     * `session` 交给 host 去解析（浏览器侧不必猜会话快照的形状）。
     */
    async function fetchState(target = {}) {
      const query = []
      if (target.workspace !== undefined && target.workspace !== '') query.push(`workspace=${encodeURIComponent(target.workspace)}`)
      else if (target.session !== undefined && target.session !== '') query.push(`session=${encodeURIComponent(target.session)}`)
      const suffix = query.length === 0 ? '' : `?${query.join('&')}`
      const response = await fetch(`${API}/state${suffix}`, { headers: { Accept: 'application/json' } })
      const payload = await response.json()
      if (payload.ok !== true) throw new Error(payload.error ?? '读取状态失败')
      return withDefaults(payload.state)
    }

    /** 读取某条规则/技能/记忆的正文（规则要带 workspace 才能落到正确目录）。 */
    async function fetchBody(section, id, target = {}) {
      const query = [`section=${encodeURIComponent(section)}`, `id=${encodeURIComponent(id)}`]
      if (target.workspace !== undefined && target.workspace !== '') query.push(`workspace=${encodeURIComponent(target.workspace)}`)
      const payload = await (await fetch(`${API}/body?${query.join('&')}`, { headers: { Accept: 'application/json' } })).json()
      if (payload.ok !== true) throw new Error(payload.error ?? '读取正文失败')
      return payload.body
    }

    /** 统一的写入口；返回 `{ state, result }`，失败时抛错（调用方决定怎么提示）。 */
    async function postAction(payload) {
      const response = await fetch(`${API}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (result.ok !== true) throw new Error(result.error ?? '操作失败')
      return { state: withDefaults(result.state), result: result.result }
    }

    /** 通用 JSON POST（用于 /optimize 这类不返回 state 的接口）。 */
    async function postJson(path, payload) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (result.ok !== true) throw new Error(result.error ?? '操作失败')
      return result
    }

    /** GET 一个 JSON 接口。 */
    async function getJson(path) {
      const payload = await (await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } })).json()
      if (payload.ok !== true) throw new Error(payload.error ?? '读取失败')
      return payload
    }

    /** 上传一个备份包（原始字节，不走 base64）。 */
    async function uploadBackup(file) {
      const response = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
      })
      const payload = await response.json()
      if (payload.ok !== true) throw new Error(payload.error ?? '上传失败')
      return payload
    }

    /* ────────────────────────── 面板开合状态 ────────────────────────── */

    /**
     * 控制中心是一个**整页**（挂在 `shell.overlay` 上），不是设置里的一个分区。
     * 开合与「打开时停在哪一页」放在模块级 store 里，让侧边栏入口能把面板叫起来并指到正确的页面。
     */
    const panelListeners = new Set()
    const panelState = { open: false, tab: null }

    const panelStore = {
      get() {
        return panelState
      },
      open(tab) {
        panelState.open = true
        if (tab !== undefined && tab !== null) panelState.tab = tab
        for (const listener of panelListeners) listener()
      },
      close() {
        panelState.open = false
        for (const listener of panelListeners) listener()
      },
      setTab(tab) {
        panelState.tab = tab
        for (const listener of panelListeners) listener()
      },
      subscribe(listener) {
        panelListeners.add(listener)
        return () => panelListeners.delete(listener)
      },
    }

    /** 订阅面板状态。 */
    function usePanelState() {
      const [snapshot, setSnapshot] = useState(() => ({ ...panelStore.get() }))
      useEffect(() => panelStore.subscribe(() => setSnapshot({ ...panelStore.get() })), [])
      return snapshot
    }

    /* ────────────────────── 每个视图自己的数据控制器 ────────────────────── */

    /**
     * 一个视图的数据控制器：状态 + 错误 + 忙碌 + 统一写入口。
     *
     * 面板与会话里的「规则」视图都要这套东西，抽出来是为了只有一份实现——
     * 否则每个页面各写一遍 `setBusy/setError/try/catch`，改一处就得改 N 处。
     */
    function useController(target = {}) {
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [flash, setFlash] = useState(null)
      const workspace = target.workspace ?? ''
      const session = target.session ?? ''

      const refresh = useCallback(async () => {
        setBusy(true)
        try {
          setState(await fetchState({ workspace, session }))
          setError(null)
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }, [workspace, session])

      useEffect(() => {
        refresh()
      }, [refresh])

      // Agent 用 control_center_* 工具改完配置后，host 会 bump 版本号；
      // 这里轻量轮询 /revision，变了才重拉完整 state——用户不会看到与 AI 输出脱节的旧界面。
      useEffect(() => {
        let alive = true
        let last = undefined
        const check = async () => {
          try {
            const { revision } = await getJson('/revision')
            if (!alive) return
            if (last !== undefined && revision !== last) refresh()
            last = revision
          } catch {
            // 轮询失败静默忽略：下一轮再试，别为一次瞬时网络错误刷错误条。
          }
        }
        check()
        const timer = setInterval(check, 2500)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [refresh])

      useEffect(() => {
        if (flash === null) return undefined
        const timer = setTimeout(() => setFlash(null), 8000)
        return () => clearTimeout(timer)
      }, [flash])

      const run = useCallback(
        async (payload) => {
          setBusy(true)
          try {
            const { state: next, result } = await postAction({
              ...payload,
              workspace: payload.workspace ?? workspace,
              session: payload.session ?? session,
            })
            setState(next)
            setError(null)
            return { ok: true, state: next, result }
          } catch (failure) {
            setError(failure.message)
            return { ok: false }
          } finally {
            setBusy(false)
          }
        },
        [workspace, session],
      )

      const act = useMemo(
        () => ({
          run,
          refresh,
          report: (failure) => setError(failure?.message ?? String(failure)),
          flash: (message) => setFlash(message),
        }),
        [run, refresh],
      )

      return { state, error, busy, flash, setFlash, act }
    }

    /* ────────────────────────── 通用小原子 ────────────────────────── */

    /** 字节数 → 人类可读。 */
    function formatBytes(bytes) {
      const value = Number(bytes) || 0
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
      return `${(value / 1024 / 1024).toFixed(2)} MB`
    }

    /** ISO 时间 → 本地可读。 */
    function formatTime(iso) {
      if (typeof iso !== 'string' || iso === '') return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return iso
      const pad = (value) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function Field({ label, hint, children }) {
      return h(
        'label',
        { className: 'dcc-field' },
        h('span', { className: 'dcc-label' }, label),
        children,
        hint === undefined ? null : h('span', { className: 'dcc-hint' }, hint),
      )
    }

    function Badge({ tone, children }) {
      return h('span', { className: 'dcc-badge', 'data-tone': tone ?? 'plain' }, children)
    }

    function ErrorLine({ text, tone }) {
      if (text === null || text === undefined || text === '') return null
      return h(
        'div',
        { className: 'dcc-err', 'data-tone': tone ?? 'danger' },
        h(IconWarningOutline16, { size: 13 }),
        h('span', null, text),
      )
    }

    /**
     * 一次性提示：**浮窗（toast）**，固定在右下角、自动消失。
     *
     * 不做成页面里的一段内容——插进内容流会顶开布局、留下一条已经过期的消息，
     * 而且和「当前界面状态」混在一起看。
     */
    function Toast({ flash, onClose }) {
      if (flash === null || flash === undefined) return null
      const tone = flash.tone ?? 'ok'
      const icon = tone === 'ok' ? h(IconCheckOutline16, { size: 14 }) : h(IconWarningOutline16, { size: 14 })
      return h(
        'div',
        { className: 'dcc-toast', 'data-tone': tone, role: 'status' },
        h('span', { className: 'dcc-toast-icon' }, icon),
        h('div', { className: 'dcc-toast-text' }, flash.text),
        h(Button, { variant: 'ghost', size: 'sm', icon: h(IconCloseOutline16, { size: 13 }), onClick: onClose }, ''),
      )
    }

    /** 开关：一律用滑块（switch），比原生复选框更直观。 */
    function Toggle({ checked, onChange, label, disabled }) {
      return h(
        'label',
        { className: 'dcc-switch' },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => onChange(event.target.checked),
        }),
        label === '' || label === undefined ? null : label,
      )
    }

    /**
     * 可勾选的卡片（多选列表统一用它）：整块可点，右侧一个滑块开关。
     *
     * 外层刻意用 `div` 而不是 `label`：`Toggle` 自己就是个 `label`，嵌在 `label` 里会让
     * 「点开关」被外层的转发逻辑再触发一次（一按变两下）。这里让开关的容器吞掉点击事件，
     * 其余区域交给外层切换，既保住了大点击区，又只切换一次。
     */
    function PickCard({ on, disabled, onToggle, children }) {
      return h(
        'div',
        {
          className: 'dcc-pick',
          'data-on': on === true,
          'data-off': disabled === true,
          onClick: () => {
            if (disabled !== true) onToggle()
          },
        },
        h('div', { className: 'dcc-narrow' }, children),
        h('span', { className: 'dcc-pickswitch', onClick: (event) => event.stopPropagation() }, h(Toggle, { checked: on === true, disabled, onChange: () => onToggle(), label: '' })),
      )
    }

    function Empty({ text }) {
      return h('div', { className: 'dcc-empty' }, text)
    }

    /** 列表卡片：全站统一的条目外观（标题 + 徽标 + 描述 + 元信息 + 右侧操作区）。 */
    function Card({ off, title, badges, desc, meta, warning, error, children, actions, onPick }) {
      return h(
        'div',
        { className: 'dcc-card', 'data-off': off === true, 'data-pick': onPick !== undefined, onClick: onPick },
        h(
          'div',
          { className: 'dcc-col' },
          h(
            'div',
            { className: 'dcc-name' },
            title,
            ...(Array.isArray(badges) ? badges : badges === undefined || badges === null ? [] : [badges]).filter(
              (badge) => badge !== null && badge !== undefined && badge !== false,
            ),
          ),
          desc === undefined || desc === null || desc === '' ? null : h('div', { className: 'dcc-desc' }, desc),
          meta === undefined || meta === null || meta === '' ? null : h('div', { className: 'dcc-meta' }, meta),
          h(ErrorLine, { text: warning, tone: 'warn' }),
          h(ErrorLine, { text: error }),
          children ?? null,
        ),
        // `actions` 是单个 React 元素（各页传的是 `h(RowActions, …)`），当子节点渲染即可；
        // 不能像数组那样 `.filter`/展开——单个元素没有这些方法，展开会让整页崩溃。
        h('div', { className: 'dcc-acts' }, actions),
      )
    }

    /**
     * 条目右侧的「开关 + 编辑 + 删除」三件套。
     *
     * 删除是二次确认（第一次点变成「确认删除」，再点才真删），并且**只有**确认态才带 disabled，
     * 避免 busy 期间误点。抽出来是因为多个页面都要这一套，抄多遍必然长出多种措辞。
     */
    function RowActions({ id, confirming, setConfirming, onEdit, onDelete, busy, toggle, extras }) {
      return [
        ...(extras ?? []),
        toggle === undefined || toggle === null ? null : toggle,
        onEdit === undefined ? null : h(Button, { key: 'edit', variant: 'ghost', size: 'sm', icon: h(IconEditOutline16, { size: 14 }), onClick: onEdit }, '编辑'),
        confirming === id
          ? h(Button, { key: 'del', variant: 'outline', size: 'sm', disabled: busy, onClick: onDelete }, '确认删除')
          : h(Button, { key: 'ask', variant: 'ghost', size: 'sm', icon: h(IconTrashOutline16, { size: 14 }), onClick: () => setConfirming(id) }, '删除'),
        confirming === id
          ? h(Button, { key: 'cancel', variant: 'ghost', size: 'sm', icon: h(IconCloseOutline16, { size: 14 }), onClick: () => setConfirming(null) }, '')
          : null,
      ]
    }

    /**
     * 表单弹窗的公共外壳。
     *
     * 宽度必须落在 `className`（Modal 原语把它给到 `.dialog`）——原语把 `.dialog` 写死成
     * `width:min(380px,100%)` 且 `overflow:hidden`，只改 `contentClassName` 的话更宽的内容会被裁掉。
     * 高度由 `.dcc-dialog{max-height:88vh}` + `.dcc-modal{overflow:auto}` 控制，内容再多也不会截断。
     */
    function FormModal({ title, onClose, onSubmit, busy, submitLabel, wide, children, hint }) {
      return h(
        Modal,
        {
          open: true,
          onClose,
          title,
          closeLabel: '关闭',
          className: wide === true ? 'dcc-dialog dcc-dialog-wide' : 'dcc-dialog',
          contentClassName: 'dcc-modal',
          footer: h(
            'div',
            { className: 'dcc-foot' },
            busy ? h('span', { className: 'dcc-busy' }, h(IconLoadingOutline16, { size: 13 }), '保存中…') : null,
            hint === undefined ? null : h('span', { className: 'dcc-busy' }, hint),
            h(Button, { variant: 'outline', onClick: onClose }, '取消'),
            h(Button, { variant: 'primary', disabled: busy, onClick: onSubmit }, submitLabel ?? '保存'),
          ),
        },
        h('div', { className: 'dcc-form' }, children),
      )
    }

    /**
     * 用系统文件管理器打开目录，或定位到一个文件。
     *
     * **失败必须说出来**：这个按钮以前把错误静默吞掉，用户看到的就是「点了没反应」——
     * 而最常见的失败原因（目录还不存在）恰恰是最该提示的。
     *
     * @param target - `{ dir }` 打开目录，或 `{ file }` 定位文件。
     * @param act - 页面的动作集（用它的浮层提示报错）。
     */
    async function reveal(target, act) {
      try {
        await postAction({ section: 'reveal', ...target })
      } catch (failure) {
        if (act === undefined) throw failure
        act.flash({ tone: 'warn', text: `打开失败：${failure.message}` })
      }
    }

    /* ────────────────── 输入框优化按钮需要的那点开关 ────────────────── */

    const flagsStore = {
      value: null,
      listeners: new Set(),
      set(next) {
        this.value = next
        for (const listener of this.listeners) listener(next)
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    }
    let flagsPromise
    const FLAGS_FALLBACK = { optimize: { enabled: false, available: false } }

    /** 拉取开关状态（同一次页面生命周期内只请求一次，除非强制刷新）。 */
    function loadFlags(force = false) {
      if (force) {
        flagsPromise = undefined
        flagsStore.set(null)
      }
      if (flagsPromise === undefined) {
        flagsPromise = getJson('/flags')
          .then((payload) => {
            flagsStore.set(payload.flags ?? FLAGS_FALLBACK)
            return payload.flags
          })
          .catch(() => {
            flagsStore.set(FLAGS_FALLBACK)
            return FLAGS_FALLBACK
          })
      }
      return flagsPromise
    }

    /** 订阅开关状态。 */
    function useFlags() {
      const [value, setValue] = useState(() => flagsStore.value)
      useEffect(() => {
        if (flagsStore.value === null) loadFlags()
        const sync = (next) => setValue(next)
        return flagsStore.subscribe(sync)
      }, [])
      return value
    }
