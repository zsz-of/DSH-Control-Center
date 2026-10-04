/**
 * 任务流半侧（原 `dsh-chat-flow`）客户端分片 —— 第 1 片：头部。
 *
 * **这一组不自己开 bundle**：合并进 `dsh-control-center` 之后，浏览器侧只有一个
 * `window.__ModuleLoader__.load({ id: 'dsh-control-center', factory })`（在 `lib/client/00-head.js`）。
 * 本文件从 `const react = require('react')` 开始，正好是那个 factory 体内的代码；
 * `scripts/build-client.mjs` 把这一整组分片包进一个 IIFE（自带 `module` / `exports`），
 * 拼在核心组中间分片之后、核心组 `99-tail.js` 之前——两半因此可以同名
 * （`NS` / `API` / `installStyles` / `apply` / …）而互不干扰。
 *
 * `react` 与 `@deepseek-ai/dsh-client-ui-primitives` 由宿主的冻结模块表提供（平台 seed word），
 * 经外层 factory 的 `require` 形参拿到。
 *
 * 数据来源是任务流视图的关键设计：整棵对话节点树经 ui-chat 的
 * `uiSession.provide({hooks:['chat']})` 作为标准 hook 暴露给**所有** session 作用域条目，
 * 因此视图用 `props.useChat` 就能拿到它，不需要 fork 核心渲染器、不读 DOM，
 * 也不需要 host 再算一份数据。
 */

    const react = require('react')
    const { useState, useEffect, useMemo, useCallback, useRef } = react

    /* ── primitives 兼容层：DSH 0.2 整套改了图标的导出名 ──────────────────
       NEXT(0.2.0-rc.2) 把图标名从「尺寸后缀」换成「粗细后缀」：
         IconFooOutline16 / IconFooOutline14 → IconFooOutlineRegular
         IconFooOutline20                    → IconFooOutlineMedium
         IconFoo16                           → IconFooRegular（或 Medium）
       旧名一个都不剩。本插件按旧名取图标，拿到的是 undefined，渲染时抛
       React #130（Element type is invalid），整块插槽变成错误态而白屏。
       在入口处归一化一次，后面所有分片就都按新名拿到组件；实在没有对应项的
       降级成空组件——少一个图标，远好过整块视图崩掉。
       Button / Input / Modal / StateDot / Tooltip 这些原子名字没变，不在这里兜底。 */
    const RAW_PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives')

    /** 旧图标名 → 当前实际存在的导出名（找不到返回 null）。 */
    function modernIconName(name) {
      const outlined = /^(Icon.+Outline)(\d+)$/.exec(name)
      if (outlined !== null) return `${outlined[1]}${Number(outlined[2]) >= 20 ? 'Medium' : 'Regular'}`
      const plain = /^(Icon.+?)(\d+)$/.exec(name)
      if (plain === null) return null
      const suffixes = Number(plain[2]) >= 20 ? ['Medium', 'Regular'] : ['Regular', 'Medium']
      for (const suffix of suffixes) {
        const candidate = `${plain[1]}${suffix}`
        if (RAW_PRIMITIVES[candidate] !== undefined) return candidate
      }
      return null
    }

    /** 兜底图标：名字对不上时用它，保证 `h(Component)` 不会拿到 undefined。 */
    function EmptyIcon() {
      return null
    }

    const primitives = new Proxy(RAW_PRIMITIVES, {
      get(target, property) {
        const value = target[property]
        if (value !== undefined) return value
        if (typeof property !== 'string' || property.startsWith('Icon') !== true) return value
        const modern = modernIconName(property)
        return modern !== null && target[modern] !== undefined ? target[modern] : EmptyIcon
      },
    })
    const h = react.createElement

    /** 客户端插件依赖的服务：插槽表、本地化、会话绑定（拉更早的历史用）。 */
    const inject = ['slots', 'locale', 'sessions']

    /**
     * 核心组递进来的**界面开关通道**。
     *
     * 合并成一个插件后两组分片仍在各自的 IIFE 里，拿不到彼此的顶层变量，所以「任务页面 /
     * 子代理显示」这两个开关只能由核心组在 `apply` 时把它那份开关 store 递进来（见
     * `lib/client/99-tail.js` 末尾的 `chatFlow.apply(ctx, { flagsStore, FLAGS_FALLBACK })`）。
     *
     * 默认值是**空实现**：单独跑这半侧（测试、或将来有人把这组再拆出去）时两个开关都当「开」，
     * 行为与合并前一致——不能因为「没人递通道」就把任务视图整个藏起来。
     */
    const uiFlagsBridge = {
      /** 读当前开关（`{ optimize, ui }`）；没拉到时返回 `null`。 */
      read: () => null,
      /** 订阅开关变化，返回取消订阅的函数。 */
      subscribe: () => () => {},
      /** 拉不到开关时的兜底，与核心组 `FLAGS_FALLBACK.ui` 保持一致。 */
      fallback: { taskView: true, subagent: true },
    }

    /**
     * 界面开关的当前值。
     *
     * 只把 `false` 当「关」：host 还没答（`null`）、字段缺失、或以后加了新字段，都按「开」处理。
     *
     * @returns `{ taskView, subagent }`。
     */
    function uiFlags() {
      const flags = uiFlagsBridge.read()
      const ui = flags === null || flags === undefined ? undefined : flags.ui
      if (ui === null || ui === undefined) return uiFlagsBridge.fallback
      return { taskView: ui.taskView !== false, subagent: ui.subagent !== false }
    }

    /**
     * 订阅界面开关（React hook）。
     *
     * 「子代理显示」要在**不重挂整棵树**的前提下生效（重挂会丢掉展开状态与滚动位置），
     * 所以用订阅 + 状态，而不是靠父级重渲染。
     *
     * @returns `{ taskView, subagent }`。
     */
    function useUiFlags() {
      const [value, setValue] = react.useState(() => uiFlags())
      react.useEffect(() => {
        const sync = () => setValue(uiFlags())
        // 订阅期间可能已经变过：挂载后再对齐一次，避免「装上了但显示的还是订阅前的值」。
        sync()
        const unsubscribe = uiFlagsBridge.subscribe(sync)
        return typeof unsubscribe === 'function' ? unsubscribe : () => {}
      }, [])
      return value
    }

    /** locale namespace 与样式 tag 都必须是全局唯一的（不同插件共用同一张注册表）。 */
    const NS = 'chat-flow'
    const STYLE_ID = 'dsh-chat-flow-style'
    const COLLAPSE_KEY = 'dsh-chat-flow.collapse'

    /**
     * 本插件留在**会话级存储**里的全部键前缀（都拼成 `<前缀>.<sessionId>`）。
     *
     * 列在这里而不是散在各分片，是因为「会话删了要把本插件的东西一起带走」这件事
     * 需要一个**唯一清单**：漏掉任何一个，那个键就再也没人会读（键里带着 sessionId），
     * 只会一直躺在用户的存储里。
     */
    const SESSION_KEY_PREFIXES = [
      COLLAPSE_KEY,
      'dsh-chat-flow.scroll',
      'dsh-chat-flow.ended-away',
    ]

    /**
     * 清掉本插件给某个会话留下的全部数据（会话被删除时调用）。
     *
     * **存储不可用不能把删除动作带崩**：隐私模式、配额打满时读写都会抛，
     * 而「少清几个键」远比「删不掉会话」轻得多，所以整体静默降级。
     *
     * @param sessionId - 被删除的会话 id。
     * @param env - `{localStorage, sessionStorage}`（真机传 `window`，测试传替身）。
     * @returns 实际删掉的键个数（排查与测试用）。
     */
    function purgeSessionData(sessionId, env) {
      if (typeof sessionId !== 'string' || sessionId === '') return 0
      const suffix = `.${sessionId}`
      let removed = 0
      for (const store of [env?.localStorage, env?.sessionStorage]) {
        if (store === null || store === undefined || typeof store.removeItem !== 'function') continue
        try {
          const doomed = []
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index)
            if (typeof key === 'string' && SESSION_KEY_PREFIXES.some((prefix) => key === `${prefix}${suffix}`)) {
              doomed.push(key)
            }
          }
          for (const key of doomed) {
            store.removeItem(key)
            removed += 1
          }
        } catch (_) {
          // 存储不可用（隐私模式 / 配额满）：放弃清理，但不影响调用方继续删会话。
        }
      }
      return removed
    }

    /**
     * 找出「本插件留了数据、但会话列表里已经没有」的 sessionId。
     *
     * 核心**没有**会话删除事件（`ctx.sessions` 只给一个列表快照），所以删除只能这样发现：
     * 会话列表变了之后，比对哪些 id 不见了。调用方再对每个 id 调 `purgeSessionData`。
     *
     * 两道保险，防止把**还活着**的会话的数据误删（顺序很重要）：
     * 1. `alive` 为空时一律不动手——重连重拉会让列表短暂变空，那时候「全都不见了」不是事实；
     * 2. 正在看的那个会话由调用方排除（`useSessions` 的列表里可能还没有它，比如刚建的空会话）。
     *
     * @param env - `{localStorage, sessionStorage}`。
     * @param alive - 会话列表里的 id 集合。
     * @returns 消失的 sessionId 数组（去重，顺序按存储里的先来后到）。
     */
    function staleSessionIds(env, alive) {
      const gone = []
      if (alive === null || alive === undefined || alive.size === 0) return gone
      for (const store of [env?.localStorage, env?.sessionStorage]) {
        if (store === null || store === undefined || typeof store.key !== 'function') continue
        try {
          for (let index = 0; index < store.length; index += 1) {
            const key = store.key(index)
            if (typeof key !== 'string') continue
            for (const prefix of SESSION_KEY_PREFIXES) {
              const head = `${prefix}.`
              if (!key.startsWith(head)) continue
              const sessionId = key.slice(head.length)
              if (sessionId !== '' && !alive.has(sessionId) && !gone.includes(sessionId)) gone.push(sessionId)
            }
          }
        } catch (_) {
          // 存储不可用：放弃这一轮清理（同上，静默降级）。
        }
      }
      return gone
    }

    /**
     * 本视图自己的条目 id 与排序位。
     *
     * **为什么不遮蔽核心「对话」视图**：视图选择的 fallback 硬编码为 `id === 'chat'`，
     * 遮蔽（同 id + 更低 priority）确实能让本视图成为默认，代价是核心那条条目仍在账本里，
     * 标签栏读的正是账本 → 出现两个标签、且两个都带激活下划线（`aria-selected` 按 id 比对）。
     * 而核心**不允许注销别人的条目**（`StoredEntry` 无 disposer），所以遮蔽必然留下重复标签。
     *
     * 现在的做法：用独立 id 作为**并列视图**（原生「对话」仍是默认），标签栏只有一个高亮；
     * 想用任务流视图点「任务」标签即可（选择会被持久化）。
     */
    const TAB_VIEW_ID = 'flow'
    const TAB_VIEW_ORDER = 5

    /**
     * 跳到某个回合时，在滚动口顶部留出的空隙（核心 `landOnRow` 硬编码 24px，这里用同一量级）。
     *
     * 放在 head 里是因为它被两个分片共用：`80-view.js` 的刻度跳转与 `85-scroll.js` 的翻页落位。
     */
    const RAIL_LAND_OFFSET_PX = 24

    /** JSON 安全序列化：`payload` 里可能有循环引用或 BigInt，序列化失败不能把整块视图带崩。 */
    function safeStringify(value) {
      try {
        return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }

    /* 以下四个是 primitives 缺失时的退路：DSH 升级若改名或移除某个原语，
       视图仍然可读，而不是整块变成 `data-slot-error`。 */
    function PlainText({ text }) {
      return h('div', { className: 'dcf-text' }, String(text ?? ''))
    }
    function PlainJson({ payload }) {
      return h('pre', { className: 'dcf-pre' }, safeStringify(payload))
    }
    function PlainTerminal({ command, output }) {
      const text = `${command ?? ''}${output ? `\n\n${output}` : ''}`
      return h('pre', { className: 'dcf-pre' }, text)
    }
    function PlainDot({ className }) {
      return h('span', { className: className ?? 'dcf-dot dcf-dot-pending' })
    }

    /** 取 primitives 里的组件，拿不到就用退路。 */
    function componentOr(candidate, fallback) {
      if (typeof candidate === 'function') return candidate
      if (candidate !== null && typeof candidate === 'object') return candidate
      return fallback
    }

    const MarkdownText = componentOr(primitives.MarkdownText, PlainText)
    const JsonBlock = componentOr(primitives.JsonBlock, PlainJson)
    const TerminalBlock = componentOr(primitives.TerminalBlock, PlainTerminal)
    const StateDot = componentOr(primitives.StateDot, PlainDot)
    /** 0.2 的 primitives 里没有 `MessageText`；用户发言的行内内容由 `projectUserText` 投影出来。 */
    const projectUserText = componentOr(primitives.projectUserText, null)

    /**
     * 用户发言的行内内容。
     *
     * 平台自己的用户气泡是 `div.bubble > projectUserText(text, referenceLabels, skillNames, 'skill', references)`：
     * 它把 `@文件` / `/技能` token 投影成带图标的 chip。以前这里用的是 `primitives.MessageText`
     * ——**0.2 里没有这个导出**，于是 `componentOr` 每次都退回纯文本，用户气泡永久降级。
     * 这里改成用真实存在的 `projectUserText`；原语缺席（更老的宿主）时才退回纯文本。
     *
     * @param props - `text`。
     * @returns 行内内容（可能是一串 chip + 文本片段）。
     */
    function UserText({ text }) {
      const value = typeof text === 'string' ? text : ''
      if (typeof projectUserText !== 'function') return String(value)
      try {
        return projectUserText(value, [], [], 'skill', undefined)
      } catch {
        return String(value)
      }
    }
