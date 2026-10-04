    /* ──────────────────────────── 折叠状态 ──────────────────────────── */

    /**
     * 折叠/展开状态按「会话 + 块键」存进 localStorage。
     *
     * 验收第 2 条要求折叠状态「刷新后不还原」，所以必须落盘；块键形如
     * `plan:3` / `task:3:1` / `proc:3:1`，同一会话里每个块各自记住自己的状态。
     *
     * localStorage 在隐私模式或被策略禁用时会抛异常，此时退回进程内对象：
     * 功能降级成「本页会话内有效」，但绝不因为存储不可用而白屏。
     */
    const collapseStore = new Map()

    /**
     * 读取并缓存某个会话的折叠表。
     *
     * @param sessionId - 会话 id。
     * @returns `{map, listeners}`；`map` 是块键 → 是否展开。
     */
    function collapseEntry(sessionId) {
      let entry = collapseStore.get(sessionId)
      if (entry !== undefined) return entry
      let map = {}
      try {
        const raw = window.localStorage.getItem(`${COLLAPSE_KEY}.${sessionId}`)
        const parsed = raw === null ? null : JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') map = parsed
      } catch {
        // 存储不可用：退化成纯内存，行为与用户选的「仅当前会话」一致。
      }
      entry = { map, listeners: new Set() }
      collapseStore.set(sessionId, entry)
      return entry
    }

    /** 把折叠表写回 localStorage；写失败不抛（内存里的状态仍然正确）。 */
    function persistCollapse(sessionId, map) {
      try {
        window.localStorage.setItem(`${COLLAPSE_KEY}.${sessionId}`, JSON.stringify(map))
      } catch {
        // 同上：存储不可用时静默降级。
      }
    }

    /**
     * 丢掉某个会话的进程内折叠表（存储里那一份由 `purgeSessionData` 负责）。
     *
     * 这张 Map 是**永不淘汰**的缓存：每个看过的会话留一条记录。会话删掉之后不丢，
     * 它就会跟着这个页面一直活着——「删除要彻底」在内存侧的最后一环就是这里。
     *
     * ⚠️ 只丢缓存，不动已经挂上的监听者：那些组件随会话一起卸载，自己会退订；
     * 强行清空监听集合反而会让仍然挂在树上的组件失去重渲染能力。
     *
     * @param sessionId - 会话 id。
     * @returns 无。
     */
    function forgetCollapse(sessionId) {
      collapseStore.delete(sessionId)
    }

    /**
     * 一个可折叠块的受控状态。
     *
     * @param sessionId - 会话 id（作用域）。
     * @param blockKey - 块键，会话内唯一。
     * @param defaultOpen - 没有存过状态时的默认值。
     * @returns `[open, toggle]`。
     */
    function useCollapse(sessionId, blockKey, defaultOpen) {
      const entry = collapseEntry(sessionId)
      const [, forceRender] = useState(0)
      useEffect(() => {
        const listener = () => forceRender((value) => value + 1)
        entry.listeners.add(listener)
        return () => {
          entry.listeners.delete(listener)
        }
      }, [sessionId, blockKey])
      const stored = entry.map[blockKey]
      const open = typeof stored === 'boolean' ? stored : defaultOpen
      const toggle = useCallback(() => {
        entry.map[blockKey] = !(typeof entry.map[blockKey] === 'boolean' ? entry.map[blockKey] : defaultOpen)
        persistCollapse(sessionId, entry.map)
        for (const listener of entry.listeners) listener()
      }, [sessionId, blockKey, defaultOpen])
      return [open, toggle]
    }
