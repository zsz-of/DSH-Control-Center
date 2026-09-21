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
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } = react
    const h = react.createElement

    const inject = ['slots']
    const NS = 'control-center'
    const API = '/api/dsh-control-center'
    const STYLE_ID = 'dsh-control-center-style'

    const {
      Button,
      Input,
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
