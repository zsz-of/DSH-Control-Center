
    /* ──────────────── 输入框上的 AI 提示词优化（按钮 + 动画 + 撤销） ──────────────── */

    /**
     * 每个会话一份优化状态。
     *
     * 为什么按会话分：输入框是按会话挂载的，把状态放在模块级单一变量上，
     * 切会话后会看到「上一个会话的撤销按钮」——那是错的。
     *
     * 状态机：`idle → running → done →（撤销后回）idle`，失败时 `idle/… → error →（自动回）idle`。
     * 刻意**不**在输入框上/下再画一条「正在优化」的提示条——进行中只有「灰罩 + 扫光 + 按钮转圈」，
     * 完成即替换，错误只在按钮旁挂一个短暂的红点，让输入区保持干净。
     */
    const IDLE = { kind: 'idle' }
    const optimizeStates = new Map()
    const optimizeListeners = new Set()

    const optimizeStore = {
      get(sessionId) {
        return optimizeStates.get(sessionId) ?? IDLE
      },
      set(sessionId, next) {
        if (next.kind === 'idle') optimizeStates.delete(sessionId)
        else optimizeStates.set(sessionId, next)
        for (const listener of optimizeListeners) listener()
      },
      subscribe(listener) {
        optimizeListeners.add(listener)
        return () => optimizeListeners.delete(listener)
      },
    }

    /** 订阅「本会话」的优化状态。 */
    function useOptimizeState(sessionId) {
      const [state, setState] = useState(() => optimizeStore.get(sessionId))
      useEffect(() => {
        const sync = () => setState(optimizeStore.get(sessionId))
        sync()
        return optimizeStore.subscribe(sync)
      }, [sessionId])
      return state
    }

    /**
     * 优化进行中的输入区遮罩：把**文字显示区域**变灰、拦掉键鼠输入，并让一道光效从左往右扫过。
     *
     * 视觉部分走 CSS 伪元素（`.dcc-optimizing [data-input-scroll]::before/::after`），
     * 只覆盖文字显示区域（`data-input-scroll` 那个可滚动的编辑区），而不是整个输入卡片——
     * 卡片下排的「+ / 模型 / 发送」按钮不被盖住。
     * 本组件只负责「挂/摘 class」和「拦住输入事件」，不自己量尺寸、不画任何可见元素。
     */
    function ComposerVeil({ sessionId }) {
      const state = useOptimizeState(sessionId)
      const ref = useRef(null)
      const active = state.kind === 'running'
      useEffect(() => {
        const anchor = ref.current
        const card = anchor?.closest('[data-composer-card]')
        if (card === null || card === undefined) return undefined
        if (!active) {
          card.classList.remove('dcc-optimizing')
          return undefined
        }
        card.classList.add('dcc-optimizing')
        // 光效期间文字区不可输入：拦掉键盘与粘贴（捕获阶段先于编辑器的处理函数）。
        const block = (event) => {
          if (event.type === 'keydown' && event.key === 'Escape') return
          event.preventDefault()
          event.stopPropagation()
        }
        const types = ['keydown', 'keypress', 'beforeinput', 'paste', 'drop', 'cut']
        for (const type of types) card.addEventListener(type, block, true)
        const focused = document.activeElement
        if (focused !== null && typeof focused.blur === 'function' && card.contains(focused)) focused.blur()
        return () => {
          card.classList.remove('dcc-optimizing')
          for (const type of types) card.removeEventListener(type, block, true)
        }
      }, [active])
      return h('span', { ref, style: { display: 'none' } })
    }

    /** ✨ 优化按钮 + 撤销按钮 + 失败提示（`conversation.input.right`）。 */
    function OptimizeButton({ sessionId, useInput, inputActions }) {
      const state = useOptimizeState(sessionId)
      const flags = useFlags()
      const [message, setMessage] = useState(null)
      const stripRef = useRef(null)
      const input = typeof useInput === 'function' ? useInput((snapshot) => snapshot) : undefined
      const draft = typeof input?.draft === 'string' ? input.draft : ''
      const running = state.kind === 'running'

      // 错误红色胶囊 8 秒后自己收走：不占输入区、不额外加一条提示行。
      useEffect(() => {
        if (state.kind !== 'error') return undefined
        const timer = setTimeout(() => optimizeStore.set(sessionId, IDLE), 8000)
        return () => clearTimeout(timer)
      }, [state.kind, sessionId])

      // 失败原因浮层与错误状态同生共死：错误自己收走时不能留下一个孤儿浮层。
      useEffect(() => {
        if (state.kind !== 'error') setMessage(null)
      }, [state.kind])

      /**
       * 点开失败原因：浮层**贴在输入卡片上方**。
       *
       * 为什么不用右下角那个固定的 `.dcc-toast` 位置：输入框本来就在窗口底部，
       * 那样浮层会正好盖住用户刚点的那颗按钮。这里现量一次卡片位置，把浮层放到它上面，
       * 而且用固定定位——任何宽度下都不会把输入卡片撑破。
       */
      const openMessage = () => {
        const card = stripRef.current?.closest('[data-composer-card]')
        const rect = card?.getBoundingClientRect()
        const gap = rect === undefined ? 20 : Math.round(window.innerHeight - rect.top + 12)
        setMessage({ bottom: Math.max(20, Math.min(gap, window.innerHeight - 96)) })
      }

      /**
       * 收起失败提示：浮层关掉、错误状态也一起清掉。
       *
       * 清状态是刻意的——失败时那颗按钮占的就是「优化」的位置，不清状态的话用户读完原因还得
       * 干等 8 秒自动过期才能重试。关掉即回到可用的「优化」。
       */
      const dismissError = () => {
        setMessage(null)
        optimizeStore.set(sessionId, IDLE)
      }

      const run = async () => {
        if (running) return
        const text = draft.trim()
        if (text === '') {
          optimizeStore.set(sessionId, { kind: 'error', message: '输入框是空的，先写点什么再优化。' })
          return
        }
        if (inputActions === undefined || typeof inputActions.setDraft !== 'function') {
          optimizeStore.set(sessionId, { kind: 'error', message: '这个版本的 DSH 没有暴露输入框写入接口，无法替换内容。' })
          return
        }
        optimizeStore.set(sessionId, { kind: 'running' })
        try {
          const result = await postJson('/optimize', { text })
          const optimized = String(result.optimized ?? '').trim()
          if (optimized === '') throw new Error('模型返回了空结果')
          inputActions.setDraft(optimized)
          optimizeStore.set(sessionId, {
            kind: 'done',
            original: text,
            optimized,
            route: `${result.provider}/${result.model}`,
          })
        } catch (failure) {
          optimizeStore.set(sessionId, { kind: 'error', message: failure?.message ?? String(failure) })
        }
      }

      const undo = () => {
        if (state.kind !== 'done') return
        if (inputActions !== undefined && typeof inputActions.setDraft === 'function') inputActions.setDraft(state.original)
        optimizeStore.set(sessionId, IDLE)
      }

      // 开关状态还没拿到（或已被设置页关掉）时，输入框上什么都不显示。
      if (flags === null || flags.optimize?.enabled !== true) return null

      return h(
        'div',
        { className: 'dcc-optbtn', ref: stripRef },
        // 失败时**占用同一个位置**（不再同时出现「优化失败」和「优化」两颗按钮）：
        //   1. 省宽度——320px 手机上输入行只剩 224px 可用，多一颗 31px 的按钮就能把发送按钮顶出卡片；
        //   2. 语义也更顺——出了错，用户要做的是「看发生了什么」，不是盲目再点一次。
        // 关掉浮层（或再点一次胶囊）就清掉错误状态，「优化」随即回来，所以不存在「等 8 秒才能重试」。
        state.kind === 'error'
          ? h(
              Tooltip,
              { label: state.message, side: 'top', delayMs: 400 },
              h(
                'button',
                {
                  type: 'button',
                  'data-tone': 'danger',
                  'aria-expanded': message !== null,
                  onClick: () => (message === null ? openMessage() : dismissError()),
                },
                h(IconWarningOutline16, { size: 13 }),
                // 文字在触屏上藏起来（见 .dcc-chip-text 的媒体查询）：窄屏上「优化失败」四个字
                // 要多占 67px。红色 + 感叹号已经说清「失败了」，原因点一下就有。
                h('span', { className: 'dcc-chip-text' }, '优化失败'),
              ),
            )
          : h(
              Tooltip,
              { label: running ? '正在优化…' : 'AI 优化提示词', side: 'top', delayMs: 400 },
              h(
                'button',
                { type: 'button', disabled: running, onClick: run },
                running ? h(IconLoadingOutline16, { size: 14, className: 'dcc-spin' }) : h(IconSparkle16, { size: 14 }),
                running ? '优化中…' : '优化',
              ),
            ),
        state.kind === 'done'
          ? h(
              Tooltip,
              { label: `已按 ${state.route} 优化后写回输入框，点这里回到原文`, side: 'top', delayMs: 400 },
              h('button', { type: 'button', 'data-tone': 'accent', onClick: undo }, h(IconRefreshOutline16, { size: 13 }), '撤销'),
            )
          : null,
        message === null || state.kind !== 'error'
          ? null
          : h(
              'div',
              { className: 'dcc-toast', 'data-tone': 'danger', role: 'alert', style: { bottom: `${message.bottom}px` } },
              h('span', { className: 'dcc-toast-icon' }, h(IconWarningOutline16, { size: 14 })),
              h('div', { className: 'dcc-toast-text' }, state.message),
              h(Button, { variant: 'ghost', size: 'sm', icon: h(IconCloseOutline16, { size: 13 }), onClick: () => dismissError() }, ''),
            ),
      )
    }
