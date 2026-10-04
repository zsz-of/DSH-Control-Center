/**
 * `dsh-control-center` client —— 统一设置页：规则 / MCP / 技能 / 记忆 / 导入 / 备份 / 设置，
 * 外加输入框上的「AI 提示词优化」按钮。
 *
 * **本文件由 `lib/client/*.js` 拼接生成**（`node scripts/build-client.mjs`），不要直接改它：
 * DSH 只按 `exports["./client"]` 提供一个 URL（`/plugins/<id>/client.js`），没有构建器可用，
 * 所以物理上必须是单文件；拼接式构建让源码仍按领域分片、每片都能单读。
 *
 * 浏览器侧是 `window.__ModuleLoader__.load` 手写的 CJS 风格 bundle（无第三方依赖）：
 * `react` / `@deepseek-ai/dsh-client-ui-primitives` 由宿主的冻结模块表提供。
 * 所有数据经 host HTTP API `/api/dsh-control-center` 读写，写操作回传完整 state，
 * 本侧**不做乐观更新**——单一真源在 host。
 *
 * 顶栏留白：桌面壳用 `titleBarOverlay` 把最小化/最大化/关闭按钮画在网页顶部，
 * 网页自己必须让位。这里不写死 36px，而是优先量 `env(titlebar-area-height)`，
 * 并且只在**真的会重叠**时补留白（居中弹窗在窗口够高时不需要），避免白占一片空白。
 */

window.__ModuleLoader__.load({
  id: 'dsh-control-center',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')
    const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = react

    /* ── primitives 兼容层：DSH 0.2 整套改了图标的导出名 ──────────────────
       NEXT(0.2.0-rc.2) 把图标名从「尺寸后缀」换成「粗细后缀」：
         IconFooOutline16 / IconFooOutline14 → IconFooOutlineRegular
         IconFooOutline20                    → IconFooOutlineMedium
         IconFoo16                           → IconFooRegular（或 Medium）
       旧名一个都不剩。本插件按旧名解构，拿到的全是 undefined，渲染时抛
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

    /**
     * 注入面：`slots` 是插槽注册；`sessions` 是「⋯ 更多 → 彻底删除」要用的会话列表、摘行与新建
     * （平台没有删会话的 API，磁盘文件由 host 半侧删，列表行只能 `handleSessionRemoved` 摘）。
     */
    const inject = ['slots', 'sessions']
    const NS = 'control-center'
    const API = '/api/dsh-control-center'
    const STYLE_ID = 'dsh-control-center-style'

    const {
      Button,
      Input,
      MenuItemButton,
      Modal,
      StateDot,
      Tooltip,
      IconArchiveOutline20,
      IconCheckOutline16,
      IconCloseOutline16,
      IconContextInjectionOutline16,
      IconCordisPluginOutline14,
      IconDownloadOutline16,
      IconEditOutline16,
      IconFolderOpenOutline16,
      IconLoadingOutline16,
      IconPersonalizationOutline16,
      IconPlusOutline16,
      IconRefreshOutline16,
      IconSearchOutline16,
      IconSettingsOutline16,
      IconSkillOutline16,
      IconSparkle16,
      IconTrashOutline16,
      IconWarningOutline16,
    } = primitives
