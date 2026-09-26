/**
 * 本文件由 scripts/build-client.mjs 自动生成，请勿直接编辑。
 * 源码分片（按拼接顺序）：
 *   - lib/client/00-head.js
 *   - lib/client/10-style.js
 *   - lib/client/20-core.js
 *   - lib/client/30-rules.js
 *   - lib/client/40-mcp.js
 *   - lib/client/50-skills.js
 *   - lib/client/60-memory.js
 *   - lib/client/70-scan.js
 *   - lib/client/80-backup.js
 *   - lib/client/85-settings.js
 *   - lib/client/90-composer.js
 *   - lib/client/95-panel.js
 *   - lib/client/99-tail.js
 *
 * 修改流程：改 lib/client/*.js → node scripts/build-client.mjs
 */

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

    /* ─────────────────────────── 顶栏留白测量 ─────────────────────────── */

    /** 量出网页顶部被窗口按钮占用的高度与（macOS）左侧占用宽度。 */
    function measureTitleBar() {
      const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
      // 先按 WCO 环境变量量真实值；测不到再退回平台经验值。
      let height = 0
      try {
        const probe = document.createElement('div')
        probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;height:env(titlebar-area-height,0px)'
        document.body.appendChild(probe)
        height = probe.getBoundingClientRect().height
        probe.remove()
      } catch {
        height = 0
      }
      if (!Number.isFinite(height) || height <= 0) height = isMac ? 28 : 36
      return { height, leftInset: isMac ? 76 : 0 }
    }

    /**
     * 只在自身顶部真的进入标题栏区域时补留白。
     *
     * 设置面板是居中弹窗：窗口够高时面板顶边在标题栏之下，此时补留白只会白占空间；
     * 窗口被压矮时面板顶边会上移，必须让位。用 layout effect + ResizeObserver 测，不轮询。
     */
    function useTitleBarGuard(ref) {
      const [guard, setGuard] = useState({ top: 0, left: 0 })
      useLayoutEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        const bar = measureTitleBar()
        const apply = () => {
          const rect = node.getBoundingClientRect()
          const overlapTop = rect.top < bar.height ? bar.height - rect.top : 0
          const overlapLeft = rect.left < bar.leftInset ? bar.leftInset - rect.left : 0
          setGuard((previous) =>
            previous.top === overlapTop && previous.left === overlapLeft ? previous : { top: overlapTop, left: overlapLeft },
          )
        }
        apply()
        const observer = new ResizeObserver(apply)
        observer.observe(node)
        window.addEventListener('resize', apply)
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', apply)
        }
      }, [ref])
      return guard
    }

    /* ─────────────────────────────── 样式 ─────────────────────────────── */

    /**
     * 全部样式一次性注入。
     *
     * 颜色一律走 CSS 变量（--dcc-* 这一族），深浅色主题只切换变量值——这样新增界面不需要
     * 再写一遍浅色/深色两套规则，也就不会出现「漏改一处、暗色下糊成一片」。
     */
    function installStyles() {
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.dataset.plugin = NS
      style.textContent = `
/* 调色板挂在全局作用域（而不是只挂在 .dcc 上）：设置页与聊天输入框上的
   优化按钮/状态条/灰罩都要用同一套颜色变量，只挂在 .dcc 里会让输入框那一侧取不到值。 */
html{--dcc-fg:#202124;--dcc-muted:#6b7280;--dcc-line:#e5e7eb;--dcc-soft:#f6f7f8;--dcc-card:#fff;
     --dcc-accent:#4d6bfe;--dcc-danger:#d93025;--dcc-warn:#b26a00;--dcc-ok:#1a7f37;
     --dcc-veil:rgba(120,126,140,.22);--dcc-sheen:rgba(120,155,255,.42)}
body[data-ds-dark-theme]{--dcc-fg:#f3f4f6;--dcc-muted:#9aa0a6;--dcc-line:#33363b;--dcc-soft:#232529;
     --dcc-card:#1b1b1d;--dcc-accent:#8aa4ff;--dcc-danger:#f28b82;--dcc-warn:#fdd663;--dcc-ok:#81c995;
     --dcc-veil:rgba(18,20,24,.45);--dcc-sheen:rgba(150,180,255,.30)}
.dcc{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13px;color:var(--dcc-fg)}
.dcc-head{display:flex;align-items:center;gap:8px;padding:2px 0 10px}
.dcc-title{font-size:15px;font-weight:600;margin:0}
.dcc-sub{color:var(--dcc-muted);font-size:12px;margin-left:auto;text-align:right;line-height:1.5;max-width:60%}
.dcc-tabs{display:flex;gap:6px;border-bottom:1px solid var(--dcc-line);margin-bottom:16px;overflow-x:auto;scrollbar-width:thin}
.dcc-tab{appearance:none;border:0;background:none;padding:8px 14px;font:inherit;color:var(--dcc-muted);
  cursor:pointer;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;display:flex;align-items:center;gap:6px;white-space:nowrap}
.dcc-tab:hover{background:var(--dcc-soft);color:var(--dcc-fg)}
.dcc-tab[data-active='true']{color:var(--dcc-accent);border-bottom-color:var(--dcc-accent);font-weight:600}
.dcc-tab .dcc-count{font-size:11px;color:var(--dcc-muted);background:var(--dcc-soft);border-radius:999px;padding:0 6px}
.dcc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.dcc-bar .dcc-grow{flex:1;min-width:120px}
/* 提示消息走浮窗（toast）：固定右下角、自动消失，不插进页面内容里。 */
.dcc-toast{position:fixed;right:20px;bottom:20px;z-index:1100;display:flex;gap:10px;align-items:flex-start;
  box-sizing:border-box;max-width:min(440px,80vw);padding:12px 14px;border-radius:10px;font-size:12px;line-height:1.6;
  background:var(--dcc-card);color:var(--dcc-fg);border:1px solid var(--dcc-line);
  border-left:3px solid var(--dcc-muted);box-shadow:0 10px 28px rgba(0,0,0,.22);
  animation:dcc-toast-in .18s ease-out}
.dcc-toast[data-tone='ok']{border-left-color:var(--dcc-ok)}
.dcc-toast[data-tone='warn']{border-left-color:var(--dcc-warn)}
.dcc-toast[data-tone='danger']{border-left-color:var(--dcc-danger)}
.dcc-toast .dcc-toast-icon{flex:none;margin-top:1px}
.dcc-toast .dcc-toast-text{flex:1;min-width:0;white-space:pre-line;word-break:break-word;max-height:40vh;overflow:auto}
.dcc-toast[data-tone='ok'] .dcc-toast-icon{color:var(--dcc-ok)}
.dcc-toast[data-tone='warn'] .dcc-toast-icon{color:var(--dcc-warn)}
.dcc-toast[data-tone='danger'] .dcc-toast-icon{color:var(--dcc-danger)}
@keyframes dcc-toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.dcc-layout{display:flex;flex-direction:column;min-height:0;flex:1}
.dcc-list{display:flex;flex-direction:column;gap:10px;overflow:auto;min-height:0;padding-right:2px}
.dcc-card{border:1px solid var(--dcc-line);border-radius:10px;background:var(--dcc-card);padding:12px 14px;
  display:flex;gap:12px;align-items:flex-start}
.dcc-card[data-off='true']{opacity:.55}
.dcc-card[data-pick='true']{cursor:pointer}
.dcc-col{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}
.dcc-name{font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;word-break:break-word}
.dcc-desc{color:var(--dcc-muted);font-size:12px;line-height:1.5;word-break:break-word}
.dcc-meta{color:var(--dcc-muted);font-size:11px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  word-break:break-all}
.dcc-acts{display:flex;gap:4px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
.dcc-badge{border:1px solid var(--dcc-line);border-radius:999px;padding:1px 8px;font-size:11px;color:var(--dcc-muted);white-space:nowrap}
.dcc-badge[data-tone='always']{color:var(--dcc-accent);border-color:currentColor}
.dcc-badge[data-tone='warn']{color:var(--dcc-warn);border-color:currentColor}
.dcc-badge[data-tone='danger']{color:var(--dcc-danger);border-color:currentColor}
.dcc-badge[data-tone='ok']{color:var(--dcc-ok);border-color:currentColor}
.dcc-empty{color:var(--dcc-muted);text-align:center;padding:28px 0;font-size:12px}
.dcc-err{color:var(--dcc-danger);font-size:12px;display:flex;gap:6px;align-items:center}
.dcc-err[data-tone='warn']{color:var(--dcc-warn)}
.dcc-form{display:flex;flex-direction:column;gap:12px}
.dcc-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dcc-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.dcc-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dcc-label{font-size:12px;font-weight:600}
.dcc-hint{font-size:11px;color:var(--dcc-muted);line-height:1.5}
.dcc-field input,.dcc-field select,.dcc-field textarea{font:inherit;color:inherit;background:var(--dcc-card);
  border:1px solid var(--dcc-line);border-radius:6px;padding:6px 8px;width:100%;box-sizing:border-box}
.dcc-field textarea{resize:vertical;line-height:1.6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
/* 注入模式：只给两个可点的选项，不解释内部机制。 */
.dcc-modes{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.dcc-mode{border:1px solid var(--dcc-line);border-radius:10px;padding:12px 14px;cursor:pointer;background:var(--dcc-card);
  display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;transition:border-color .12s,box-shadow .12s}
.dcc-mode:hover{border-color:var(--dcc-accent)}
.dcc-mode[data-on='true']{border-color:var(--dcc-accent);box-shadow:inset 0 0 0 1px var(--dcc-accent);color:var(--dcc-accent)}
.dcc-mode .dcc-dot{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--dcc-line);flex:none}
.dcc-mode[data-on='true'] .dcc-dot{border-color:var(--dcc-accent);box-shadow:inset 0 0 0 3px var(--dcc-accent)}
/* 开关一律用滑块（switch）：布尔设置项的唯一外观。 */
.dcc-switch{display:inline-flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;user-select:none}
.dcc-switch input{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:36px;height:20px;margin:0;
  border-radius:999px;background:var(--dcc-line);cursor:pointer;transition:background .15s ease;outline:none}
.dcc-switch input::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s ease}
.dcc-switch input:checked{background:var(--dcc-accent)}
.dcc-switch input:checked::after{transform:translateX(16px)}
.dcc-switch input:disabled{opacity:.5;cursor:default}
.dcc-switchrow{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--dcc-line)}
.dcc-switchrow:last-child{border-bottom:0}
.dcc-switchrow .dcc-col{gap:3px}
.dcc-foot{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
.dcc-busy{display:flex;align-items:center;gap:6px;color:var(--dcc-muted);font-size:12px;margin-right:auto}
/* 弹窗尺寸：**必须写在 className（= .dialog）上**——原语把 .dialog 写死成
   width:min(380px,100%) + overflow:hidden，只改 contentClassName 的话更宽的内容会被裁掉。
   选择器用 [role='dialog'] + 类名提高特异性，避免和原语的 CSS Module 类比「谁后注入」。 */
[role='dialog'].dcc-dialog{width:min(720px,94vw);max-height:88vh}
[role='dialog'].dcc-dialog-wide{width:min(1060px,96vw)}
.dcc-modal{box-sizing:border-box;min-width:0;max-height:calc(88vh - 128px);overflow:auto;overscroll-behavior:contain;padding:2px}
/* 内容再长时滚的是这个区域；把标题行吸顶，免得滚动后连关闭按钮都找不到。
   背景用平台自己的 layer-2 令牌，取不到才退回本插件的卡片色（差值极小）。 */
[role='dialog'].dcc-dialog .dcc-modal>*:first-child{position:sticky;top:0;z-index:2;
  background:var(--dsw-alias-bg-layer-2,var(--dcc-card))}
.dcc-modal .dcc-field,.dcc-modal .dcc-form,.dcc-modal .dcc-narrow{min-width:0}
.dcc-modal .dcc-meta,.dcc-modal .dcc-desc{overflow-wrap:anywhere}
@media (max-width:720px){
  .dcc-row2,.dcc-row3,.dcc-modes{grid-template-columns:1fr}
}
.dcc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
.dcc-pick{border:1px solid var(--dcc-line);border-radius:8px;padding:8px 10px;background:var(--dcc-card);
  display:flex;gap:8px;align-items:center;cursor:pointer}
.dcc-pick[data-on='true']{border-color:var(--dcc-accent)}
.dcc-pick[data-off='true']{opacity:.6;cursor:default}
/* 只用来排版、本身不可点的卡片（如自定义扫描源，只有右侧的删除按钮可点）。 */
.dcc-pick-static{cursor:default}
/* 「从一堆条目里挑几条」用原生复选框，不用滑块：一屏几十项时，方框的「已选 / 未选」
   比滑块好扫，而滑块表达的是「这个开关的状态」。 */
.dcc-pick-check input[type='checkbox']{flex:none;width:15px;height:15px;margin:0;accent-color:var(--dcc-accent);cursor:pointer}
.dcc-pick-check[data-off='true'] input[type='checkbox']{cursor:default}
.dcc-pick .dcc-col{gap:2px}
.dcc-pick .dcc-pickswitch{flex:none;display:flex;align-items:center}
.dcc-table{width:100%;border-collapse:collapse;font-size:12px}
.dcc-table th,.dcc-table td{border-bottom:1px solid var(--dcc-line);padding:5px 6px;text-align:left;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}
.dcc-table th{font-family:inherit;color:var(--dcc-muted);font-weight:600}
.dcc-scrollbox{border:1px solid var(--dcc-line);border-radius:8px;max-height:280px;overflow:auto;padding:0 8px}
.dcc-stat{display:flex;gap:14px;flex-wrap:wrap;color:var(--dcc-muted);font-size:12px}
.dcc-stat b{color:var(--dcc-fg);font-weight:600}
.dcc-split{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.dcc-split .dcc-grow{flex:1;min-width:180px}
.dcc-warnbox{border:1px solid var(--dcc-warn);color:var(--dcc-warn);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.6}

/* ── 输入框上的 AI 优化：灰罩 + 从左往右扫过的光效 ──
   只盖**文字显示区域**（data-input-scroll 这个可滚动编辑区），
   不盖整张输入卡片，所以下排的「+ / 模型 / 发送」按钮保持可用/可见。 */
.dcc-optimizing [data-input-scroll]{position:relative;overflow-x:hidden}
.dcc-optimizing [data-input-scroll]::after{content:'';position:absolute;inset:0;border-radius:8px;background:var(--dcc-veil);
  z-index:6;cursor:progress;pointer-events:auto;animation:dcc-veil-in .16s ease-out;backdrop-filter:saturate(.35)}
.dcc-optimizing [data-input-scroll]::before{content:'';position:absolute;top:0;bottom:0;left:-45%;width:42%;z-index:7;pointer-events:none;
  border-radius:8px;filter:blur(3px);
  background:linear-gradient(100deg,transparent 0%,var(--dcc-sheen) 48%,transparent 100%);
  animation:dcc-sweep 1.15s cubic-bezier(.45,.05,.55,.95) infinite}
@keyframes dcc-sweep{from{left:-45%}to{left:103%}}
@keyframes dcc-veil-in{from{opacity:0}to{opacity:1}}
.dcc-optbtn{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;min-width:0}
.dcc-optbtn button{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dcc-line);background:var(--dcc-card);
  color:var(--dcc-muted);border-radius:999px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;line-height:1.4}
.dcc-optbtn button:disabled{opacity:.55;cursor:default}
.dcc-optbtn button[data-tone='accent']{color:var(--dcc-accent);border-color:currentColor}
/* 「优化失败」是个按钮而不是只有 title 的徽标：手机上悬停不出提示，
   失败原因必须点得开（点开后在右下角浮层里给全文，见 90-composer.js）。 */
.dcc-optbtn button[data-tone='danger']{color:var(--dcc-danger);border-color:currentColor}
.dcc-optbtn .dcc-spin{animation:dcc-spin 1s linear infinite}
@keyframes dcc-spin{to{transform:rotate(360deg)}}
/* 悬停效果只在真的有指针时才有意义：触屏上 :hover 会在点完后粘住。 */
@media (hover:hover){
  .dcc-optbtn button:hover:not(:disabled){color:var(--dcc-accent);border-color:currentColor}
}
/* 触屏（手机）适配：上游自己的发送 / 追加按钮是 34px，而这两个按钮在 12px 字号 + 4px 内边距下
   只有 27px 高——手指按不准。这里**只抬高度**，横向留白反而收窄：
   窄到 320px 时输入行的可用宽度只有 224px，而上游那层 trailing 容器（flex:none）不会收缩，
   我们的按钮每宽 1px 就把整行顶出去 1px（实测按钮宽到 69px 时整行溢出 5px，宽 61px 时 0px）。 */
@media (pointer:coarse){
  .dcc-optbtn button{min-height:36px;padding:8px 8px}
  /* 「优化失败」在触屏上只留图标：省下的 67px 正是窄屏上把发送按钮顶出卡片的那 67px。 */
  .dcc-optbtn .dcc-chip-text{display:none}
}
/* 系统要求减少动效时，扫光改成静止的一层柔光（它只是「正在处理」的信号，不是必须的动画）。 */
@media (prefers-reduced-motion:reduce){
  .dcc-optimizing [data-input-scroll]::after{animation:none}
  .dcc-optimizing [data-input-scroll]::before{animation:none;left:0;width:100%;opacity:.3}
  .dcc-optbtn .dcc-spin{animation:none}
}
.dcc-narrow{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1}

/* ── 控制中心整页（挂在 shell.overlay 上，覆盖整个窗口） ── */
.dcc-panel{position:fixed;inset:0;z-index:30;background:var(--dcc-card);overflow:hidden;box-sizing:border-box}
/* 页头一条做成可拖拽区（整页压住了原来的标题栏），按钮本身排除在外。
   顶部用 useTitleBarGuard 量出的 padding 让开 Windows 窗口按钮；页头再加一段自身 padding，
   把右上角的「关闭」往下压，避免与窗口自己的最小化/最大化/关闭挤在同一高度。 */
.dcc-panel-head{display:flex;align-items:center;gap:12px;padding:16px 20px 12px;border-bottom:1px solid var(--dcc-line);
  background:var(--dcc-soft);-webkit-app-region:drag}
.dcc-panel-head button{-webkit-app-region:no-drag}
.dcc-panel-head .dcc-title{font-size:16px}
.dcc-panel-head .dcc-sub{margin-left:auto;max-width:52%;font-size:11px}
.dcc-panel-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:14px 20px 20px}
.dcc-panel .dcc-tabs{margin-bottom:10px}
/* 侧边栏底部入口：与「设置」按钮同一套尺寸与颜色（宽栏 42px 高圆角行、收起栏 36px 圆形） */
.dcc-sideentry{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;appearance:none;border:0;
  background:none;color:var(--dsw-alias-label-primary,var(--dcc-fg));cursor:pointer;border-radius:12px;
  height:42px;padding:0 10px 0 8px;font:inherit;font-size:14px;line-height:22px;text-align:left;overflow:hidden}
.dcc-sideentry:hover{background:var(--dcc-soft)}
.dcc-sideentry[data-active='true']{background:var(--dcc-soft)}
.dcc-sideentry[data-rail='true']{justify-content:center;gap:0;width:36px;height:36px;border-radius:50%;margin:0;padding:0;flex:none}
/* 项目规则的位置提示（会话「规则」视图用；控制中心不再有作用域切换条） */
.dcc-pathbar{color:var(--dcc-muted);font-size:12px;word-break:break-all;margin-bottom:8px}
/* 会话里的「规则」视图需要自己占满高度，并留出左右内边距（别抵到边缘） */
.dcc-view{height:100%;min-height:0;padding:12px 16px;box-sizing:border-box}
/* 导入备份的替换清单 */
.dcc-replacelist{margin:4px 0 4px 18px;padding:0;font-size:12px;line-height:1.7}
/* 控制中心自己的审批提问卡：平台把「提问」画成无色输入卡，四档选项挤在灰底上很容易点错。
   这里按 data-dcc-rule-ask（见 99-tail.js 的认领逻辑）补一条淡黄警示条与黄边，
   颜色沿用平台审批卡那一套 warn 变量，取不到时退回本插件自己的淡黄。 */
[data-dcc-rule-ask] > section{border:1px solid var(--dsw-alias-state-warn-secondary,var(--dcc-warn));overflow:hidden}
[data-dcc-rule-ask] > section::before{content:'控制中心 · 需要你确认';display:block;padding:6px 14px;
  background:var(--dsw-alias-state-warn-tertiary,rgba(253,214,99,.18));
  color:var(--dsw-alias-state-warn-primary,var(--dcc-warn));font-size:12px;font-weight:600}
/* 会话「规则」页签在位时（95-panel.js 给 <body> 打的标记）：平台的输入框与左右两条
   宽度拖动边缘跟这一页无关，拖了也不影响规则页，直接藏掉。 */
body[data-dcc-rules-view] [data-composer-card],
body[data-dcc-rules-view] [data-width-handle]{display:none}
`
      document.head.appendChild(style)
    }

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
     * **字段名必须和 host 对得上**：这里发的是 `path`（打开目录）或 `file`（定位文件），
     * host 的 `reveal` 只认这两个名字（`path` 优先）。曾经这里发的是 `dir`，host 一律当成
     * 「没给目标」而退回数据根目录——所有「打开目录」按钮都开同一个文件夹，看起来就是按钮坏了。
     *
     * **失败必须说出来**：这个按钮以前把错误静默吞掉，用户看到的就是「点了没反应」——
     * 而最常见的失败原因（目录还不存在）恰恰是最该提示的。
     *
     * @param target - `{ path }` 打开目录，或 `{ file }` 定位文件。
     * @param act - 页面的动作集（用它的浮层提示报错）。
     */
    async function reveal(target, act) {
      try {
        const { result } = await postAction({ section: 'reveal', ...target })
        // 成功也要说话：窗口是系统文件管理器开的，可能落在应用后面，不给反馈和「没反应」一样。
        if (act !== undefined) {
          act.flash({ tone: 'ok', text: `已在文件管理器中打开：${result?.target ?? target.path ?? target.file ?? ''}` })
        }
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

    /* ──────────────────────────── 规则（全局 / 项目） ──────────────────────────── */

    /** 注入模式的两个选项：只给名字，不解释内部机制（用户知道这两个词就够了）。 */
    const RULE_MODES = [
      { id: 'always', label: '强加载' },
      { id: 'ondemand', label: '普通模式' },
    ]

    /** 模式在列表徽标上的显示名。 */
    function modeLabel(mode) {
      return mode === 'always' ? '强加载' : '普通模式'
    }

    /**
     * 「AI 改规则时的审批」三档，顺序即下拉顺序（与 host 侧 `settings.js` 的 `RULE_APPROVALS` 一一对应）。
     *
     * 这是**全局**档位，但项目规则视图与控制中心的规则页共用本组件，所以两个入口都能改——
     * 用户在「项目规则」页看到它才说得通：AI 改的规则里就包括项目规则。
     *
     * 「禁止一次」不在这里：它是「每次询问」时那个弹框上的一个按钮（只拒这一次，档位不动）。
     */
    const RULE_APPROVAL_CHOICES = [
      ['ask', '每次询问'],
      ['allow', '始终允许'],
      ['deny-always', '禁止且不再询问'],
    ]

    /** 选中某一档时的解释：说清「接下来会发生什么」。 */
    const RULE_APPROVAL_HINTS = {
      ask: 'AI 每次要改规则都弹框问你：本轮对话中始终允许 / 此工作区内始终允许 / 禁止一次 / 禁止且不再询问。',
      allow: 'AI 可以直接改规则，不再问你。',
      'deny-always': '一律拒绝 AI 改规则，不再询问；想恢复就改回「每次询问」。',
    }

    function RuleEditor({ draft, onClose, onSubmit, busy, scopeLabel }) {
      const [form, setForm] = useState(draft)
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isNew = draft.file === undefined
      return h(
        FormModal,
        {
          title: `${isNew ? '新建' : '编辑'}${scopeLabel === undefined ? '' : scopeLabel}规则`,
          onClose,
          busy,
          wide: true,
          onSubmit: () => onSubmit(form),
        },
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '名称' }, h('input', { value: form.name, onChange: (e) => patch({ name: e.target.value }), placeholder: '例如：驾驭工程核心规则' })),
          h(Field, { label: '描述' },
            h('input', { value: form.description, onChange: (e) => patch({ description: e.target.value }), placeholder: '一句话说清这条规则管什么' })),
        ),
        h(
          Field,
          { label: '模式' },
          h(
            'div',
            { className: 'dcc-modes' },
            ...RULE_MODES.map((mode) =>
              h(
                'div',
                { key: mode.id, className: 'dcc-mode', 'data-on': form.mode === mode.id, onClick: () => patch({ mode: mode.id }) },
                h('span', { className: 'dcc-dot' }),
                mode.label,
              ),
            ),
          ),
        ),
        h(Field, { label: '正文', hint: draft.file === undefined ? undefined : draft.path },
          h('textarea', { rows: 16, value: form.body, onChange: (e) => patch({ body: e.target.value }), placeholder: '规则正文…' })),
      )
    }

    /**
     * 规则列表 + 编辑，按作用域参数化。
     *
     * 全局规则（`~/.dsh/rules`）与项目规则（`<工作区>/.dsh/rules`）格式完全一样，
     * 所以整个界面只写一份：`scope` 决定读写哪个目录，`workspace` 决定是哪个项目。
     *
     * **作用域不是在这里切的**：控制中心只呈现全局规则，项目规则由会话里的「规则」视图负责
     * （那里的工作区来自会话本身，用户不必自己挑文件夹）。本组件因此不接受切换回调——
     * 作用域是调用方的事实，不是这一页的选项。
     *
     * @param props.scope - `'global'` 或 `'project'`。
     * @param props.workspace - 项目规则的工作区目录（scope=project 时用）。
     */
    function RulesSection({ state, act, busy, error, scope, workspace }) {
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const isProject = scope === 'project'
      const project = state.project
      const dir = isProject ? (project?.dir ?? '') : state.paths.rules
      const items = (isProject ? (project?.items ?? []) : state.rules.items).filter((rule) => {
        if (query.trim() === '') return true
        const needle = query.trim().toLowerCase()
        return `${rule.name} ${rule.description} ${rule.file}`.toLowerCase().includes(needle)
      })
      // 每个写操作都要带作用域：host 靠它决定落哪个目录。
      const scoped = (payload) => ({ ...payload, ...(isProject ? { scope: 'project', workspace } : {}) })

      // 「AI 改规则时的审批」存在插件设置里（全局档位，不分作用域）。
      const approval = state.settings?.rules?.approval ?? 'ask'
      const setApproval = async (value) => {
        const { ok } = await act.run({ section: 'settings', op: 'save', settings: { rules: { approval: value } } })
        if (ok) act.flash(`AI 改规则时的审批已设为「${RULE_APPROVAL_CHOICES.find(([id]) => id === value)?.[1] ?? value}」。`)
      }

      // 「此工作区内始终允许」豁免过的工作区：在审批弹框上点出来的，存在插件设置里。
      const exempt = state.settings?.rules?.allowedWorkspaces ?? []
      const clearExempt = async () => {
        const { ok } = await act.run({ section: 'settings', op: 'save', settings: { rules: { allowedWorkspaces: [] } } })
        if (ok) act.flash('已清除工作区豁免，AI 改规则会重新问你。')
      }

      const openCreate = () => setEditor({ name: '', description: '', mode: isProject ? 'always' : 'ondemand', enabled: true, body: '' })
      const openEdit = async (rule) => {
        try {
          const body = await fetchBody('rule', rule.file, isProject ? { workspace } : {})
          setEditor({ ...rule, body, enabled: rule.enabled !== false })
        } catch (failure) {
          act.report(failure)
        }
      }

      return h(
        'div',
        { className: 'dcc-layout' },
        isProject ? h('div', { className: 'dcc-pathbar' }, workspace === '' ? '这个会话还没有工作区' : `项目：${workspace}`) : null,
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconPlusOutline16, { size: 14 }), disabled: isProject && workspace === '', onClick: openCreate }, '新建规则'),
          h('span', { className: 'dcc-grow' }, h(Input, { icon: h(IconSearchOutline16, { size: 14 }), placeholder: '搜索规则…', value: query, onChange: (e) => setQuery(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.refresh() }, '刷新'),
          dir === '' ? null : h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: dir }, act) }, '打开目录'),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, `${isProject ? '项目' : '全局'}启用 ${isProject ? (project?.activeCount ?? 0) : state.rules.activeCount} 条`),
          h('span', null, `注入占用 ${(((isProject ? (project?.injectBytes ?? 0) : state.rules.injectBytes) || 0) / 1024).toFixed(1)} KB`),
        ),
        h(
          'div',
          { className: 'dcc-switchrow' },
          h(
            'div',
            { className: 'dcc-col' },
            h(Field, { label: 'AI 改规则时的审批', hint: RULE_APPROVAL_HINTS[approval] },
              h(
                'select',
                { value: approval, disabled: busy === true, onChange: (event) => setApproval(event.target.value) },
                ...RULE_APPROVAL_CHOICES.map(([id, label]) => h('option', { key: id, value: id }, label)),
              )),
          ),
        ),
        exempt.length === 0
          ? null
          : h(
              'div',
              { className: 'dcc-switchrow' },
              h(
                'div',
                { className: 'dcc-col' },
                h('span', { className: 'dcc-name' }, '已豁免的工作区'),
                h('span', { className: 'dcc-hint' }, `${exempt.join('、')} —— 这些工作区里 AI 改规则不再问你。`),
              ),
              h(Button, { variant: 'outline', disabled: busy === true, onClick: clearExempt }, '清除'),
            ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0
            ? h(Empty, { text: isProject && workspace === '' ? '这个会话还没有工作区。' : query.trim() === '' ? '还没有规则。点「新建规则」开始。' : '没有匹配的规则。' })
            : null,
          ...items.map((rule) =>
            h(Card, {
              key: rule.file,
              off: rule.enabled !== true,
              title: rule.name,
              badges: [
                h(Badge, { key: 'mode', tone: rule.mode === 'always' ? 'always' : 'plain' }, modeLabel(rule.mode)),
                rule.enabled !== true ? h(Badge, { key: 'off', tone: 'warn' }, '已停用') : null,
                rule.error !== undefined ? h(Badge, { key: 'bad', tone: 'danger' }, '文件损坏') : null,
              ],
              desc: rule.description,
              meta: `${rule.file} · ${(rule.bytes / 1024).toFixed(1)} KB`,
              error: rule.error,
              actions: h(RowActions, {
                id: rule.file,
                confirming,
                setConfirming,
                busy,
                toggle: h(Toggle, {
                  checked: rule.enabled === true,
                  onChange: (value) => act.run(scoped({ section: 'rule', op: 'toggle', file: rule.file, enabled: value })),
                  label: '',
                }),
                onEdit: () => openEdit(rule),
                onDelete: () => act.run(scoped({ section: 'rule', op: 'delete', file: rule.file })),
              }),
            }),
          ),
        ),
        editor === null
          ? null
          : h(RuleEditor, {
              draft: editor,
              busy,
              scopeLabel: isProject ? '项目' : undefined,
              onClose: () => setEditor(null),
              onSubmit: async (form) => {
                const { ok } = await act.run(scoped({ section: 'rule', op: 'save', rule: form }))
                if (ok) setEditor(null)
              },
            }),
      )
    }

    /* ───────────────────────────── MCP 标签页 ───────────────────────────── */

    /** `KEY=VALUE` 多行文本 ↔ 对象。 */
    function parsePairs(text) {
      const out = {}
      for (const line of String(text).split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('#')) continue
        const index = trimmed.indexOf('=')
        if (index <= 0) continue
        out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
      }
      return out
    }

    function formatPairs(record) {
      return Object.entries(record ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')
    }

    const STATUS_TEXT = { mounted: '已挂载', disabled: '已停用', error: '挂载失败', pending: '等待挂载' }

    function McpEditor({ draft, onClose, onSubmit, busy }) {
      const [form, setForm] = useState({
        ...draft,
        argsText: (draft.args ?? []).join('\n'),
        envText: formatPairs(draft.env),
        headersText: formatPairs(draft.headers),
        timeoutText: draft.toolCallTimeoutMs === undefined ? '' : String(draft.toolCallTimeoutMs),
      })
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isStdio = form.transport !== 'streamable-http'
      return h(
        FormModal,
        {
          title: draft.name === '' || draft.name === undefined ? '添加 MCP 服务器' : `编辑 MCP 服务器 · ${draft.name}`,
          onClose,
          busy,
          submitLabel: '保存并立即生效',
          onSubmit: () =>
            onSubmit({
              name: form.name,
              enabled: form.enabled !== false,
              transport: form.transport,
              command: form.command,
              args: form.argsText.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
              env: parsePairs(form.envText),
              cwd: form.cwd,
              url: form.url,
              headers: parsePairs(form.headersText),
              toolCallTimeoutMs: form.timeoutText.trim() === '' ? undefined : Number(form.timeoutText),
              failOnStartupError: form.failOnStartupError === true,
            }),
        },
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '服务器名', hint: '字母/数字/下划线/连字符，1–32 位' },
            h('input', { value: form.name, onChange: (e) => patch({ name: e.target.value }), placeholder: '例如：playwright' })),
          h(Field, { label: '传输方式' },
            h(
              'select',
              { value: form.transport, onChange: (e) => patch({ transport: e.target.value }) },
              h('option', { value: 'stdio' }, 'stdio'),
              h('option', { value: 'streamable-http' }, 'streamable-http'),
            )),
        ),
        isStdio
          ? h(
              react.Fragment,
              null,
              h(Field, { label: '启动命令' },
                h('input', { value: form.command ?? '', onChange: (e) => patch({ command: e.target.value }), placeholder: '例如：npx 或 C:\\Tools\\my-mcp\\server.exe' })),
              h(Field, { label: '参数' },
                h('textarea', { rows: 3, value: form.argsText, onChange: (e) => patch({ argsText: e.target.value }), placeholder: '-y\n@playwright/mcp@latest' })),
              h(
                'div',
                { className: 'dcc-row2' },
                h(Field, { label: '环境变量', hint: '一行一个 KEY=VALUE' },
                  h('textarea', { rows: 3, value: form.envText, onChange: (e) => patch({ envText: e.target.value }), placeholder: 'GITHUB_TOKEN=xxx' })),
                h(Field, { label: '工作目录' },
                  h('input', { value: form.cwd ?? '', onChange: (e) => patch({ cwd: e.target.value }), placeholder: '留空则用会话工作目录' })),
              ),
            )
          : h(
              react.Fragment,
              null,
              h(Field, { label: '服务地址' },
                h('input', { value: form.url ?? '', onChange: (e) => patch({ url: e.target.value }), placeholder: 'http://localhost:3000/mcp' })),
              h(Field, { label: '请求头', hint: '一行一个 KEY=VALUE' },
                h('textarea', { rows: 3, value: form.headersText, onChange: (e) => patch({ headersText: e.target.value }), placeholder: 'Authorization=Bearer xxx' })),
            ),
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '单次调用超时' },
            h('input', { value: form.timeoutText, onChange: (e) => patch({ timeoutText: e.target.value }), placeholder: '60000' })),
          h(Field, { label: '选项' },
            h(Toggle, { checked: form.enabled !== false, onChange: (value) => patch({ enabled: value }), label: '对 Agent 启用' }),
            h(Toggle, { checked: form.failOnStartupError === true, onChange: (value) => patch({ failOnStartupError: value }), label: '启动失败时拒绝激活' })),
        ),
      )
    }

    function McpTab({ state, act, busy, error }) {
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const items = state.mcp.items
      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconPlusOutline16, { size: 14 }), onClick: () => setEditor({ name: '', transport: 'stdio', args: [], env: {}, enabled: true }) }, '添加服务器'),
          h('span', { className: 'dcc-grow' }),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.run({ section: 'mcp', op: 'sync' }) }, '重新加载'),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ file: state.paths.mcp }, act) }, '打开配置'),
        ),
        h(ErrorLine, { text: error }),
        h(ErrorLine, { text: state.mcp.fileError }),
        h(ErrorLine, { text: state.mcp.syncError }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0 ? h(Empty, { text: '还没有 MCP 服务器。' }) : null,
          ...items.map((server) => {
            const status = server.status ?? { state: 'pending' }
            return h(Card, {
              key: server.name,
              off: server.enabled === false,
              title: server.name,
              badges: [
                h(StateDot, {
                  key: 'dot',
                  state: status.state === 'mounted' ? 'done' : status.state === 'error' ? 'error' : status.state === 'disabled' ? 'warning' : 'ongoing',
                  size: 9,
                }),
                h(Badge, { key: 't', tone: status.state === 'mounted' ? 'ok' : status.state === 'error' ? 'danger' : 'plain' }, STATUS_TEXT[status.state] ?? status.state),
                h(Badge, { key: 'tr' }, server.transport),
                server.enabled === false ? h(Badge, { key: 'off', tone: 'warn' }, '不对 Agent 启用') : null,
              ],
              desc: server.transport === 'stdio' ? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim() : server.url,
              meta: server.transport === 'stdio' && server.cwd !== undefined ? `cwd: ${server.cwd}` : '',
              error: status.error,
              actions: h(RowActions, {
                id: server.name,
                confirming,
                setConfirming,
                busy,
                toggle: h(Toggle, { checked: server.enabled !== false, onChange: (value) => act.run({ section: 'mcp', op: 'toggle', name: server.name, enabled: value }), label: '' }),
                onEdit: () => setEditor(server),
                onDelete: () => act.run({ section: 'mcp', op: 'delete', name: server.name }),
              }),
            })
          }),
        ),
        editor === null
          ? null
          : h(McpEditor, {
              draft: editor,
              busy,
              onClose: () => setEditor(null),
              onSubmit: async (server) => {
                const { ok } = await act.run({ section: 'mcp', op: 'save', server })
                if (ok) setEditor(null)
              },
            }),
      )
    }

    /* ──────────────────────────── 技能标签页 ──────────────────────────── */

    function SkillEditor({ draft, onClose, onSubmit, busy }) {
      const [form, setForm] = useState(draft)
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isNew = draft.existing !== true
      return h(
        FormModal,
        {
          title: isNew ? '新建技能' : `编辑技能 · ${draft.id}`,
          onClose,
          busy,
          onSubmit: () => onSubmit(form),
        },
        h(Field, {
          label: '技能名',
          hint: isNew ? 'kebab-case；保存后不可改名。' : '技能名不可修改。',
        }, h('input', { value: form.id, disabled: !isNew, onChange: (e) => patch({ id: e.target.value }), placeholder: '例如：my-helper' })),
        h(Field, { label: '描述' },
          h('input', { value: form.description, onChange: (e) => patch({ description: e.target.value }), placeholder: '一句话说明这个技能解决什么问题、什么时候该用' })),
        h(Field, { label: 'whenToUse' },
          h('input', { value: form.whenToUse ?? '', onChange: (e) => patch({ whenToUse: e.target.value }) })),
        h(Field, { label: '正文' },
          h('textarea', { rows: 7, value: form.body, onChange: (e) => patch({ body: e.target.value }), placeholder: '技能正文…' })),
        h(
          'div',
          { className: 'dcc-row2' },
          h(Toggle, { checked: form.userInvocable !== false, onChange: (value) => patch({ userInvocable: value }), label: '允许手动调用' }),
        ),
      )
    }

    function SkillsTab({ state, act, busy, error }) {
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const [query, setQuery] = useState('')
      const items = state.skills.items.filter((skill) => {
        if (query.trim() === '') return true
        const needle = query.trim().toLowerCase()
        return `${skill.id} ${skill.description} ${skill.whenToUse}`.toLowerCase().includes(needle)
      })
      const openEdit = async (skill) => {
        try {
          const body = await fetchBody('skill', skill.id)
          setEditor({ ...skill, body, existing: true })
        } catch (failure) {
          act.report(failure)
        }
      }
      const offCount = state.skills.items.filter((skill) => skill.enabled === false).length
      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', icon: h(IconPlusOutline16, { size: 14 }), onClick: () => setEditor({ id: '', description: '', whenToUse: '', body: '', enabled: true, modelInvocable: true, userInvocable: true }) }, '新建技能'),
          h('span', { className: 'dcc-grow' }, h(Input, { icon: h(IconSearchOutline16, { size: 14 }), placeholder: '搜索技能…', value: query, onChange: (e) => setQuery(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.refresh() }, '刷新'),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: state.paths.skills }, act) }, '打开目录'),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, `对 Agent 启用 ${state.skills.items.length - offCount} 条`),
          offCount === 0 ? null : h('span', null, `已关闭 ${offCount} 条`),
        ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0 ? h(Empty, { text: query.trim() === '' ? '还没有技能。' : '没有匹配的技能。' }) : null,
          ...items.map((skill) =>
            h(Card, {
              key: skill.id,
              off: skill.enabled === false,
              title: skill.id,
              badges: [
                h(Badge, { key: 'kind' }, skill.kind === 'bundle' ? '目录 bundle' : '平铺文件'),
                skill.enabled === false ? h(Badge, { key: 'off', tone: 'warn' }, '不对 Agent 启用') : null,
                skill.modelInvocable === false ? h(Badge, { key: 'm', tone: 'warn' }, '模型不可自动加载') : null,
                skill.userInvocable === false ? h(Badge, { key: 'u', tone: 'warn' }, '不可手动调用') : null,
                skill.warning !== undefined ? h(Badge, { key: 'w', tone: 'warn' }, '名称不一致') : null,
                skill.error !== undefined ? h(Badge, { key: 'err', tone: 'danger' }, '文件损坏') : null,
              ],
              desc: skill.description === '' ? '缺少描述' : skill.description,
              meta: skill.whenToUse === '' ? `${skill.path} · ${(skill.bytes / 1024).toFixed(1)} KB` : `${skill.whenToUse} · ${(skill.bytes / 1024).toFixed(1)} KB`,
              warning: skill.warning,
              error: skill.error,
              actions: h(RowActions, {
                id: skill.id,
                confirming,
                setConfirming,
                busy,
                toggle: h(Toggle, {
                  checked: skill.enabled !== false,
                  onChange: (value) => act.run({ section: 'skill', op: 'toggle', id: skill.id, enabled: value }),
                  label: '',
                }),
                onEdit: () => openEdit(skill),
                onDelete: () => act.run({ section: 'skill', op: 'delete', id: skill.id }),
              }),
            }),
          ),
        ),
        editor === null
          ? null
          : h(SkillEditor, {
              draft: editor,
              busy,
              onClose: () => setEditor(null),
              onSubmit: async (form) => {
                const { ok } = await act.run({ section: 'skill', op: 'save', skill: form })
                if (ok) setEditor(null)
              },
            }),
      )
    }

    /* ──────────────────────────── 记忆标签页 ──────────────────────────── */

    function MemoryEditor({ draft, onClose, onSubmit, busy }) {
      const [form, setForm] = useState({
        ...draft,
        tagsText: (draft.tags ?? []).join(', '),
      })
      const patch = (values) => setForm((previous) => ({ ...previous, ...values }))
      const isNew = draft.file === undefined
      return h(
        FormModal,
        {
          title: isNew ? '新建记忆' : '编辑记忆',
          onClose,
          busy,
          wide: true,
          onSubmit: () =>
            onSubmit({
              ...form,
              tags: form.tagsText.split(/[,，、]/).map((tag) => tag.trim()).filter((tag) => tag !== ''),
              workspace: form.scope === 'workspace' ? form.workspace : '',
            }),
        },
        h(
          'div',
          { className: 'dcc-row2' },
          h(Field, { label: '标题' },
            h('input', { value: form.name, onChange: (e) => patch({ name: e.target.value }), placeholder: '例如：回答一律用中文' })),
          h(Field, { label: '标签' },
            h('input', { value: form.tagsText, onChange: (e) => patch({ tagsText: e.target.value }), placeholder: '偏好, 语言' })),
        ),
        h(Field, { label: '描述' },
          h('input', { value: form.description, onChange: (e) => patch({ description: e.target.value }), placeholder: '例如：用户要求所有回答与代码注释都用中文' })),
        h(
          Field,
          { label: '作用域' },
          h(
            'div',
            { className: 'dcc-modes' },
            ...[['global', '全局'], ['workspace', '项目']].map(([scope, title]) =>
              h(
                'div',
                { key: scope, className: 'dcc-mode', 'data-on': form.scope === scope, onClick: () => patch({ scope }) },
                h('span', { className: 'dcc-dot' }),
                title,
              ),
            ),
          ),
        ),
        form.scope === 'workspace'
          ? h(Field, { label: '项目目录' },
              h('input', { value: form.workspace ?? '', onChange: (e) => patch({ workspace: e.target.value }), placeholder: 'D:\\Code\\MyProject' }))
          : null,
        h(Field, { label: '内容' },
          h('textarea', { rows: 10, value: form.body, onChange: (e) => patch({ body: e.target.value }), placeholder: '例如：本机 Python 一律用 uv 管理依赖，不要用 pip 直接装。' })),
        h(
          'div',
          { className: 'dcc-row2' },
          h(Toggle, { checked: form.pinned === true, onChange: (value) => patch({ pinned: value }), label: '置顶' }),
          h(Toggle, { checked: form.enabled !== false, onChange: (value) => patch({ enabled: value }), label: '启用' }),
        ),
      )
    }

    function MemoryTab({ state, act, busy, error }) {
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [confirming, setConfirming] = useState(null)
      const memory = state.memory
      const items = memory.items.filter((item) => {
        if (query.trim() === '') return true
        const needle = query.trim().toLowerCase()
        return `${item.name} ${item.description} ${item.tags.join(' ')} ${item.workspace}`.toLowerCase().includes(needle)
      })
      const openEdit = async (item) => {
        try {
          const body = await fetchBody('memory', item.file)
          setEditor({ ...item, body })
        } catch (failure) {
          act.report(failure)
        }
      }
      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, {
            variant: 'primary',
            icon: h(IconPlusOutline16, { size: 14 }),
            onClick: () => setEditor({ name: '', description: '', scope: 'global', workspace: '', tags: [], tagsText: '', body: '', pinned: false, enabled: true }),
          }, '新建记忆'),
          h('span', { className: 'dcc-grow' }, h(Input, { icon: h(IconSearchOutline16, { size: 14 }), placeholder: '搜索记忆…', value: query, onChange: (e) => setQuery(e.target.value) })),
          h(Button, { variant: 'outline', icon: h(IconRefreshOutline16, { size: 14 }), onClick: () => act.refresh() }, '刷新'),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: state.paths.memory }, act) }, '打开目录'),
        ),
        h(
          'div',
          { className: 'dcc-stat' },
          h('span', null, memory.injectEnabled ? '已开启注入' : '注入已关闭'),
          h('span', null, `启用 ${memory.enabledCount} 条 · 全局 ${memory.globalCount} · 项目 ${memory.workspaceCount}`),
          h('span', null, `占用 ${(memory.injectBytes / 1024).toFixed(1)} KB`),
        ),
        h(ErrorLine, { text: error }),
        h(
          'div',
          { className: 'dcc-list' },
          items.length === 0 ? h(Empty, { text: query.trim() === '' ? '还没有记忆。' : '没有匹配的记忆。' }) : null,
          ...items.map((item) =>
            h(Card, {
              key: item.file,
              off: item.enabled !== true,
              title: item.name,
              badges: [
                item.pinned === true ? h(Badge, { key: 'p', tone: 'always' }, '置顶') : null,
                h(Badge, { key: 's', tone: item.scope === 'workspace' ? 'always' : 'plain' }, item.scope === 'workspace' ? '项目' : '全局'),
                item.source === 'auto' ? h(Badge, { key: 'a' }, 'AI 提炼') : null,
                item.enabled !== true ? h(Badge, { key: 'o', tone: 'warn' }, '已停用') : null,
                item.error !== undefined ? h(Badge, { key: 'e', tone: 'danger' }, '文件损坏') : null,
              ],
              desc: item.description === '' ? '未填描述' : item.description,
              meta: `${item.scope === 'workspace' ? `${item.workspace} · ` : ''}${item.file} · ${formatBytes(item.bytes)} · 更新于 ${formatTime(item.updatedAt)}`,
              error: item.error,
              actions: h(RowActions, {
                id: item.file,
                confirming,
                setConfirming,
                busy,
                extras: [
                  h(Button, {
                    key: 'pin',
                    variant: 'ghost',
                    size: 'sm',
                    onClick: () => act.run({ section: 'memory', op: 'pin', file: item.file, pinned: item.pinned !== true }),
                  }, item.pinned === true ? '取消置顶' : '置顶'),
                ],
                toggle: h(Toggle, {
                  checked: item.enabled === true,
                  onChange: (value) => act.run({ section: 'memory', op: 'toggle', file: item.file, enabled: value }),
                  label: '',
                }),
                onEdit: () => openEdit(item),
                onDelete: () => act.run({ section: 'memory', op: 'delete', file: item.file }),
              }),
            }),
          ),
        ),
        editor === null
          ? null
          : h(MemoryEditor, {
              draft: editor,
              busy,
              onClose: () => setEditor(null),
              onSubmit: async (form) => {
                const { ok } = await act.run({ section: 'memory', op: 'save', memory: form })
                if (ok) setEditor(null)
              },
            }),
      )
    }

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

    /* ──────────────────────────── 设置标签页 ──────────────────────────── */

    function SettingsTab({ state, act, busy, error }) {
      const [form, setForm] = useState(() => JSON.parse(JSON.stringify(state.settings)))
      const [routes, setRoutes] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [advancedOpen, setAdvancedOpen] = useState(false)
      const [custom, setCustom] = useState({ id: '', label: '', kind: 'json', path: '', mcpKey: '', section: '' })

      useEffect(() => {
        let alive = true
        getJson('/routes')
          .then((payload) => {
            if (!alive) return
            setRoutes(payload.routes)
          })
          .catch(() => {
            if (alive) setRoutes([])
          })
        return () => {
          alive = false
        }
      }, [])

      const patch = (group, values) => {
        setForm((previous) => ({ ...previous, [group]: { ...previous[group], ...values } }))
        setDirty(true)
      }

      const save = async () => {
        const { ok } = await act.run({ section: 'settings', op: 'save', settings: form })
        if (ok) {
          setDirty(false)
          // 输入框上的优化按钮读的是 /flags 缓存：保存后强制刷新，按钮立刻跟着开关变。
          loadFlags(true)
          act.flash({ tone: 'ok', text: '设置已保存。' })
        }
      }

      const reset = () => {
        setForm(JSON.parse(JSON.stringify(state.settings)))
        setDirty(false)
      }

      const providerOptions = routes === null ? [] : [...new Set(routes.map((route) => route.provider))]
      const modelOptions = routes === null ? [] : routes.filter((route) => route.provider === form.optimize.provider)

      const toggleSource = (id) =>
        patch('scan', {
          disabled: form.scan.disabled.includes(id) ? form.scan.disabled.filter((item) => item !== id) : [...form.scan.disabled, id],
        })

      const addCustom = () => {
        if (custom.id.trim() === '' || custom.path.trim() === '') {
          act.report(new Error('自定义源至少要填 id 与路径'))
          return
        }
        patch('scan', {
          custom: [
            ...form.scan.custom,
            {
              id: custom.id.trim(),
              label: custom.label.trim(),
              kind: custom.kind,
              path: custom.path.trim(),
              ...(custom.mcpKey.trim() === '' ? {} : { mcpKey: custom.mcpKey.trim() }),
              ...(custom.section.trim() === '' ? {} : { section: custom.section.trim() }),
            },
          ],
        })
        setCustom({ id: '', label: '', kind: 'json', path: '', mcpKey: '', section: '' })
      }

      return h(
        'div',
        { className: 'dcc-layout' },
        h(
          'div',
          { className: 'dcc-bar' },
          h(Button, { variant: 'primary', disabled: busy || !dirty, onClick: save }, dirty ? '保存设置' : '已保存'),
          h(Button, { variant: 'outline', disabled: !dirty, onClick: reset }, '放弃改动'),
          h('span', { className: 'dcc-grow' }),
          h(Button, { variant: 'outline', icon: h(IconFolderOpenOutline16, { size: 14 }), onClick: () => reveal({ path: state.paths.config }, act) }, '打开配置目录'),
        ),
        h(ErrorLine, { text: error }),

        h(
          'div',
          { className: 'dcc-list' },
          /* ── 提示词优化 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconSparkle16, { size: 14 }), '输入框上的 AI 提示词优化'),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '启用优化按钮'),
                  state.optimize.available ? null : h('div', { className: 'dcc-hint' }, 'LLM 服务未就绪，按钮当前不可用。')),
                h(Toggle, { checked: form.optimize.enabled, onChange: (value) => patch('optimize', { enabled: value }), label: '' }),
              ),
              h(
                'div',
                { className: 'dcc-row2', style: { marginTop: '8px' } },
                h(Field, { label: 'provider' },
                  h(
                    'select',
                    { value: form.optimize.provider, onChange: (e) => patch('optimize', { provider: e.target.value, model: '' }) },
                    h('option', { value: '' }, '跟随默认模型'),
                    ...providerOptions.map((id) => h('option', { key: id, value: id }, id)),
                  )),
                h(Field, { label: 'model' },
                  h(
                    'select',
                    { value: form.optimize.model, onChange: (e) => patch('optimize', { model: e.target.value }) },
                    h('option', { value: '' }, '跟随默认模型'),
                    ...modelOptions.map((route) => h('option', { key: route.model, value: route.model }, route.modelName ?? route.model)),
                  )),
              ),
              h(Toggle, {
                checked: advancedOpen,
                onChange: setAdvancedOpen,
                label: '高级选项',
              }),
              advancedOpen
                ? h(
                    'div',
                    { className: 'dcc-row2', style: { marginTop: '6px' } },
                    h(Field, { label: '思考强度' },
                      h('input', { value: form.optimize.reasoningEffort, onChange: (e) => patch('optimize', { reasoningEffort: e.target.value }), placeholder: '留空 = 关闭思考' })),
                    h(Field, { label: '自定义提示词' },
                      h('input', { value: form.optimize.prompt, onChange: (e) => patch('optimize', { prompt: e.target.value }), placeholder: '留空 = 内置提示词' })),
                  )
                : null,
            ),
          ),

          /* ── 记忆 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconPersonalizationOutline16, { size: 14 }), '长期记忆'),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '启用记忆功能'),
                  form.memory.enabled ? null : h('div', { className: 'dcc-hint' }, '「记忆」标签页只做展示，新记忆不再写入。')),
                h(Toggle, { checked: form.memory.enabled, onChange: (value) => patch('memory', { enabled: value }), label: '' }),
              ),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '把记忆注入每个会话'),
                  h('div', { className: 'dcc-hint' }, `预算 ${(state.budget.memory / 1024).toFixed(1)} KB`)),
                h(Toggle, { checked: form.memory.inject, onChange: (value) => patch('memory', { inject: value }), label: '' }),
              ),
            ),
          ),

          /* ── 备份 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconArchiveOutline20, { size: 15 }), '备份'),
              h(
                'div',
                { className: 'dcc-row2', style: { marginTop: '6px' } },
                h(Field, { label: '备份目录保留份数', hint: '填 0 表示不自动清理' },
                  h('input', {
                    type: 'number',
                    min: 0,
                    value: String(form.backup.retention),
                    onChange: (e) => patch('backup', { retention: Number(e.target.value) }),
                  })),
                h(Field, { label: '恢复前自动快照' },
                  h(Toggle, { checked: form.backup.snapshotBeforeImport, onChange: (value) => patch('backup', { snapshotBeforeImport: value }), label: '导入备份前先另存一份当前配置' })),
              ),
            ),
          ),

          /* ── 扫描源 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconDownloadOutline16, { size: 14 }), '扫描别的客户端'),
              h(
                'div',
                { className: 'dcc-grid', style: { marginTop: '6px' } },
                ...state.scan.sources.map((source) =>
                  h(
                    PickCard,
                    {
                      key: source.id,
                      on: !form.scan.disabled.includes(source.id),
                      onToggle: () => toggleSource(source.id),
                    },
                    h('div', { className: 'dcc-name' }, source.label, h(Badge, { key: 'i' }, source.id)),
                  ),
                ),
              ),
              h('div', { className: 'dcc-name', style: { marginTop: '10px' } }, '自定义扫描源', h(Badge, { key: 'n' }, `${form.scan.custom.length} 个`)),
              form.scan.custom.length === 0
                ? h('div', { className: 'dcc-hint' }, '没有自定义源。')
                : h(
                    'div',
                    { className: 'dcc-grid' },
                    ...form.scan.custom.map((source, index) =>
                      h(
                        'div',
                        { key: `${source.id}-${index}`, className: 'dcc-pick dcc-pick-static', 'data-on': true },
                        h(
                          'div',
                          { className: 'dcc-narrow' },
                          h('div', { className: 'dcc-name' }, source.label === '' ? source.id : source.label, h(Badge, { key: 'k' }, source.kind)),
                          h('div', { className: 'dcc-meta' }, source.path),
                        ),
                        h(Button, {
                          variant: 'ghost',
                          size: 'sm',
                          icon: h(IconTrashOutline16, { size: 13 }),
                          onClick: () => patch('scan', { custom: form.scan.custom.filter((_, position) => position !== index) }),
                        }, ''),
                      ),
                    ),
                  ),
              h(
                'div',
                { className: 'dcc-row3', style: { marginTop: '8px' } },
                h(Field, { label: 'id' }, h('input', { value: custom.id, onChange: (e) => setCustom({ ...custom, id: e.target.value }), placeholder: 'my-agent' })),
                h(Field, { label: '显示名' }, h('input', { value: custom.label, onChange: (e) => setCustom({ ...custom, label: e.target.value }), placeholder: '我的另一个客户端' })),
                h(Field, { label: '类型' },
                  h(
                    'select',
                    { value: custom.kind, onChange: (e) => setCustom({ ...custom, kind: e.target.value }) },
                    h('option', { value: 'json' }, 'JSON · mcpServers'),
                    h('option', { value: 'toml' }, 'TOML · mcp_servers'),
                    h('option', { value: 'dir' }, '技能目录'),
                  )),
              ),
              h(
                'div',
                { className: 'dcc-row2' },
                h(Field, { label: '路径' }, h('input', { value: custom.path, onChange: (e) => setCustom({ ...custom, path: e.target.value }), placeholder: 'C:\\Users\\me\\.myagent\\config.json' })),
                custom.kind === 'json'
                  ? h(Field, { label: '键名' }, h('input', { value: custom.mcpKey, onChange: (e) => setCustom({ ...custom, mcpKey: e.target.value }), placeholder: 'mcpServers' }))
                  : custom.kind === 'toml'
                    ? h(Field, { label: '段名' }, h('input', { value: custom.section, onChange: (e) => setCustom({ ...custom, section: e.target.value }), placeholder: 'mcp_servers' }))
                    : h('span', null),
              ),
              h('div', { className: 'dcc-bar', style: { marginBottom: 0 } },
                h(Button, { variant: 'outline', icon: h(IconPlusOutline16, { size: 14 }), onClick: addCustom }, '添加自定义源')),
            ),
          ),

          /* ── 界面 ── */
          h(
            'div',
            { className: 'dcc-card' },
            h(
              'div',
              { className: 'dcc-col' },
              h('div', { className: 'dcc-name' }, h(IconSettingsOutline16, { size: 14 }), '界面与关于'),
              h(Field, { label: '打开控制中心时默认停留的页面' },
                h(
                  'select',
                  { value: form.ui.defaultTab, onChange: (e) => patch('ui', { defaultTab: e.target.value }) },
                  ...[['rule', '规则'], ['mcp', 'MCP 服务器'], ['skill', '技能'], ['memory', '记忆'], ['scan', '导入'], ['backup', '备份'], ['settings', '设置']].map(([id, label]) =>
                    h('option', { key: id, value: id }, label),
                  ),
                )),
              h('div', { className: 'dcc-hint' }, `规则注入预算 ${(state.budget.rules / 1024).toFixed(1)} KB · 记忆注入预算 ${(state.budget.memory / 1024).toFixed(1)} KB`),
            ),
          ),
        ),
      )
    }

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

    /**
     * 「撤销」还能不能点——它撤的是**刚写回输入框的那份优化结果**。
     *
     * 输入框空了就没有可撤的对象：宿主在一次成功发送里会把编辑器整篇清掉
     * （`send-committed` → 效果 `commit-draft`），而优化状态是按会话存在 store 里的，
     * 不清它的话按钮会**挂到下一段输入上**，看着像它还管着新写的内容。
     * 所以按钮的寿命挂在草稿上：草稿没了，按钮当帧就消失。
     */
    function canUndoOptimize(state, draft) {
      return state.kind === 'done' && typeof draft === 'string' && draft.trim() !== ''
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
       * 发出去之后，把「撤销」的余地一起收掉。
       *
       * 宿主不给插件发「已发送」事件，能看到的信号就是**草稿变空**（成功发送会清空编辑器）。
       * 但不能只看草稿为空：写回草稿与状态落库不是同一帧，刚优化完那一帧草稿可能还是空的，
       * 照那样清会把按钮当场自己撤掉。所以先记住「见过非空草稿」，等它再变空才是真的发出去了。
       * 清 store 是必须的——否则下一次输入时，按会话存着的 `done` 会把按钮重新挂回来。
       */
      const armed = useRef(false)
      useEffect(() => {
        if (state.kind !== 'done') {
          armed.current = false
          return undefined
        }
        if (draft.trim() === '') {
          if (armed.current) {
            armed.current = false
            optimizeStore.set(sessionId, IDLE)
          }
          return undefined
        }
        armed.current = true
        return undefined
      }, [state.kind, draft, sessionId])

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
        canUndoOptimize(state, draft)
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

    /* ──────────────── 控制中心整页 + 侧边栏入口 + 会话「规则」视图 ──────────────── */

    const TABS = [
      { id: 'rule', label: '规则', icon: IconContextInjectionOutline16 },
      { id: 'mcp', label: 'MCP 服务器', icon: IconCordisPluginOutline14 },
      { id: 'skill', label: '技能', icon: IconSkillOutline16 },
      { id: 'memory', label: '记忆', icon: IconPersonalizationOutline16 },
      { id: 'scan', label: '导入', icon: IconDownloadOutline16 },
      { id: 'backup', label: '备份', icon: IconArchiveOutline20 },
      { id: 'settings', label: '设置', icon: IconSettingsOutline16 },
    ]

    /**
     * 侧边栏底部入口（`sidebar.footer.action`，正好在「设置」上方）。
     *
     * 这一格是 list 型插槽，「设置」自己是 single 型（已被平台占用），
     * 所以「放在设置旁边」的官方接缝就是它。
     */
    function ControlCenterEntry({ wide }) {
      const panel = usePanelState()
      return h(
        'button',
        {
          type: 'button',
          className: 'dcc-sideentry',
          'data-active': panel.open,
          'data-rail': wide ? undefined : 'true',
          title: '控制中心',
          onClick: () => (panel.open ? panelStore.close() : panelStore.open()),
        },
        h(IconSettingsOutline16, { size: wide ? 16 : 18 }),
        wide ? h('span', null, '控制中心') : null,
      )
    }

    /** 每个标签页右上角的条目数（没有可数的就不显示）。 */
    function tabCount(state, id) {
      if (state === null) return null
      if (id === 'rule') return state.rules.items.length
      if (id === 'mcp') return state.mcp.items.length
      if (id === 'skill') return state.skills.items.length
      if (id === 'memory') return state.memory.items.length
      if (id === 'backup') return state.backup.items.length
      return null
    }

    /**
     * 控制中心整页。
     *
     * 挂在 `shell.overlay`（list 型、root 作用域）上，覆盖整个窗口——所以它是一个**网页**，
     * 而不是设置里的一个弹窗分区，横向空间也宽得多。
     *
     * 顶部留白由 `useTitleBarGuard` 量出来：只在面板顶边真的压到 Windows 窗口按钮那一条时
     * 才补 padding，因此既不会挡住最小化/最大化/关闭，也不会白占一条空白。
     *
     * **这里只管全局规则**：项目规则由会话里的「规则」视图负责（那里的工作区来自会话本身）。
     */
    function ControlCenterPanel() {
      const panel = usePanelState()
      const rootRef = useRef(null)
      const guard = useTitleBarGuard(rootRef)
      const [tab, setTab] = useState('rule')
      const ctl = useController({})
      const { state, error, busy, flash, setFlash, act } = ctl

      // 外部（侧边栏入口）把面板叫起来时，切到它要求的那一页。
      useEffect(() => {
        if (!panel.open) return
        if (panel.tab !== null && panel.tab !== undefined) setTab(panel.tab)
      }, [panel.open, panel.tab])

      // Esc 关闭整页。
      useEffect(() => {
        if (!panel.open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') panelStore.close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [panel.open])

      if (!panel.open) return null

      return h(
        'div',
        { className: 'dcc dcc-panel', ref: rootRef, style: { paddingTop: `${guard.top}px`, paddingLeft: `${guard.left}px` } },
        h(
          'div',
          { className: 'dcc-panel-head' },
          h('h2', { className: 'dcc-title' }, '控制中心'),
          h('div', { className: 'dcc-sub' }, state === null ? '加载中…' : `数据根目录 ${state.root}`),
          h(Button, { variant: 'outline', icon: h(IconCloseOutline16, { size: 14 }), onClick: () => panelStore.close() }, '关闭'),
        ),
        h(
          'div',
          { className: 'dcc-tabs' },
          ...TABS.map((item) =>
            h(
              'button',
              { key: item.id, type: 'button', className: 'dcc-tab', 'data-active': tab === item.id, onClick: () => setTab(item.id) },
              h(item.icon, { size: 14 }),
              item.label,
              tabCount(state, item.id) === null ? null : h('span', { className: 'dcc-count' }, tabCount(state, item.id)),
            ),
          ),
        ),
        h(Toast, { flash, onClose: () => setFlash(null) }),
        state === null
          ? h(Empty, { text: error === null ? '正在读取…' : `读取失败：${error}` })
          : h(
              'div',
              { className: 'dcc-panel-body' },
              tab === 'rule' ? h(RulesSection, { state, act, busy, error, scope: 'global', workspace: '' }) : null,
              tab === 'mcp' ? h(McpTab, { state, act, busy, error }) : null,
              tab === 'skill' ? h(SkillsTab, { state, act, busy, error }) : null,
              tab === 'memory' ? h(MemoryTab, { state, act, busy, error }) : null,
              tab === 'scan' ? h(ScanTab, { state, act, error }) : null,
              tab === 'backup' ? h(BackupTab, { state, act, error }) : null,
              tab === 'settings' ? h(SettingsTab, { state, act, busy, error }) : null,
            ),
      )
    }

    /**
     * 会话里的「规则」视图（`conversation.view`，与「对话」「轨迹」并排）。
     *
     * 这是**项目规则**的唯一编辑入口。编辑的是当前会话工作区的项目规则：
     * host 用 session id 反查工作目录，浏览器侧因此不需要猜会话快照的形状，
     * 用户也不需要自己去挑文件夹。
     */
    function ProjectRulesView({ sessionId }) {
      const ctl = useController({ session: sessionId })
      // 平台的输入框与左右两条宽度拖动边缘跟规则页无关，本页在位时给 <body> 打标记，
      // 由样式表把它们藏起来。必须写在下面那句提前 return 之前，否则两态 hook 数量不一致。
      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        document.body.setAttribute('data-dcc-rules-view', '')
        return () => document.body.removeAttribute('data-dcc-rules-view')
      }, [])
      const { state, error, busy, act } = ctl
      if (state === null) return h(Empty, { text: error === null ? '正在读取项目规则…' : `读取失败：${error}` })
      const workspace = state.project?.workspace ?? ''
      return h(
        'div',
        { className: 'dcc dcc-view' },
        h(Toast, { flash: ctl.flash, onClose: () => ctl.setFlash(null) }),
        h(RulesSection, { state, act, busy, error, scope: 'project', workspace }),
      )
    }

    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册控制中心整页、侧边栏入口、输入框优化按钮与会话「规则」视图。
     *
     * 各插槽的出现时机由宿主决定，所以统一用 `slots.inject(name, cb)`——
     * 它在目标插槽就绪时才执行 cb，因此这里不关心加载顺序。
     * 输入框与会话视图需要 `conversation` 服务，放在 `ctx.inject(['conversation'])` 里注册：
     * 该服务缺失时（非 web 组合）整页与侧边栏入口照旧可用，只是少了这两处扩展。
     */
    /**
     * 给控制中心自己的审批提问卡打上 `data-dcc-rule-ask`，由样式表把它画成带淡黄警示条的
     * 显眼卡（平台默认那张是无色输入卡，四档选项挤在灰底上很容易点错档位）。
     *
     * 卡片由平台的「提问」通道渲染，本插件拿不到它的组件树，只能用 DOM 观察认领；
     * 判据是卡片开头的文字——插件问的每张卡，header 都以「控制中心」开头。
     */
    function watchRuleAskCards() {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
      if (document.body === null || typeof document.querySelectorAll !== 'function') return
      let pending = false
      const mark = () => {
        pending = false
        document.querySelectorAll('[data-question-key]').forEach((frame) => {
          if (frame.getAttribute('data-dcc-rule-ask') === '1') return
          const head = (frame.textContent ?? '').slice(0, 60)
          if (head.includes('控制中心')) frame.setAttribute('data-dcc-rule-ask', '1')
        })
      }
      const schedule = () => {
        if (pending) return
        pending = true
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(mark)
        else setTimeout(mark, 0)
      }
      mark()
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    }

    function apply(ctx) {
      installStyles()
      watchRuleAskCards()
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ name: 'sidebar.footer.action', id: 'control-center-entry', order: 50 }, ControlCenterEntry),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'control-center-panel', order: 50 }, ControlCenterPanel),
      )
      ctx.inject(['conversation'], (conversationCtx) => {
        conversationCtx.slots.inject('conversation.view', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.view',
              // order 5：夹在「对话」(0) 与「轨迹」(10) 之间。
              id: 'control-center-rules',
              order: 5,
              label: () => '规则',
              inject: (sessionId) => ({ sessionId }),
            },
            ProjectRulesView,
          ),
        )
        conversationCtx.slots.inject('conversation.input.right', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.input.right',
              id: 'control-center-optimize',
              order: 400,
              inject: (sessionId) => ({ sessionId }),
            },
            OptimizeButton,
          ),
        )
        conversationCtx.slots.inject('conversation.input.overlay', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'control-center-optimize-veil',
              order: 10,
              inject: (sessionId) => ({ sessionId }),
            },
            ComposerVeil,
          ),
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    /**
     * 测试接缝：`test/client-bundle.test.js` / `test/client-render-react.test.js` 在 node 侧
     * 把浏览器半侧跑起来时，需要直接拿到各页面组件（渲染器里 effect 不会真的跑，
     * 没法靠点界面走到它们）。仅此导出，不对外使用。
     */
    exports.__internals = {
      withDefaults,
      panelStore,
      // 认领平台「提问」卡片的 DOM 观察器：靠 DOM 认领，只能这样测（SSR 下没有真 DOM）。
      dom: { watchRuleAskCards },
      tabs: { RulesSection, McpTab, SkillsTab, MemoryTab, ScanTab, BackupTab, SettingsTab, ProjectRulesView, ControlCenterPanel, ControlCenterEntry },
      composer: {
        OptimizeButton,
        ComposerVeil,
        // 撤销按钮的显示条件是个纯函数，测试直接断言它（effect 在 SSR 下不跑，见上）。
        canUndoOptimize,
        // 这两个 store 也是给测试的：渲染测试要把「优化失败」这类状态**种进去**才能验它可点、
        // 可读——它们靠 effect 与网络才进得来，SSR 下走不到。
        optimizeStore,
        flagsStore,
      },
    }
    return module.exports
  },
})
