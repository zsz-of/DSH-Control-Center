/**
 * 本文件由 scripts/build-client.mjs 自动生成，请勿直接编辑。
 * 核心组分片（按拼接顺序）：
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
 *   - lib/client/88-sessions.js
 *   - lib/client/90-composer.js
 *   - lib/client/95-panel.js
 *   - lib/client/99-tail.js
 *
 * 任务流组（原 dsh-chat-flow，包进一个 IIFE 插在核心组收尾分片之前）：
 *   - lib/client-flow/00-head.js
 *   - lib/client-flow/05-locale.js
 *   - lib/client-flow/10-classify.js
 *   - lib/client-flow/20-derive.js
 *   - lib/client-flow/30-collapse.js
 *   - lib/client-flow/40-style.js
 *   - lib/client-flow/50-nodes.js
 *   - lib/client-flow/55-native.js
 *   - lib/client-flow/58-subagent.js
 *   - lib/client-flow/60-process.js
 *   - lib/client-flow/70-turn.js
 *   - lib/client-flow/75-rail.js
 *   - lib/client-flow/80-view.js
 *   - lib/client-flow/85-scroll.js
 *   - lib/client-flow/99-tail.js
 *
 * 修改流程：改 lib/client/*.js 或 lib/client-flow/*.js → node scripts/build-client.mjs
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
    /**
     * 拿不到 host 开关时的兜底。
     *
     * `optimize` 给核心组自己用；`ui` 给任务流那半侧用（两个界面开关）——**偏保守**：
     * 拉不到就都当「开」，否则一次网络抖动会让任务视图整片消失（用户在设置里明明开着）。
     */
    const FLAGS_FALLBACK = {
      optimize: { enabled: false, available: false },
      ui: { taskView: true, subagent: true },
    }

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
                  ...[['rule', '规则'], ['session', '会话'], ['mcp', 'MCP 服务器'], ['skill', '技能'], ['memory', '记忆'], ['scan', '导入'], ['backup', '备份'], ['settings', '设置']].map(([id, label]) =>
                    h('option', { key: id, value: id }, label),
                  ),
                )),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '任务页面'),
                  h('div', { className: 'dcc-hint' }, '会话里「任务」视图（对话流）。关掉即注销这个视图，正在看它时会立刻退回「对话」。')),
                h(Toggle, { checked: form.ui.taskView, onChange: (value) => patch('ui', { taskView: value }), label: '' }),
              ),
              h(
                'div',
                { className: 'dcc-switchrow' },
                h('div', { className: 'dcc-col' },
                  h('div', { className: 'dcc-name' }, '子代理显示'),
                  h('div', { className: 'dcc-hint' }, '任务视图里的子代理（子会话）区块；关掉只影响显示，捕获与注入照旧。')),
                h(Toggle, { checked: form.ui.subagent, onChange: (value) => patch('ui', { subagent: value }), label: '' }),
              ),
              h('div', { className: 'dcc-hint' }, `规则注入预算 ${(state.budget.rules / 1024).toFixed(1)} KB · 记忆注入预算 ${(state.budget.memory / 1024).toFixed(1)} KB`),
            ),
          ),
        ),
      )
    }

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

    /**
     * 会话删掉之后，清「对话流」那半侧留在浏览器存储里的会话级数据
     * （折叠表 / 滚动位置 / 已结束标记，见 `lib/client-flow/00-head.js` 的 `purgeSessionData`）。
     */
    let sessionResiduePurger = null

    /** 空快照：服务还没接上（或读失败）时用它，页面照样能画。 */
    const EMPTY_SESSION_SNAPSHOT = { ids: [], byId: {}, phase: 'pending', projectionsBySession: {} }

    /**
     * 接上会话服务（`lib/client/99-tail.js` 调用）。
     *
     * @param services - `{ list, remove, purge }`，缺项按「没有这个能力」处理。
     * @returns 无。
     */
    function connectSessionServices(services) {
      sessionListSource = services?.list ?? null
      sessionRowRemover = typeof services?.remove === 'function' ? services.remove : null
      sessionResiduePurger = typeof services?.purge === 'function' ? services.purge : null
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
     * 「会话」标签页：列出会话，逐条**彻底删除**（文件 + 列表行 + 对话流残留）。
     *
     * 「彻底」分三步，缺一个都会留下用户能看见的残余：
     * 1. host 删磁盘落点（正文目录 / 回滚快照 / 投影缓存 / 溢出目录）并复核，
     *    正在使用的会话直接拒绝（见 `lib/api.js` 的 `session` 分区与 `lib/sessions.js`）；
     * 2. 浏览器侧把行从列表里摘掉（`handleSessionRemoved`）；
     * 3. 清掉本插件给这个会话留下的浏览器存储（折叠表 / 滚动位置 / 已结束标记）。
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
        // host 已经删完文件：现在摘行 + 清本插件残留（顺序无所谓，但摘行要挨个来）。
        for (const id of ids) {
          try {
            sessionRowRemover?.(id)
          } catch {
            /* 摘行失败不影响文件已删的事实 */
          }
          try {
            sessionResiduePurger?.(id)
          } catch {
            /* 清残留失败同理：只是少清几个键 */
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
      { id: 'session', label: '会话删除', icon: IconTrashOutline16 },
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
              // 「会话删除」不读 host state（列表来自 `ctx.sessions`），所以它不需要 `state`。
              tab === 'session' ? h(SessionsTab, { act, busy, error }) : null,
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
    /* ──────────────── 任务流半侧（原 dsh-chat-flow）：独立 IIFE ──────────────── */
    // 两组都有自己的 `h` / `inject` / `NS` / `STYLE_ID` 等顶层声明，同处一个作用域会语法冲突，
    // 所以整组关进 IIFE；下面的 `module`/`exports` 就是它原来的 bundle 收尾所需的那两个变量。
    const chatFlow = (function () {
      var module = { exports: {} }
      var exports = module.exports
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
    /* ──────────────────────────── 文案 ──────────────────────────── */

    /**
     * 中英文字典。
     *
     * 界面文案归 `ctx.locale` 所有（核心的既定分工：primitives 是零 locale 的原子组件，
     * 每段面向用户的文案都由渲染点通过 label prop 提供）。视图组件从插槽 kit 拿到的 `t`
     * 就是绑定到 {@link NS} 的这个字典。
     *
     * 值必须是**字符串模板**：`translate` 用 `/\{(\w+)\}/g` 做插值，函数值不会被调用。
     * 插值参数写成单花括号，缺键时 `t` 回落成键名本身（因此键名也要能看懂）。
     * 中英两份的键集必须完全一致（`client-locale.test.js` 强制）。
     */
    const ZH = {
      'view.flow': '任务',
      'flow.empty': '这个会话还没有可显示的内容。',
      'flow.loadOlder': '加载更早的历史',
      'flow.rail': '回合导航',
      'flow.rail.jump': '跳到第 {turn} 轮',
      'flow.rail.jumpLoad': '加载并跳到第 {turn} 轮',
      'flow.scrollToBottom': '快速回到底部',

      'flow.tasks': '任务列表',
      'flow.tasksSummary': '{total} 项 · {done} 已完成',
      'flow.tasksUpdate': '第 {index} 次更新',

      'flow.status.pending': '未开始',
      'flow.status.in_progress': '进行中',
      'flow.status.completed': '已完成',
      'flow.status.running': '运行中',
      'flow.status.done': '已完成运行',
      'flow.status.failed': '运行失败',
      'flow.status.cancelled': '已取消',
      'flow.status.started': '已派出',
      'flow.status.stopped': '已停止',

      'flow.category.thinking': '思考 {count} 次',
      'flow.category.command': '执行 {count} 条命令',
      'flow.category.read': '读取 {count} 个文件',
      'flow.category.file': '编辑 {count} 个文件',
      'flow.category.mcp': '调用 {count} 个 MCP 工具',
      'flow.category.question': '提问 {count} 次',

      'flow.thinking.live': '思考中',
      'flow.thinking.done': '思考已完成',
      'flow.thinking.cutOff': '思考被打断',
      'flow.loadingLocked': '正在加载更早的内容…（页面已锁定，加载完成后可直接继续）',
      'flow.stage': '任务过程',
      'flow.stage.duration': '任务耗时 {text}',
      'flow.duration.hour': '{count}小时',
      'flow.duration.minute': '{count}分',
      'flow.duration.second': '{count}秒',
      // 「被打断」只给核心给出的中断证据（`assistant-step.data.status === 'interrupted'`
      // 或工具块错误码属于 INTERRUPT_CODES）；任务列表没走完是**另一件事**，用中性文案。
      'flow.status.cutOff': '被打断',
      'flow.status.unfinished': '清单未走完',
      'flow.context.count': '{count} 段注入',
      'flow.noOps': '无操作',
      'flow.ops': '{count} 个操作',
      'flow.tasksDone': '已完成：{text}',
      'flow.pending.steering': '插队待处理',
      'flow.pending.queued': '排队中',
      'flow.steering': '插队',
      'flow.error.title': '任务视图渲染失败',
      'flow.error.hint': '界面其余部分仍然可用：切到「对话」标签可以继续，或刷新页面重试。请把上面这行信息反馈给插件作者。',
      'flow.error.retry': '重试',

      'flow.row.context': '上下文准备',
      'flow.row.command': '斜杠命令',
      'flow.row.compaction': '上下文压缩',
      'flow.row.manualCompaction': '手动压缩',
      'flow.row.modelRetry': '模型重试',
      'flow.row.turnError': '本轮出错',
      'flow.row.maxTokens': '达到 token 上限',
      'flow.row.unknown': '未识别事件',

      'flow.card.input': '输入',
      'flow.card.output': '输出',
      'flow.card.result': '返回值',
      'flow.card.answer': '回答',
      'flow.card.waiting': '等待回答…',
      'flow.card.diffNote': '本次改动',
      'flow.card.subagent': '子 agent',
      'flow.card.awaitReport': '已派出子会话，报告稍后到达',

      'flow.subagent.process': '子代理过程',
      'flow.subagent.loading': '正在打开子会话…',
      'flow.subagent.unavailable': '读不到这个子代理的过程',
      'flow.subagent.empty': '这个子代理还没有可显示的步骤',
      'flow.subagent.steps': '{count} 步',
      'flow.subagent.truncated': '只显示最后 {count} 步',
      'flow.subagent.open': '打开子会话',

      'flow.text.truncated': '正文过长，只显示前 {shown} 个字符（共 {total} 个字符）',

      'flow.agents.title': '子代理',
      'flow.agents.count': '{count} 个',
      'flow.agents.running': '{count} 个进行中',
      'flow.agents.state.running': '工作中',
      'flow.agents.state.done': '完成',
      'flow.agents.state.failed': '失败',
      'flow.agents.state.interrupted': '已中断',
      'flow.agents.state.unknown': '状态未知',
      'flow.agents.mode.oneShot': '一次性',
      'flow.agents.mode.continuable': '可续',

      'flow.copy': '复制',
      'flow.copied': '已复制',
      'flow.footnotes': '脚注',
      'flow.collapse': '收起',
      'flow.expandRest': '展开其余 {count} 行',
      'flow.collapseAria': '收起',
      'flow.expandAria': '展开其余 {count} 行',
      'flow.noOutput': '（无输出）',
      'flow.exitCode': '退出码 {code}',
      'flow.signal': '信号 {signal}',
    }

    const EN = {
      'view.flow': 'Tasks',
      'flow.empty': 'Nothing to show in this session yet.',
      'flow.loadOlder': 'Load earlier history',
      'flow.rail': 'Turn navigation',
      'flow.rail.jump': 'Jump to turn {turn}',
      'flow.rail.jumpLoad': 'Load and jump to turn {turn}',
      'flow.scrollToBottom': 'Scroll to bottom',

      'flow.tasks': 'Tasks',
      'flow.tasksSummary': '{total} tasks · {done} done',
      'flow.tasksUpdate': 'Update {index}',

      'flow.status.pending': 'Not started',
      'flow.status.in_progress': 'In progress',
      'flow.status.completed': 'Done',
      'flow.status.running': 'Running',
      'flow.status.done': 'Finished',
      'flow.status.failed': 'Failed',
      'flow.status.cancelled': 'Cancelled',
      'flow.status.started': 'Dispatched',
      'flow.status.stopped': 'Stopped',

      'flow.category.thinking': 'Thought {count} times',
      'flow.category.command': 'Ran {count} commands',
      'flow.category.read': 'Read {count} files',
      'flow.category.file': 'Edited {count} files',
      'flow.category.mcp': 'Called {count} MCP tools',
      'flow.category.question': 'Asked {count} questions',

      'flow.thinking.live': 'Thinking',
      'flow.thinking.done': 'Thought',
      'flow.thinking.cutOff': 'Thinking interrupted',
      'flow.loadingLocked': 'Loading earlier history… (page locked until it lands)',
      'flow.stage': 'Task process',
      'flow.stage.duration': 'Took {text}',
      'flow.duration.hour': '{count}h ',
      'flow.duration.minute': '{count}m ',
      'flow.duration.second': '{count}s',
      'flow.status.cutOff': 'Interrupted',
      'flow.status.unfinished': 'Plan unfinished',
      'flow.context.count': '{count} injections',
      'flow.noOps': 'No operations',
      'flow.ops': '{count} operations',
      'flow.tasksDone': 'Done: {text}',
      'flow.pending.steering': 'Steering, waiting',
      'flow.pending.queued': 'Queued',
      'flow.steering': 'Steering',
      'flow.error.title': 'Task view failed to render',
      'flow.error.hint': 'The rest of the UI still works: switch to the Chat tab, or reload the page. Please report the line above to the plugin author.',
      'flow.error.retry': 'Retry',

      'flow.row.context': 'Context preparation',
      'flow.row.command': 'Slash command',
      'flow.row.compaction': 'Compaction',
      'flow.row.manualCompaction': 'Manual compaction',
      'flow.row.modelRetry': 'Model retry',
      'flow.row.turnError': 'Turn error',
      'flow.row.maxTokens': 'Token limit reached',
      'flow.row.unknown': 'Unknown event',

      'flow.card.input': 'Input',
      'flow.card.output': 'Output',
      'flow.card.result': 'Return value',
      'flow.card.answer': 'Answer',
      'flow.card.waiting': 'Waiting for answer…',
      'flow.card.diffNote': 'this change',
      'flow.card.subagent': 'Subagent',
      'flow.card.awaitReport': 'Subagent dispatched; report arrives later',

      'flow.subagent.process': 'Subagent process',
      'flow.subagent.loading': 'Opening the sub-session…',
      'flow.subagent.unavailable': 'This subagent’s process is not readable',
      'flow.subagent.empty': 'No steps to show for this subagent yet',
      'flow.subagent.steps': '{count} steps',
      'flow.subagent.truncated': 'Showing the last {count} steps',
      'flow.subagent.open': 'Open sub-session',

      'flow.text.truncated': 'Very long text — showing the first {shown} of {total} characters',

      'flow.agents.title': 'Subagents',
      'flow.agents.count': '{count} total',
      'flow.agents.running': '{count} running',
      'flow.agents.state.running': 'Working',
      'flow.agents.state.done': 'Done',
      'flow.agents.state.failed': 'Failed',
      'flow.agents.state.interrupted': 'Interrupted',
      'flow.agents.state.unknown': 'Status unknown',
      'flow.agents.mode.oneShot': 'one-shot',
      'flow.agents.mode.continuable': 'continuable',

      'flow.copy': 'Copy',
      'flow.copied': 'Copied',
      'flow.footnotes': 'Footnotes',
      'flow.collapse': 'Collapse',
      'flow.expandRest': 'Show {count} more lines',
      'flow.collapseAria': 'Collapse',
      'flow.expandAria': 'Show {count} more lines',
      'flow.noOutput': '(no output)',
      'flow.exitCode': 'exit code {code}',
      'flow.signal': 'signal {signal}',
    }

    /** Markdown 原子组件要的 chrome 文案（primitives 自己不持有语言回退）。 */
    function markdownLabels(t) {
      return {
        code: { copyLabel: t('flow.copy'), copiedLabel: t('flow.copied') },
        footnotes: t('flow.footnotes'),
      }
    }

    /** 终端卡片要的 chrome 文案，键名与 `TerminalBlock` 的 labels 契约一一对应。 */
    function terminalLabels(t) {
      return {
        signal: (signal) => t('flow.signal', { signal }),
        exitCode: (code) => t('flow.exitCode', { code }),
        running: t('flow.status.running'),
        failed: t('flow.status.failed'),
        done: t('flow.status.done'),
        copy: t('flow.copy'),
        copied: t('flow.copied'),
        noOutput: t('flow.noOutput'),
        collapseAria: t('flow.collapseAria'),
        collapse: t('flow.collapse'),
        expandAria: (count) => t('flow.expandAria', { count }),
        expand: (count) => t('flow.expandRest', { count }),
      }
    }
    /* ──────────────────────────── 工具名 → 卡片类型与统计 ──────────────────────────── */

    /**
     * 核心工具箱自带的工具名。
     *
     * 用途：把「插件提供的工具」与「核心内置工具」分开。DSH 不给插件工具加强制前缀，
     * 所以只能反过来——枚举核心包自带的名字，不在名单里的按「插件提供」计。
     * 名单来自各 `@deepseek-ai/dsh-tool-*` 包里的 `defineTool({ name })`，见
     * `docs/references/core-seams.md`；DSH 升级后新增的内置工具会暂时被算成插件工具，
     * 这是刻意的取舍：宁可把未知归到「插件」，也不要漏掉用户装的插件。
     */
    const CORE_TOOL_NAMES = new Set([
      'read', 'read_image', 'glob', 'grep',
      'web_search', 'web_fetch',
      'todo_write', 'exit_plan_mode',
      'skill', 'subagent', 'subagent_fork', 'send_message', 'interrupt_agent', 'list_agents',
      'workflow', 'ralph', 'create_goal', 'get_goal', 'update_goal',
      'job_list', 'job_output', 'job_kill',
      'run_code', 'cordis_define', 'cordis_undefine', 'cordis_run', 'cordis_stop',
      'cordis_inspect_list', 'cordis_inspect_query', 'cordis_inspect_self',
    ])

    /** 命令类工具名（与核心 `dsh-tool-pwsh` / `dsh-tool-bash` 的注册名一致）。 */
    const COMMAND_TOOL_NAMES = new Set(['pwsh', 'bash'])

    /** 写/改文件类工具名（`dsh-tool-fs` 的 `write`/`edit` 与 `dsh-tool-str-replace-editor`）。 */
    const FILE_MUTATION_TOOL_NAMES = new Set(['write', 'edit', 'str_replace_editor'])

    /**
     * **读取文件**类工具名（`dsh-tool-fs` 的 `read`、`read_image`）。
     *
     * 用户当轮要求统计里要有「读取 n 个文件」这一项。口径刻意收窄：
     * **只有真的把文件内容读进来的工具算**——`grep` / `glob` / `web_fetch` / `list_agents`
     * 这类是「检索/取远端」，不是「读了几个文件」，算进来会让数字虚高。
     * 它们在展开明细里照旧逐条可见，只是不进这一项。
     */
    const READ_TOOL_NAMES = new Set(['read', 'read_image'])

    /** 向用户提问的工具名（`dsh-tool-ask-user`）。 */
    const QUESTION_TOOL_NAMES = new Set(['ask_user_question'])

    /**
     * **本插件自己**注册的工具名：`chat_flow_summary`（「总结命令」）。
     *
     * ⚠️ 这个名字同时存在两份：host 侧在 `lib/protocol.js` 的 `SUMMARY_TOOL_NAME`（注册工具用），
     * 客户端 bundle 是另一个包、只能各持一份字面量。`test/client-bundle.test.js` 有一条接线测试
     * 把两份锁在一起——改名字必须同时改两处。
     *
     * 它不是「核心工具箱」的名字（不放进 {@link CORE_TOOL_NAMES}：那名单讲的是核心包自带的工具），
     * 也**不进任何统计类别**：它是一次协议标记，不是一次操作，派生层会把它连同它划出的分界一起
     * 从「任务过程」里剔出去（见 `20-derive.js` 的 `summaryMarkIndexOf`）。
     */
    const SUMMARY_TOOL_NAME = 'chat_flow_summary'

    /**
     * 这次调用是不是「总结命令」（即「任务过程 / 总结」的分界标记）。
     *
     * @param name - 工具名。
     * @returns 是否总结标记。
     */
    function isSummaryMarkTool(name) {
      return name === SUMMARY_TOOL_NAME
    }

    /**
     * 是否派生子 agent 的工具。
     *
     * 与核心同规则（`CHAT:1363-1365`：`name === 'subagent' || name.startsWith('subagent_')`）——
     * 工具名由部署配置决定，`subagent_codex` / `subagent_claude_code` 这类也在同一族里。
     *
     * @param name - 工具名。
     * @returns 是否子 agent 工具。
     */
    function isSubagentTool(name) {
      return name === 'subagent' || name.startsWith('subagent_')
    }

    /**
     * 折叠统计的类别，**顺序即显示顺序**；计数为 0 的类别不显示。
     *
     * 与最初版本的口径差别（用户逐轮要求）：去掉「插件」，加入「思考次数」，
     * 再加入「读取文件」（`read` / `read_image`）。每一项都以完整句子呈现，
     * 例如「思考 3 次 · 执行 5 条命令 · 读取 2 个文件 · 编辑 1 个文件」（见 `describeStats`）。
     * 子 agent 与其它的内置工具（`todo_write` 等）不进统计，但逐条出现在展开明细里。
     */
    const STAT_CATEGORIES = ['thinking', 'command', 'read', 'file', 'mcp', 'question']

    /**
     * 类别 → locale 键。
     *
     * 派生层只产出类别键，**中文不在这一层出现**：展示文案一律由渲染点通过 `t(...)` 取，
     * 否则英文界面里会漏出中文（primitives 与 locale 的分工就是这么定的）。
     */
    const CATEGORY_LOCALE_KEYS = {
      thinking: 'flow.category.thinking',
      command: 'flow.category.command',
      read: 'flow.category.read',
      file: 'flow.category.file',
      mcp: 'flow.category.mcp',
      question: 'flow.category.question',
    }

    /**
     * 工具名 → 卡片类型。卡片类型决定这一条操作长什么样、展开后显示什么。
     *
     * 判定顺序即优先级；`plain` 是兜底（一行标题 + 摘要，展开显示 JSON 入参与结果文本）。
     *
     * @param name - 工具名。
     * @returns `'subagent' | 'mcp' | 'command' | 'file' | 'question' | 'plain'`。
     */
    function cardKindOfTool(name) {
      if (typeof name !== 'string' || name === '') return 'plain'
      if (isSubagentTool(name)) return 'subagent'
      if (name.startsWith('mcp__')) return 'mcp'
      if (COMMAND_TOOL_NAMES.has(name)) return 'command'
      if (FILE_MUTATION_TOOL_NAMES.has(name)) return 'file'
      if (QUESTION_TOOL_NAMES.has(name)) return 'question'
      return 'plain'
    }

    /**
     * 工具名归类（图标与调试用）。
     *
     * @param name - 工具名。
     * @returns 卡片类型，或 `'core'` / `'plugin'`（无专属卡片的工具）。
     */
    function categoryOfTool(name) {
      const card = cardKindOfTool(name)
      if (card !== 'plain') return card
      return CORE_TOOL_NAMES.has(name) ? 'core' : 'plugin'
    }
    /* ──────────────────────────── 节点树 → 任务流 ──────────────────────────── */

    /**
     * 这一层是纯函数：输入是核心的 chat 快照，输出是「计划 / 任务列表快照 / 子任务 / 卡片 / 统计」视图模型。
     *
     * 之所以全部在这里派生，而不是让 host 另算一份：
     * 验收标准第 10 条要求「统计数字与实际发生在该任务内的调用次数一致」。节点树就是会话日志的
     * 呈现，界面与统计都从同一份数据出发，才不会出现两套真相（见 `docs/exec-plans`）。
     *
     * 本层**不产出任何人类语言**：所有文案由渲染层用 `t(...)` 组装。
     */

    /** 参与明细的非工具节点类型与它的标题键。 */
    const PROCESS_ROW_TITLES = {
      context: 'flow.row.context',
      command: 'flow.row.command',
      compaction: 'flow.row.compaction',
      'manual-compaction': 'flow.row.manualCompaction',
      'model-retry': 'flow.row.modelRetry',
      'turn-error': 'flow.row.turnError',
      'turn-max-tokens': 'flow.row.maxTokens',
      unknown: 'flow.row.unknown',
    }

    /**
     * 本插件**自己接管**的合成节点：不交给原生座位（见 `55-native.js` 的 `seatNodesOf`）。
     *
     * - `turn-process`：核心的「过程折叠」控制器。本插件的任务阶段折叠就是它的替代品，
     *   渲染它等于在一个折叠里再套一个折叠（而且它需要 `turnProcess` 主人参数才能工作）。
     *
     * ⚠️ `turn-tail` **必须**交给原生条目：用户的复制 / 点赞 / 点踩 /「在新对话中分支」按钮
     * 全在它里面（`TurnTailNodeView` 渲染 `MessageIconActions` + `conversation.chat.assistant-actions`
     * 链 + 投递物链 + 用量面板，`CHAT:3536-3581`）。它**不会**重复正文：`closing.blocks`
     * 只是复制按钮的载荷，不作为可见文本渲染。
     */
    const OWNED_NODE_KINDS = new Set(['turn-process'])

    /**
     * 这个节点**必然渲染成空**吗？
     *
     * 判据刻意**只认「已知必然渲染成空」的两种节点**，而不是「统计条目为 0」——
     * `workflow-run` / `command-input` 这类节点由核心的原生叶子画出完整外观，却不在本层的
     * 统计口径里；用「条目为 0」当判据会把它们整块抹掉（`unknown-surface` 这种核心新增的
     * 未知 kind 同理，宁可多画一个空块也不要吃掉内容）。
     *
     * - 本插件自己接管的合成节点（`turn-process`）：座位层不画它；
     * - 没有正文、也没有推理的助手步：核心对它是 `return null`（`CHAT:2898`——既不在流式中、
     *   也不是被打断、块里除工具调用外什么都没有）。
     *
     * 用户报告过这种空白块：「每个对话的最前端（第一个用户输入之前）都会有一个无操作的思考」。
     *
     * @param node - 对话节点。
     * @returns 是否必然渲染成空。
     */
    function isBlankNode(node) {
      if (OWNED_NODE_KINDS.has(node?.kind)) return true
      if (node?.kind !== 'assistant-step') return false
      return assistantTextOf(node) === '' && assistantReasoningOf(node) === ''
    }

    /**
     * 参与「上下文准备」折叠的节点类型：注入的上下文，以及模型的系统提示词。
     *
     * 用户当轮要求「系统提示词注入合并到上下文注入中」——它和规则/记忆/时间那些注入是同一类东西
     * （都是「这一轮开始前给模型准备了什么」），逐条占行只会把动作列表撑长。
     *
     * @param node - 对话节点。
     * @returns 是否属于上下文类节点。
     */
    function isContextNode(node) {
      return node?.kind === 'context' || node?.kind === 'system-prompt'
    }

    /** 上下文类节点的可读文本：`context` 在 `content` 数组里，`system-prompt` 在 `data.text` 里。 */
    function contextTextOf(node) {
      if (node?.kind === 'system-prompt') return typeof node.data?.text === 'string' ? node.data.text : ''
      return messageTextOf(node)
    }

    /**
     * 节点是否**直接显示在对话流里**（用户发言与助手正文）。
     *
     * 它是「过程 run / 正文 run」切分的判据：一段过程里一旦出现对用户可见的正文，
     * 前面的思考块就算结束了（用户要求「思考中过程中如果 AI 输出了对用户显示的内容，
     * 这个思考节点就结束，下次就开始下一个节点」）。
     *
     * @param node - 对话节点。
     * @returns 是否直接显示。
     */
    function isInlineNode(node) {
      if (node?.kind === 'user' || node?.kind === 'steering') return messageTextOf(node) !== ''
      if (node?.kind === 'assistant-step') return assistantTextOf(node) !== ''
      return false
    }

    /**
     * 必须留在**最外层**的节点类型：用户发言、插队消息、收尾控件。
     *
     * 用户当轮要求「用户发送的内容始终保留在最外层的层级，不要能被任意一个节点折叠」。
     * 这类节点既不进过程块、也不进任何折叠体，由回合层直接渲染：
     * - `user` / `steering`：用户说的话（steering 还额外充当分组边界，见 {@link deriveFlow}）；
     * - `turn-tail`：收尾控件（见 {@link isFooterNode}）。
     *
     * @param node - 对话节点。
     * @returns 是否必须留在最外层。
     */
    function isTopLevelNode(node) {
      return node?.kind === 'user' || node?.kind === 'steering' || isFooterNode(node)
    }

    /**
     * 把一段节点切成**交替的 run**：连续的过程节点合成一个 `process` run，
     * 连续的正文节点合成一个 `inline` run；**最外层节点（用户发言/插队/收尾）在这里被剔除并切断 run**
     * ——它们由回合层渲染，且「用户发了消息」本身就意味着上一块到此结束（用户要求）。
     *
     * 渲染层据此把「思考」块切成多个：正文一出现，上一个思考块就封口，后面的动作属于下一个块。
     * 纯函数，可单测。
     *
     * @param nodes - 一段节点（已按呈现序排列）。
     * @returns `{kind:'process'|'inline', nodes}[]`；最外层节点不出现、但会切断相邻的 run。
     */
    function nodeRunsOf(nodes) {
      const runs = []
      const list = Array.isArray(nodes) ? nodes : []
      for (let index = 0; index < list.length; index += 1) {
        const node = list[index]
        if (isTopLevelNode(node)) continue
        const kind = isInlineNode(node) ? 'inline' : 'process'
        const previous = list[index - 1]
        // 紧跟在最外层节点后面的那个节点**必须另起一块**：用户发了消息 → 上一块到此为止。
        const separated = previous !== undefined && isTopLevelNode(previous)
        const last = runs[runs.length - 1]
        if (last !== undefined && last.kind === kind && !separated) last.nodes.push(node)
        else runs.push({ kind, nodes: [node] })
      }
      return runs
    }

    /**
     * 一段 run 里**最后一段正文**的下标（没有正文 run 时返回 -1）。
     *
     * 渲染层用它把「任务过程」分成内外两半（用户要求「思考过程中穿插的对用户输出的内容应该合并到
     * 任务过程里面去，而不应该显示在最外层的层级」）：
     * - 任务还在跑：**所有** run 都在任务过程里（此时折叠体默认展开，看得见）；
     * - 任务结束：只有**最后一段正文**（就是「任务结束时对用户的汇报」）留在最外层，
     *   其余（包括过程中穿插的那些正文）全部收进任务过程。
     *
     * @param runs - {@link nodeRunsOf} 的结果。
     * @returns 下标，或 -1。
     */
    function lastInlineRunIndex(runs) {
      for (let index = (runs?.length ?? 0) - 1; index >= 0; index -= 1) {
        if (runs[index].kind === 'inline') return index
      }
      return -1
    }

    /**
     * 一段节点**结尾那串连续正文**（＝「任务结束时对用户的汇报」）。
     *
     * 用途：把它从分段里摘出来交给回合层渲染，否则它会被关进「任务过程」折叠体
     * （用户报告：「对话完成，但是总结也显示在任务过程内」）。
     *
     * 判据只有一条：{@link nodeRunsOf} 切出来的 run 里**最后一个**必须是 `inline`
     * （也就是这一段的末尾就是正文）。正文之后又跑过工具（末尾是 process run）时返回空——
     * 那不是收尾汇报，只是过程中间的叙述，留在「任务过程」里才对。
     *
     * ⚠️ **不能**拿「最后一个任务列表是否全部完成」当判据（旧实现就是这么写的）：
     * 真机实测 51 个已结束回合里有 7 个的最后一个列表仍留着 `in_progress`（模型没回头改清单），
     * 那 7 个回合的最终回答于是全被关进了折叠体。
     *
     * @param nodes - 一个分段的节点（已按呈现序排列）。
     * @returns 收尾正文节点（没有则空数组）。
     */
    function trailingAnswerOf(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      const runs = nodeRunsOf(list)
      const index = lastInlineRunIndex(runs)
      if (index < 0 || index !== runs.length - 1) return []
      return runs[index].nodes
    }

    /**
     * 这个节点是不是「总结命令」那一次调用。
     *
     * @param node - 任意节点。
     * @returns 是否总结标记调用。
     */
    function isSummaryMarkNode(node) {
      const block = toolBlockOfNode(node)
      return block !== null && isSummaryMarkTool(toolNameOf(block))
    }

    /**
     * 本回合**第一次**「总结命令」（`chat_flow_summary`）调用的下标。
     *
     * 用户要求「新增一个总结命令：agent 在输出本轮对话的最终总结之前必须先调用该命令」——
     * 于是分界由**模型自己声明**，比 {@link trailingAnswerOf} 的启发式硬气得多：
     * 标记之后的输出就是总结，之前的一律算过程。
     *
     * 两条刻意的取舍：
     * - **只认节点形状，不看结果**（与 {@link todosOfToolCall} 同一手法）：流式期间调用还没落定
     *   （`{name, argsRaw}`）就能认出分界，总结区不必等工具返回才出现；
     * - **取第一次**：模型若违反协议调了多次，第一次之后的内容都算总结，不会有第二段过程被漏掉
     *   （后面那几次标记调用同样不渲染，见 {@link isSummaryMarkNode}）。
     *
     * 找不到标记时返回 `-1`，调用方退回启发式（{@link trailingAnswerOf}）——老会话与不遵守协议的
     * 模型都不会退化。
     *
     * @param nodes - 一个回合的节点序列（已按呈现序排列）。
     * @returns 标记节点下标；没有标记则 `-1`。
     */
    function summaryMarkIndexOf(nodes) {
      const list = Array.isArray(nodes) ? nodes : []
      for (let index = 0; index < list.length; index += 1) {
        if (isSummaryMarkNode(list[index])) return index
      }
      return -1
    }

    /**
     * 判断一个工具块是否已落定。
     *
     * 形状来自核心：未落定时是 `{callId, name, argsRaw, …}`；落定后被替换成
     * `{kind:'tool-result', call:{name, argsRaw}, content, isError, error?, meta?, …}`。
     * 因此「有 `kind` 字段」就是「已落定」——核心自己也这么判（`ui-chat` 导出的 `isSettledTool`）。
     *
     * @param block - 工具块。
     * @returns 是否已落定。
     */
    function isSettledToolBlock(block) {
      return block !== null && typeof block === 'object' && 'kind' in block
    }

    /**
     * 取出工具名（落定与未落定两种情况统一）。
     *
     * @param block - 工具块。
     * @returns 工具名，取不到时返回空串。
     */
    function toolNameOf(block) {
      if (block === null || typeof block !== 'object') return ''
      const name = isSettledToolBlock(block) ? block.call?.name : block.name
      return typeof name === 'string' ? name : ''
    }

    /**
     * 取出工具入参原文（JSON 字符串）。
     *
     * @param block - 工具块。
     * @returns 入参原文，取不到时返回空串。
     */
    function toolArgsRawOf(block) {
      if (block === null || typeof block !== 'object') return ''
      const raw = isSettledToolBlock(block) ? block.call?.argsRaw : block.argsRaw
      return typeof raw === 'string' ? raw : ''
    }

    /**
     * 单个工具入参文本的解析上限（字符）。
     *
     * 超过上限直接当「解析不出来」：一次 `JSON.parse` 几 MB 的字符串会把界面线程按住几百毫秒到几秒
     * （历史里出现过把整个文件内容贴进入参的调用），而这一层只是给过程明细取个名字与摘要，
     * 不值得为它卡住整棵视图。返回 `undefined` 而不是抛错——渲染层本来就处理「入参读不到」。
     */
    const MAX_JSON_PARSE_CHARS = 512 * 1024

    /**
     * `JSON.parse` 的安全版本。
     *
     * @param raw - 可能不是合法 JSON 的字符串。
     * @returns 解析值；解析失败、或原文超过 {@link MAX_JSON_PARSE_CHARS} 时返回 `undefined`。
     */
    function parseJsonSafe(raw) {
      if (typeof raw !== 'string' || raw === '') return undefined
      if (raw.length > MAX_JSON_PARSE_CHARS) return undefined
      try {
        return JSON.parse(raw)
      } catch {
        return undefined
      }
    }

    /** 工具入参对象；不是对象时给空对象，调用方不必再判空。 */
    function toolArgsOf(block) {
      const parsed = parseJsonSafe(toolArgsRawOf(block))
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    }

    /**
     * 把内容块数组拼成纯文本（只取 `type:'text'`）。
     *
     * @param content - 内容块数组。
     * @returns 拼接后的文本，块之间用换行分隔。
     */
    function contentToText(content) {
      if (!Array.isArray(content)) return ''
      const parts = []
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
      }
      return parts.join('\n')
    }

    /** 工具调用节点的工具块；不是工具调用节点时返回 `null`。 */
    function toolBlockOfNode(node) {
      if (node === null || typeof node !== 'object') return null
      if (node.kind !== 'tool-call') return null
      const root = node.data?.root
      return root !== null && typeof root === 'object' ? root : null
    }

    /**
     * 该节点是否是一次 `todo_write`，是则返回它写出的整表。
     *
     * 只认「参数能解析出 `todos` 数组、且调用没被拒绝」的调用：被拒绝或参数损坏的调用保留原文但
     * 不算任务列表，这与核心 todo 卡片的行为一致（它同样只信任可解析的 `argsRaw`）。
     *
     * 注意 `isError`：核心拒绝一次 `todo_write`（content 为空、重复项、多于一个 `in_progress`、
     * 或用户拒绝了权限）时，节点仍然保留可解析的 `argsRaw` 并标 `isError: true`——照单全收就会
     * 把一张核心从未接受过的表冻成「计划快照」。
     *
     * @param node - 对话节点。
     * @returns `{content, status}[]`，或 `null`。
     */
    function todosOfToolCall(node) {
      const block = toolBlockOfNode(node)
      if (block === null) return null
      if (toolNameOf(block) !== 'todo_write') return null
      if (block.isError === true) return null
      const raw = toolArgsOf(block).todos
      if (!Array.isArray(raw)) return null
      const todos = []
      for (const item of raw) {
        if (item === null || typeof item !== 'object') return null
        if (typeof item.content !== 'string') return null
        const status = item.status === 'completed' || item.status === 'in_progress' ? item.status : 'pending'
        todos.push({ content: item.content, status })
      }
      return todos
    }

    /**
     * 取节点所属回合号。
     *
     * 三个来源按可靠性排序：节点的 `location`（装配引擎给的权威坐标）、
     * `data.turn`（assistant-step 自带）、工具块自己的 `turn`。都取不到时归 0 号回合，
     * 这样「只有已加载窗口」的历史片段也仍能分组显示，而不是整段消失。
     *
     * @param node - 对话节点。
     * @returns 回合号。
     */
    function turnOfNode(node) {
      const location = node?.location
      if (location?.kind === 'step' || location?.kind === 'turn') {
        const turn = location.turn?.turn
        if (typeof turn === 'number') return turn
      }
      const direct = node?.data?.turn
      if (typeof direct === 'number') return direct
      const block = toolBlockOfNode(node)
      if (block !== null && typeof block.turn === 'number') return block.turn
      return 0
    }

    /**
     * 把工具调用压成一行摘要：优先用最能代表这次操作的那个参数。
     *
     * @param name - 工具名。
     * @param args - 工具入参对象。
     * @returns 一行摘要文本（可能为空串）。
     */
    function summarizeToolCall(name, args) {
      const pick = (key) => (typeof args[key] === 'string' && args[key] !== '' ? args[key] : undefined)
      const firstLine = (text) => text.split('\n', 1)[0].trim()
      if (name === 'todo_write' && Array.isArray(args.todos)) {
        const done = args.todos.filter((item) => item?.status === 'completed').length
        return `${args.todos.length} 项 · ${done} 已完成`
      }
      for (const key of ['command', 'file_path', 'filePath', 'path', 'pattern', 'query', 'url', 'from', 'to']) {
        const value = pick(key)
        if (value !== undefined) return firstLine(value)
      }
      for (const key of ['skill', 'name', 'description', 'prompt', 'plan']) {
        const value = pick(key)
        if (value !== undefined) return firstLine(value)
      }
      return ''
    }

    /** 取节点的时间戳（毫秒）：assistant-step / 工具块 / user 节点各有一处来源。 */
    function nodeTimeOf(node) {
      const direct = node?.data?.time
      if (typeof direct === 'number') return direct
      const block = toolBlockOfNode(node)
      if (block !== null) {
        if (typeof block.callTime === 'number') return block.callTime
        if (typeof block.time === 'number') return block.time
      }
      return undefined
    }

    /** 该回合是否已经结束：时间线说关了，或者出现了只在收尾时才会有的节点。 */
    function turnClosedOf(nodes, timelineTurn) {
      if (timelineTurn !== undefined && timelineTurn.status === 'closed') return true
      for (const node of nodes) {
        if (node?.kind === 'turn-tail' || node?.kind === 'turn-error' || node?.kind === 'turn-max-tokens') return true
      }
      return false
    }
    /**
     * 按核心的呈现序取节点：**只认 `snapshot.order`**。
     *
     * 核心自己就是拿 `order` 渲染节点列表的（`CHAT:2461-2478` 把 `order` 交给 ChatNodeList），
     * 而 `nodes` 这个 Map 里可能**留着已经移出呈现序的节点**——对话回滚（rewind）之后正是如此：
     * `order` 已经去掉回滚点之后的节点，Map 里还留着旧条目。早期版本为了「兜住隐藏节点」
     * 把不在 order 里的条目也补上，结果就是**回滚后旧内容仍然留在界面上**。
     * 现在与核心一致，只用 order。
     *
     * ⚠️ 额外过滤 `visibility === 'hidden'` 的节点（rewind 插件可能把旧版本标记为隐藏而不从 order 移除）。
     * 这样即使核心的 order 里还留有旧节点引用，只要它们被标记为 hidden 就不出现在任务视图里。
     *
     * `order` 缺失/解析不出东西时（装配异常或首次加载的中间态）才退化成「取 Map 的全部值」：
     * 空会话仍然是空，而不会因为拿不到 order 就整块不显示。
     *
     * @param snapshot - `useChat` 快照。
     * @returns 节点数组（呈现序）。
     */
    function orderedNodes(snapshot) {
      const store = snapshot?.nodes
      if (store === undefined || typeof store.values !== 'function') return []
      const order = Array.isArray(snapshot.order) ? snapshot.order : []
      const nodes = []
      for (const key of order) {
        const node = typeof store.get === 'function' ? store.get(key) : undefined
        if (node === undefined || node === null) continue
        // 过滤被 rewind 插件标记为隐藏的节点（即使还在 order 里也不显示）
        if (node.visibility === 'hidden') continue
        nodes.push(node)
      }
      if (nodes.length > 0) return nodes
      for (const node of store.values()) {
        if (node === null || typeof node !== 'object') continue
        if (node.visibility === 'hidden') continue
        nodes.push(node)
      }
      return nodes
    }

    /** assistant-step 里可见的正文（`text` 块）。 */
    function assistantTextOf(node) {
      if (node?.kind !== 'assistant-step' || !Array.isArray(node.data?.blocks)) return ''
      const parts = []
      for (const block of node.data.blocks) {
        if (block?.kind === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
      }
      return parts.join('\n\n')
    }

    /** assistant-step 里的推理文本（`reasoning` 块），折叠进「思考」块。 */
    function assistantReasoningOf(node) {
      if (node?.kind !== 'assistant-step' || !Array.isArray(node.data?.blocks)) return ''
      const parts = []
      for (const block of node.data.blocks) {
        if (block?.kind === 'reasoning' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
      }
      return parts.join('\n\n')
    }

    /** 用户/steering 节点的文字内容。 */
    function messageTextOf(node) {
      return contentToText(node?.data?.content)
    }

    /* ──────────────────────────── 卡片模型 ──────────────────────────── */

    /** 被判为「已取消」的错误码：核心用 `interrupted` 合成被中断的调用，另有若干 ABORTED 家族。 */
    const CANCELLED_CODES = new Set([
      'interrupted',
      'aborted',
      'aborted_before_dispatch',
      'tool_timeout',
      'tool_outcome_unknown',
      'ask_cancelled',
      'ask_aborted',
    ])

    /**
     * 算「**被打断**」的错误码：`CANCELLED_CODES` 的真子集。
     *
     * 两个口径刻意不同（用户裁决过「超时/结果未知这些都不算被打断」）：
     * - **卡片状态**用 `CANCELLED_CODES`：超时与结果未知确实不是「失败」，卡片上写「已取消」更准；
     * - **「被打断」**只认「有人把它掐了」：用户按取消（`interrupted`）、调用被中止
     *   （`aborted*`）、提问被撤回（`ask_*`）。**超时**（`tool_timeout`）与**结果未知**
     *   （`tool_outcome_unknown`）是运行环境的问题，不该把整块思考标成「被打断」。
     */
    const INTERRUPT_CODES = new Set(['interrupted', 'aborted', 'aborted_before_dispatch', 'ask_cancelled', 'ask_aborted'])

    /** 取文本的第一行并截断：卡片折叠态只给一行摘要，完整内容留给展开体。 */
    function firstLineOf(text, limit) {
      if (typeof text !== 'string' || text === '') return ''
      const line = text.split('\n', 1)[0].trim()
      const max = limit ?? 120
      return line.length <= max ? line : `${line.slice(0, max - 1)}…`
    }

    /** 取路径的文件名：折叠态只显示文件名，完整路径留给展开体。 */
    function baseNameOf(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[/\\]+/)
      const name = parts[parts.length - 1]
      return name === '' ? path : name
    }
    /** 取工具块的错误码（落定后 `error.code` 存在时），统一小写便于比对。 */
    function toolErrorCodeOf(block) {
      const code = block?.error?.code
      return typeof code === 'string' ? code.toLowerCase() : ''
    }

    /**
     * 命令结果的终止标记。
     *
     * **退出码与信号不在结果树里**——宿主把它们写进结果文本的尾部：
     * `\n[exit code: N]` / `\n[killed by signal: S]`（见 `core-seams.md` §8.3）。
     * 因此这里做的是**文本解析**，并且要把标记从输出里剥掉（核心的终端卡片也这么做），
     * 否则读者会在输出末尾看到一行本可以做成徽标的原文。
     *
     * @param text - 结果文本。
     * @returns `{output, exitCode, signal, timedOut}`；两个标记都没有时退出码按 0 处理。
     */
    function parseCommandOutcome(text) {
      const source = typeof text === 'string' ? text : ''
      const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(source)
      const exit = /\n\[exit code: (\d+)\]$/.exec(source)
      const timedOut = /\[timed out after \d+ms\]/.test(source)
      let output = source
      if (signal !== null) output = source.slice(0, signal.index)
      else if (exit !== null) output = source.slice(0, exit.index)
      return {
        output,
        exitCode: exit === null ? 0 : Number(exit[1]),
        signal: signal === null ? undefined : signal[1],
        timedOut,
      }
    }

    /**
     * 工具卡的状态，四态：`running` / `done` / `failed` / `cancelled`。
     *
     * 判定顺序刻意把「取消」放在「失败」之前：被用户中断的命令 `isError` 也为真，
     * 若先判失败，就会把「用户主动取消」误报成「运行失败」——那是两件完全不同的事。
     *
     * @param block - 工具块。
     * @param outcome - 命令类工具的文本解析结果（可选）。
     * @returns 状态键。
     */
    function toolStatusOf(block, outcome) {
      if (isSettledToolBlock(block) !== true) return 'running'
      if (CANCELLED_CODES.has(toolErrorCodeOf(block))) return 'cancelled'
      if (outcome !== undefined && (outcome.signal !== undefined || outcome.timedOut)) return 'cancelled'
      if (outcome !== undefined && outcome.exitCode !== 0) return 'failed'
      if (block.isError === true) return 'failed'
      return 'done'
    }

    /** 文本的行数（空串算 0 行，避免「空改动」被算成 1 行）。 */
    function lineCountOf(text) {
      if (typeof text !== 'string' || text === '') return 0
      return text.split('\n').length
    }

    /**
     * 文件编辑卡的行数统计（`+N` / `-N`）。
     *
     * 口径：优先用**入参**推导（模型自己声明的这次改动），因为它同时适用于「运行中」与「已完成」
     * 两种状态，数字不会跳变：
     * - `write`：新增 = 写入内容的行数，删除 = 0；
     * - `edit`：按 `old_string` / `new_string` 的行数；
     * - `str_replace_editor`：按 `old_str` / `new_str`（兼容 `old_string` / `new_string`）。
     *
     * 为什么不直接用结果的 `meta.diffs`：那是真实前后文本的 hunk，**带 3 行上下文**，
     * 上下文行会被同时计入 `+` 与 `−`（核心的 `diffTotals` 也如此），于是「运行中」与
     * 「已完成」的同一处改动会显示成两个不同的数字。这里取「本次改动的行数」，并在
     * 界面上标注为「本次改动」，避免被误读成最终文件差异。
     *
     * 入参里拿不到可比较文本时（例如 `str_replace_editor` 的线号模式），返回 `null`，
     * 由渲染层显示「±0」而不是编一个数字出来。
     *
     * @param name - 工具名。
     * @param args - 工具入参对象。
     * @returns `{added, removed}`，或 `null`（无法判断）。
     */
    function diffCountsOf(name, args) {
      if (name === 'write') {
        return typeof args.content === 'string' ? { added: lineCountOf(args.content), removed: 0 } : null
      }
      const before = args.old_string ?? args.old_str
      const after = args.new_string ?? args.new_str
      if (typeof before !== 'string' || typeof after !== 'string') return null
      return { added: lineCountOf(after), removed: lineCountOf(before) }
    }

    /**
     * 把 MCP 公开工具名切成服务器名与原始工具名。
     *
     * 核心明说公开名**不以反解为契约**（长名或非法字符会被截断并加哈希后缀），
     * 所以这里只做「尽力还原」：解析不出来就整串当函数名，绝不因此丢信息。
     *
     * @param name - 形如 `mcp__<server>__<tool>` 的公开名。
     * @returns `{server, tool}`；`server` 可能为空串。
     */
    function splitMcpToolName(name) {
      if (typeof name !== 'string' || !name.startsWith('mcp__')) return { server: '', tool: String(name ?? '') }
      const rest = name.slice('mcp__'.length)
      const separator = rest.indexOf('__')
      if (separator <= 0) return { server: '', tool: rest }
      return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) }
    }

    /** 提问卡的入参规范化：`questions` → `{id, header, question, options}`。 */
    function questionPromptsOf(args) {
      const raw = Array.isArray(args.questions) ? args.questions : []
      const prompts = []
      for (const item of raw) {
        if (item === null || typeof item !== 'object') continue
        const options = Array.isArray(item.options)
          ? item.options.map((option) => {
              if (option === null || typeof option !== 'object') return String(option)
              return typeof option.label === 'string' && option.label !== '' ? option.label : String(option.value ?? '')
            })
          : []
        prompts.push({
          id: typeof item.id === 'string' ? item.id : '',
          header: typeof item.header === 'string' ? item.header : '',
          question: typeof item.question === 'string' ? item.question : '',
          options,
        })
      }
      return prompts
    }

    /** 提问卡的回答：结果是 `JSON.stringify({answers:[{id, selected[], custom?}]})` 的单个文本块。 */
    function questionAnswersOf(output) {
      const parsed = parseJsonSafe(output)
      const answers = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.answers) ? parsed.answers : null
      if (answers === null) return null
      const byId = new Map()
      for (const answer of answers) {
        if (answer === null || typeof answer !== 'object') return null
        if (typeof answer.id !== 'string') return null
        const selected = Array.isArray(answer.selected) ? answer.selected.filter((item) => typeof item === 'string') : []
        byId.set(answer.id, { selected, custom: typeof answer.custom === 'string' ? answer.custom : '' })
      }
      return byId
    }

    /**
     * 收集子 agent 的卡片上下文：结算通知 + 已被卡片消费掉的子会话 id。
     *
     * @param nodes - 全部（已排序的）节点。
     * @returns `{notices, consumed}`。
     */
    function collectSubagentContext(nodes) {
      const notices = collectSubagentNotices(nodes)
      const consumed = new Set()
      for (const node of nodes) {
        const block = toolBlockOfNode(node)
        if (block === null) continue
        if (!isSubagentTool(toolNameOf(block))) continue
        const childId = subagentChildIdOf(contentToText(block.content))
        if (childId !== '') consumed.add(childId)
      }
      return { notices, consumed }
    }

    /**
     * 工具块 → 卡片模型。
     *
     * 每张卡片都带 `status`（四态）与 `output`（结果文本），渲染层据此决定
     * 卡片头显示什么、展开显示什么。
     *
     * **嵌套子调用一律降级成 `plain`**：`subCalls` 里的子结果既没有 `meta` 也没有 `error`，
     * 按专属卡片解析会得到错的退出码与差异数字。核心的第一方卡片同样在这里放弃（见
     * `core-seams.md` §8.6）。
     *
     * @param block - 工具块。
     * @param subagents - 子 agent 上下文（可选）。
     * @returns 卡片模型。
     */
    function toolCardOf(block, subagents) {
      const name = toolNameOf(block)
      const args = toolArgsOf(block)
      const settled = isSettledToolBlock(block)
      const isChild = block !== null && typeof block === 'object' && block.parentCallId !== undefined
      const rawOutput = settled ? contentToText(block.content) : ''
      // 命令类工具的退出码/信号只能从结果文本尾部的标记里解析（结果树里没有这些字段）。
      const outcome = settled && COMMAND_TOOL_NAMES.has(name) ? parseCommandOutcome(rawOutput) : null
      const kind = isChild ? 'plain' : cardKindOfTool(name)
      const card = {
        kind,
        name,
        settled,
        isChild,
        status: toolStatusOf(block, outcome ?? undefined),
        summary: summarizeToolCall(name, args),
        argsRaw: toolArgsRawOf(block),
        args,
        output: outcome === null ? rawOutput : outcome.output,
        isError: settled && block.isError === true,
      }
      if (kind === 'command') {
        card.command = typeof args.command === 'string' ? args.command : card.summary
        // 折叠态只显示「运行的那条命令」的首行（截断），完整命令与输出都在展开体里。
        card.commandShort = firstLineOf(card.command)
        card.exitCode = outcome === null ? undefined : outcome.exitCode
        card.signal = outcome === null ? undefined : outcome.signal
      }
      if (kind === 'file') {
        card.path =
          typeof args.file_path === 'string' && args.file_path !== ''
            ? args.file_path
            : typeof args.path === 'string' && args.path !== ''
              ? args.path
              : card.summary
        card.diff = diffCountsOf(name, args)
        // 折叠态只显示文件名，不显示完整路径（完整路径在展开体的入参里）。
        card.fileName = baseNameOf(card.path)
      }
      if (kind === 'mcp') {
        const split = splitMcpToolName(name)
        card.server = split.server
        card.mcpTool = split.tool
      }
      if (kind === 'question') {
        card.prompts = questionPromptsOf(args)
        card.status = toolErrorCodeOf(block) === 'ask_cancelled' ? 'cancelled' : card.status
        const answers = settled && card.isError !== true ? questionAnswersOf(rawOutput) : null
        card.answered = answers !== null
        card.prompts = card.prompts.map((prompt) => {
          const answer = answers === null ? undefined : answers.get(prompt.id)
          return {
            ...prompt,
            selected: answer === undefined ? [] : answer.selected,
            custom: answer === undefined ? '' : answer.custom,
          }
        })
      }
      if (kind === 'subagent') {
        card.prompt =
          typeof args.prompt === 'string' && args.prompt !== ''
            ? args.prompt
            : typeof args.description === 'string'
              ? args.description
              : ''
        card.background = args.run_in_background !== false
        card.childId = subagentChildIdOf(card.output)
        // ⚠️ 子 agent 报告在 `subagents.notices` 里（`collectSubagentContext` 的产物）。
        // 这里曾经误写成裸 `notices?.get(...)`（作用域里根本没有这个名字）：只要结果文本真的是
        // `started subagent <uuid>`，取值就会抛 `ReferenceError` —— 历史里带子 agent 调用的会话
        // 一被加载（例如点导轨跳到未加载回合）就会踩到。夹具默认给的是一句普通报告，
        // 所以短路分支（`childId === ''`）把它挡住了，直到真机上翻历史才暴露。
        const notices = subagents?.notices
        const notice = card.childId === '' ? undefined : notices?.get(card.childId)
        card.report = notice
        // 三态：还在跑 / 已派出（后台，报告稍后到）/ 已结算。
        if (card.status !== 'running' && notice === undefined && card.childId !== '') card.status = 'started'
        if (notice !== undefined) card.status = 'done'
      }
      return card
    }

    /**
     * 从子 agent 调用的结果文本里取子会话 id。
     *
     * 后台（默认）派发时结果只有一行 `started subagent <uuid>`；前台调用则直接给报告，
     * 取不到 uuid 就返回空串。`started background subagent job <jobId>` 给的是 jobId
     * 而不是子会话 id，所以这里只认 `started subagent`。
     *
     * @param output - 结果文本。
     * @returns 子会话 id，或空串。
     */
    function subagentChildIdOf(output) {
      if (typeof output !== 'string') return ''
      const matched = /^started subagent ([0-9a-fA-F-]{36})/.exec(output.trim())
      return matched === null ? '' : matched[1]
    }

    /**
     * 收集子 agent 结算通知（父会话节点树里唯一的「子 agent 报告」来源）。
     *
     * 子 agent 结算时父会话会收到一条 `user/message`，其 `source.kind === 'subagent-settled'`，
     * 客户端把它渲染成 `context` 节点：`source.summary` 是一行状态，`content` 里是子 agent 的收尾报告。
     * 子 agent 内部的工具调用与思考**不在**父会话节点树里（子会话是独立会话）。
     *
     * @param nodes - 全部（已排序的）节点。
     * @returns `Map<子会话 id, {summary, text}>`。
     */
    function collectSubagentNotices(nodes) {
      const notices = new Map()
      for (const node of nodes) {
        if (node?.kind !== 'context') continue
        const source = node.data?.source
        if (source?.kind !== 'subagent-settled') continue
        const childId = typeof source.senderSessionId === 'string' ? source.senderSessionId : ''
        if (childId === '') continue
        notices.set(childId, {
          summary: typeof source.summary === 'string' ? source.summary : '',
          text: contentToText(node.data?.content),
        })
      }
      return notices
    }

    /**
     * 一段节点里的明细条目，按节点顺序。
     *
     * 条目类型：
     * - `kind:'thinking'` —— 一段推理（含推理块的助手步）→ 「思考」行，展开看原文；
     * - `kind:'tool'` —— 一次工具调用 → 按 `card.kind` 渲染成专属卡片；
     * - `kind:'row'` —— 一行非工具过程（斜杠命令、上下文压缩、重试…）。
     *
     * 只读内置工具（`read` / `grep` 等）也在其中（`card.kind === 'plain'`）：
     * 所有动作都必须能在展开明细里看到，只是没有专属卡片。
     *
     * @param nodes - 一段节点序列。
     * @returns 明细条目数组。
     */
    function processEntries(nodes, subagents) {
      const entries = []
      for (const node of nodes) {
        const block = toolBlockOfNode(node)
        if (block !== null) {
          entries.push({ kind: 'tool', key: node.key, card: toolCardOf(block, subagents) })
          continue
        }
        if (node?.kind === 'assistant-step') {
          const reasoning = assistantReasoningOf(node)
          if (reasoning !== '') entries.push({ kind: 'thinking', key: node.key, text: reasoning })
          continue
        }
        // 已被子 agent 卡片消费的结算通知不再单独占一行（报告显示在卡片里）。
        if (node?.kind === 'context' && subagents !== undefined) {
          const source = node.data?.source
          if (source?.kind === 'subagent-settled' && subagents.consumed.has(source.senderSessionId)) continue
        }
        // 多次上下文注入**合并成一个**可展开的折叠点（用户要求）：一次回合里往往有
        // 规则/记忆/时间/环境多段注入，逐条占行只会把动作列表撑长。
        if (node?.kind === 'context') {
          const text = messageTextOf(node)
          const existing = entries.find((entry) => entry.kind === 'context')
          if (existing === undefined) {
            entries.push({ kind: 'context', key: node.key, titleKey: PROCESS_ROW_TITLES.context, items: [{ key: node.key, text }] })
          } else {
            existing.items.push({ key: node.key, text })
          }
          continue
        }
        const titleKey = PROCESS_ROW_TITLES[node?.kind]
        if (titleKey !== undefined) entries.push({ kind: 'row', key: node.key, nodeKind: node.kind, titleKey })
      }
      return entries
    }

    /**
     * **单个**节点的回退模型。
     *
     * 与 {@link processEntries} 的分工：那一层给「一段」节点做合并与统计（上下文注入并成一条、
     * 被子 agent 卡片消费掉的结算通知不再占行），这一层只回答「这一个节点自己是什么」。
     * 渲染层主路径走核心的原生座位，只有**座位缺席或渲染失败**时才来取这份模型自绘
     * （见 `lib/client/55-native.js`），所以它必须逐节点独立、不做跨节点合并。
     *
     * @param node - 一个对话节点。
     * @param subagents - 子 agent 上下文（可选，取子 agent 报告用）。
     * @returns `{kind, key, …}`，或该节点没有可渲染内容时 `null`。
     */
    function nodeRowOf(node, subagents) {
      const block = toolBlockOfNode(node)
      if (block !== null) return { kind: 'tool', key: node.key, card: toolCardOf(block, subagents) }
      if (node?.kind === 'assistant-step') {
        const text = assistantTextOf(node)
        if (text !== '') return { kind: 'assistant', key: node.key, text }
        const reasoning = assistantReasoningOf(node)
        return reasoning === '' ? null : { kind: 'thinking', key: node.key, text: reasoning }
      }
      if (node?.kind === 'user' || node?.kind === 'steering') {
        const text = messageTextOf(node)
        return text === '' ? null : { kind: 'message', key: node.key, text }
      }
      if (isContextNode(node)) return { kind: 'context', key: node.key, text: contextTextOf(node) }
      const titleKey = PROCESS_ROW_TITLES[node?.kind]
      return titleKey === undefined ? null : { kind: 'row', key: node.key, nodeKind: node.kind, titleKey }
    }

    /**
     * 把一段节点切成「行」：连续的上下文类节点（注入的上下文 + 系统提示词）合并成一行
     * （用户要求多次注入只占一个折叠点），其余每个节点各占一行。
     * 合并行的位置＝该段里**第一个**上下文节点的位置，顺序不乱。
     *
     * @param nodes - 一段节点（已按呈现序排列）。
     * @returns 行数组：`{kind:'node', node}` 或 `{kind:'contexts', nodes}`。
     */
    function groupProcessNodes(nodes) {
      const rows = []
      let contexts = null
      for (const node of nodes) {
        if (isContextNode(node)) {
          if (contexts === null) {
            contexts = { kind: 'contexts', nodes: [] }
            rows.push(contexts)
          }
          contexts.nodes.push(node)
          continue
        }
        rows.push({ kind: 'node', node })
      }
      return rows
    }

    /**
     * 统计一段节点里的动作，按固定类别分桶。
     *
     * 口径（可逐条核对）：
     * - `thinking`：含推理块的助手步数（一次「思考」算 1 次）；
     * - `command` / `read` / `file` / `mcp` / `question`：对应的**根**工具调用次数；
     *   `read` 只认 `read` / `read_image`（见 `READ_TOOL_NAMES`），检索类不算读文件；
     *   `subCalls`（代码分派等嵌套调用）不重复计数；
     * - 其余工具（子 agent、未知插件工具）不进统计，但仍逐条出现在明细里；
     * - `todo_write`（任务列表更新）是分段边界本身，不算任务执行动作。
     *
     * @param nodes - 一段节点序列。
     * @returns `{counts, listed}`。
     */
    function statsOfNodes(nodes, subagents) {
      const counts = { thinking: 0, command: 0, read: 0, file: 0, mcp: 0, question: 0 }
      const entries = processEntries(nodes, subagents)
      for (const entry of entries) {
        if (entry.kind === 'thinking') {
          counts.thinking += 1
          continue
        }
        if (entry.kind !== 'tool') continue
        // 「读取文件」按工具名判定，而不是卡片类型：读文件的卡片是 `plain`（交给原生叶子画），
        // 没有专属卡片类型，所以只能在统计这一层按名字认。
        if (READ_TOOL_NAMES.has(entry.card.name)) {
          counts.read += 1
          continue
        }
        const kind = entry.card.kind
        if (kind === 'command' || kind === 'file' || kind === 'mcp' || kind === 'question') counts[kind] += 1
      }
      return { counts, listed: entries.length }
    }

    /**
     * 挑出要显示的统计分段：非零的类别，按固定顺序
     * （思考 / 命令 / 读取文件 / 编辑文件 / MCP / 提问）。
     *
     * 只返回类别键与计数，**不含任何文案**——文案由渲染点用 `t(...)` 组装（见 `describeStats`）。
     * 值为 0 的类别**完全不显示**（用户明确要求「若为 0 则不显示对应的项」）。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @returns `{segments, listed}`；`segments` 为空表示这些类别都是 0。
     */
    function statsSummary(stats) {
      const segments = []
      for (const category of STAT_CATEGORIES) {
        const count = stats.counts[category] ?? 0
        if (count > 0) segments.push({ category, count })
      }
      return { segments, listed: stats.listed }
    }

    /**
     * 一段过程是否**没有善终**（被掐断在半路）。
     *
     * 用途是「取消键」那类场景：用户在一次写入的中途按下取消，这一段就停在半路。
     * 渲染层据此**保持这一块展开**——半截内容如果连折叠体一起收起来，看起来就像内容丢了。
     *
     * 判据**只用核心自己给出的中断证据**（两条都来自核心的数据形状）：
     * - `assistant-step`：`data.status === 'interrupted'`（核心自己也用它渲染「已停止」，`CHAT:2995`；
     *   该状态由核心在「这一步没写出 `assistant/message`」时合成，`CHAT:4448` / `4394`）；
     * - 工具块：错误码属于 {@link INTERRUPT_CODES}。**核心会对「没回来的调用」合成
     *   `error.code === 'interrupted'`**（`CHAT:6079-6104`，前提是那一步/回合已经关闭），
     *   所以「被掐断」这件事永远有权威来源，本插件不需要自己去猜。
     *
     * ⚠️ **禁止**再用「工具块还没落定」（`toolStatusOf === 'running'`）当判据（用户裁决：
     * 「命令执行失败不要算被打断」）。没落定只说明**结果没挂到节点上**，不说明有人掐了它：
     * 核心只把 `surfaceOp === 'append'` 的结果挂回调用节点（`CHAT:6142`），
     * 被改写成 `replace` 的结果（历史重放/压缩后很常见，本机实测 20 例，其中 5 例是失败的命令）
     * 于是一批**正常结束甚至失败**的命令会停在「未落定」上——拿它当判据就会把整块思考
     * 误标成「思考被打断」。
     * ⚠️ **超时与结果未知也不算**（用户裁决）：那是运行环境的问题。
     *
     * @param nodes - 一段（或一个块里的）节点。
     * @returns 是否未善终。
     */
    function cutOffOf(nodes) {
      for (const node of nodes ?? []) {
        if (node?.kind === 'assistant-step' && node.data?.status === 'interrupted') return true
        const block = toolBlockOfNode(node)
        if (block === null) continue
        if (INTERRUPT_CODES.has(toolErrorCodeOf(block))) return true
      }
      return false
    }

    /* ──────────────────────────── 待发送 / 插队的消息 ──────────────────────────── */

    /**
     * 已经在呈现序里出现过的 rpcId 集合（核心 `observedRpcIds` 的同义实现，`CHAT:1951-1961`）。
     *
     * 作用：一条「本地回显」的待发送消息，在它变成正式的用户节点之后必须**不再重复显示**，
     * 靠的就是 rpcId 已经出现在 order 的 user/steering 节点里（或出现在队列项里）。
     *
     * @param snapshot - `useChat` 快照。
     * @param queue - `session.queue`。
     * @returns rpcId 集合。
     */
    function observedRpcIdsOf(snapshot, queue) {
      const observed = new Set()
      const store = snapshot?.nodes
      const order = Array.isArray(snapshot?.order) ? snapshot.order : []
      for (const key of order) {
        const node = typeof store?.get === 'function' ? store.get(key) : undefined
        if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
        const rpcId = node.data?.source?.rpcId
        if (typeof rpcId === 'string') observed.add(rpcId)
      }
      for (const item of Array.isArray(queue) ? queue : []) {
        if (typeof item?.rpcId === 'string') observed.add(item.rpcId)
      }
      return observed
    }

    /**
     * 还没进入对话的**用户消息**（核心在对话流末尾渲染的那两串，`CHAT:2483-2492`）。
     *
     * 两种来源，语义不同，所以分开给状态：
     * - `steering`：用户选了「插队发送」，消息排队等着被注入到**正在跑的这一回合**里；
     * - `echo`：刚点发送、host 还没回执的本地回显（`placement === 'queued'` 的那批由输入区自己显示，
     *   与核心一致地在这里跳过）。
     *
     * @param queue - `session.queue`。
     * @param submissions - `session.pendingSubmissions`。
     * @param snapshot - `useChat` 快照（用来判断回显是否已经落地）。
     * @returns `{kind, key, text}[]`。
     */
    function pendingSeatsOf(queue, submissions, snapshot) {
      const seats = []
      for (const item of Array.isArray(queue) ? queue : []) {
        if (item?.placement !== 'steering') continue
        seats.push({
          kind: 'steering',
          key: typeof item.id === 'string' ? item.id : `steering:${seats.length}`,
          text: contentToText(item.content),
        })
      }
      const observed = observedRpcIdsOf(snapshot, queue)
      for (const submission of Array.isArray(submissions) ? submissions : []) {
        if (submission?.placement === 'queued') continue
        const requestId = typeof submission?.requestId === 'string' ? submission.requestId : ''
        if (requestId !== '' && observed.has(requestId)) continue
        seats.push({
          kind: 'echo',
          key: requestId === '' ? `echo:${seats.length}` : requestId,
          text: typeof submission?.text === 'string' ? submission.text : '',
        })
      }
      return seats
    }

    /* ──────────────────────────── 任务列表快照与分段 ──────────────────────────── */

    /**
     * 一份任务列表按「文字 + 出现次序」建索引。
     *
     * 同一份列表里可能出现两项文字完全相同（核心会拒绝这种输入，但历史数据与第三方写入里出现过），
     * 用文字当唯一的键会让一项覆盖另一项；带上「第几次出现」就不会。
     *
     * @param todos - 任务列表（可为 `null`）。
     * @returns `Map<'文字\u0000序号', todo>`。
     */
    function indexTodosByOccurrence(todos) {
      const seen = new Map()
      const indexed = new Map()
      for (const todo of todos ?? []) {
        const nth = seen.get(todo.content) ?? 0
        seen.set(todo.content, nth + 1)
        indexed.set(`${todo.content}\u0000${nth}`, todo)
      }
      return indexed
    }

    /**
     * 比较两版任务列表，得出「这一版改了什么」。
     *
     * 已标记完成的任务不再参与比较（用户明确要求「已标记完成的任务就不管了」）：
     * 它在这一版里是 completed，在上一版里也是 completed，就不算变化；
     * 若这一版把它删掉了，也不算变化（它的历史快照已经冻结在之前的分段里）。
     *
     * @param previous - 上一版整表（首版传 `null`）。
     * @param next - 这一版整表。
     * @returns `{added, started, finished, removed}`：各自是任务文字数组。
     */
    function diffTodos(previous, next) {
      const before = indexTodosByOccurrence(previous)
      const after = indexTodosByOccurrence(next)
      const added = []
      const started = []
      const finished = []
      for (const [key, todo] of after) {
        const was = before.get(key)
        if (was === undefined) {
          added.push(todo.content)
          continue
        }
        if (was.status !== 'completed' && todo.status === 'completed') finished.push(todo.content)
        if (was.status !== 'in_progress' && todo.status === 'in_progress') started.push(todo.content)
        before.delete(key)
      }
      const removed = []
      for (const todo of before.values()) {
        if (todo.status !== 'completed') removed.push(todo.content)
      }
      return { added, started, finished, removed }
    }

    /** 快照里首个 `in_progress` 的下标；没有则 -1。 */
    function activeIndexOf(todos) {
      for (let index = 0; index < todos.length; index += 1) {
        if (todos[index].status === 'in_progress') return index
      }
      return -1
    }

    /**
     * 是否是**回合尾部的收尾节点**（`turn-tail`）。
     *
     * 它是复制 / 点赞 / 点踩 /「在新对话中分支」按钮的载体（见 `core-seams.md §13.5`），
     * 位置必须是**一轮对话的总结之后**——用户当轮明确要求它不要出现在「任务过程」折叠体里面。
     * 因此派生层把它从各段里摘出来单独成组（{@link buildTurnGroup} 的 `footerNodes`），
     * 渲染层在正文序列之后单独渲染它们。
     *
     * @param node - 对话节点。
     * @returns 是否是收尾节点。
     */
    function isFooterNode(node) {
      return node?.kind === 'turn-tail'
    }

    /**
     * 把一个回合切成「任务列表快照段」。
     *
     * **这是本项目最关键的语义**（用户当轮要求）：每一次 `todo_write` 都开一个新分段，
     * 并把当时的整表**冻结**成该段的快照。之后渲染只用这份冻结快照，不去问「最新的列表」——
     * 否则对话里每一处列表都显示同一个最新状态，历史进度就失去意义。
     *
     * 由此自然得到「完成一个任务后必须写明下一个任务，才显示下一个节点」：
     * 下一个任务节点属于**下一个分段**，而下一个分段是由那次 `todo_write` 开启的。
     *
     * 没有任何 `todo_write` 的回合退化成 `unplanned`：全部节点留在 `looseNodes`，
     * 渲染层按操作序列折叠（用户明确要求支持这种情况）。
     *
     * @param turn - 回合号。
     * @param inputNode - 触发本回合的用户节点（可能不存在）。
     * @param nodes - 本回合除用户节点外的全部节点。
     * @returns 回合视图模型。
     */
    function buildTurnGroup(turn, inputNode, nodes, subagents, timelineTurn) {
      /**
       * 「动手之前」的那一段：首个 `todo_write` 之前的节点（想过什么、说过什么、跑过什么）。
       *
       * ⚠️ 它**不再单独成折叠体**（用户要求「移除掉规划过程，全部算任务过程里面」）：
       * 渲染层把它排在「任务过程」折叠体的最前面，与快照面板、子任务、过程明细同一个折叠体。
       */
      const planNodes = []
      const segments = []
      const looseNodes = []
      /** 收尾节点（`turn-tail`）单独成组：它的位置固定在「总结之后」，不能进任何折叠体。 */
      const footerNodes = []
      /**
       * 「总结命令」划出来的那一半：**标记节点之后**的节点（不含标记自己）。
       *
       * 它最终进 `closing`，由回合层渲染在「任务过程」折叠体**外面**——这就是用户要的
       * 「区分任务过程与总结」。
       */
      const summaryNodes = []
      const markIndex = summaryMarkIndexOf(nodes)
      let previousTodos = null
      let current = null
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (isFooterNode(node)) {
          footerNodes.push(node)
          continue
        }
        if (markIndex >= 0 && index >= markIndex) {
          // 标记节点自己**不渲染**（它是一次协议声明，不是一次操作）；它之后的都归「总结」。
          // 模型违反协议多调几次时，后面那几次同样只是声明，一样不渲染。
          if (!isSummaryMarkNode(node)) summaryNodes.push(node)
          continue
        }
        const todos = todosOfToolCall(node)
        if (todos !== null) {
          current = {
            // 与分组 key 用同一个判别符（`inputNode.key`）：同一个回合里可能因为插队消息分成多组，
            // 只带 `turn` 会让两组的 `seg:<turn>:0` 撞成同一个折叠键（折叠状态按会话共享一张表）。
            key: `seg:${turn}:${inputNode?.key ?? 'head'}:${segments.length}`,
            index: segments.length,
            callKey: node.key,
            callNode: node,
            todos,
            changed: diffTodos(previousTodos, todos),
            isPlan: segments.length === 0,
            nodes: [],
          }
          segments.push(current)
          previousTodos = todos.map((todo) => ({ content: todo.content, status: todo.status }))
          continue
        }
        if (current === null) planNodes.push(node)
        else current.nodes.push(node)
      }

      const planned = segments.length > 0
      for (const segment of segments) {
        const activeIndex = activeIndexOf(segment.todos)
        segment.activeIndex = activeIndex
        segment.activeTask = activeIndex >= 0 ? segment.todos[activeIndex].content : null
        segment.stats = statsOfNodes(segment.nodes, subagents)
        segment.completedCount = segment.todos.filter((todo) => todo.status === 'completed').length
        segment.callCard = toolCardOf(toolBlockOfNode(segment.callNode) ?? {}, subagents)
        /**
         * **被后续列表接管**：只要后面还有更新的列表，这一版就不再代表「现在」。
         *
         * 快照**内容**照旧冻结（用户要求「显示也是显示这时的状态」），但它的**运行状态**不能冻结：
         * 旧列表里那一项已经不是「进行中」了，渲染层据此把它显示成「已停止」并默认收起。
         * 不这么做的话，一个回合从头到尾**第一步那一版**都挂着会转的进度圈
         * （用户报告过「老的任务列表都在第一步，都有进度圈在转」）。
         */
        segment.superseded = segment.index < segments.length - 1
      }

      // 「此刻正在做的那一项」：某分段点名了 `in_progress`，且**后续任何一次列表更新都没有**把它
      // 标成完成或删掉。这样历史快照照旧冻结，但只有真正还没结束的那一项默认展开——
      // 否则一个长对话里每一段任务都会摊在界面上。
      for (const segment of segments) {
        if (segment.activeTask === null) {
          segment.isCurrentTask = false
          continue
        }
        const takenOver = segments
          .slice(segment.index + 1)
          .some(
            (later) =>
              later.changed.finished.includes(segment.activeTask) ||
              later.changed.removed.includes(segment.activeTask),
          )
        segment.isCurrentTask = !takenOver
      }

      // 没有任何列表更新：按操作序列折叠。
      // 收尾节点照旧留在里面（渲染层会剔除它们，`stats` 也一直按现在的口径算）。
      if (!planned) {
        for (let index = 0; index < nodes.length; index += 1) {
          if (markIndex >= 0 && index >= markIndex && !isFooterNode(nodes[index])) continue
          looseNodes.push(nodes[index])
        }
      }

      /**
       * 收尾区：**最后一段连续正文**（＝最终回答）从这里摘出去，交给回合层渲染。
       *
       * 摘出去之后它才能落在「任务过程」折叠体**外面**（`TurnGroup` 的 `tailNodes` 就是 `closing`）。
       * 旧实现只在「最后一个列表全部已完成」时才摘，于是只要最后一个列表还留着 `in_progress`，
       * `closing` 就是空的：最终回答留在分段里，被「任务过程」折叠体收走（用户报告的形状）。
       *
       * 只摘**尾巴上那一串**：同一次分段里穿插在工具调用之间的正文留在原处（那属于过程）。
       *
       * ⚠️ 模型**声明过**分界时（`markIndex >= 0`）不再用启发式：`closing` 就是标记之后的全部节点，
       * 一条不落。这样「总结」里即使夹着工具调用或分了好几段正文，也不会有一半被漏回过程里。
       */
      const last = segments[segments.length - 1]
      const closing = []
      if (markIndex >= 0) {
        for (const node of summaryNodes) closing.push(node)
      } else if (last !== undefined) {
        const trailing = trailingAnswerOf(last.nodes)
        if (trailing.length > 0) {
          const kept = last.nodes.slice(0, last.nodes.length - trailing.length)
          for (const node of trailing) closing.push(node)
          last.nodes = kept
          last.stats = statsOfNodes(last.nodes, subagents)
        }
      }

      // 任务耗时：优先用时间线的回合起止；没有时间线就退化成「该回合节点时间的最大最小值」。
      // `startedAt` 单独暴露出来：回合还在跑时渲染层用它做**实时计时**（now - startedAt）。
      let startedAt
      let endedAt
      if (timelineTurn !== undefined && timelineTurn.start !== undefined && timelineTurn.end !== undefined) {
        startedAt = timelineTurn.start.time
        endedAt = timelineTurn.end.time
      } else {
        if (timelineTurn !== undefined && timelineTurn.start !== undefined) startedAt = timelineTurn.start.time
        for (const node of nodes) {
          const time = nodeTimeOf(node)
          if (time === undefined) continue
          if (startedAt === undefined || time < startedAt) startedAt = time
          if (endedAt === undefined || time > endedAt) endedAt = time
        }
      }
      const closed = turnClosedOf(nodes, timelineTurn)
      /**
       * 这个回合**真的被掐断**了吗（用户裁决里「被打断」的唯一判据）。
       *
       * 判据只有核心给出的中断证据（{@link cutOffOf}）：`assistant-step.data.status === 'interrupted'`，
       * 或工具块 `error.code ∈ INTERRUPT_CODES`。超时、结果未知、命令执行失败、后台子 agent 报告未到
       * ——**都不算**（用户裁决）。
       *
       * ⚠️ 旧实现拿「最后一个任务列表里还有 `in_progress`」当判据，真机实测误报 5/7、漏报 7/9：
       * 被标「被打断」的 7 个回合里有 4 个 `turn/end` 明写 `{"kind":"completed"}`；而 9 个真实异常结束
       * （8 次 aborted + 1 次 error）里有 7 个根本没被标。清单没走完很常见（回合被用户打断、
       * 模型自己收尾、清单本来就只写了一半），它不是中断证据，所以降级成中性信号（见 `unfinished`）。
       */
      const cutOff = cutOffOf(nodes)
      /**
       * 回合**结束了**，但最后一个任务列表里还留着「进行中」的任务（**中性信号，不是「被打断」**）。
       *
       * 渲染层用它做两件不算「状态判定」的事：折叠头挂一枚中性徽标（「清单未走完」），
       * 以及任务行状态点显示成「已停止」。
       *
       * ⚠️ **只看最后一个列表**（用户裁决：「最后判定有没有被打断看得是最后一个出现的任务列表的状态，
       * 不然永远在结束的时候会被第一个任务列表改为被打断状态」）：每一版快照都是**冻结**的，
       * 第一个列表里那一项永远停在 `in_progress`，拿「任一版本有进行中」当判据，任何跑过两步以上
       * 的回合都会恒定地被标成「被打断」。
       *
       * ⚠️ 这里**不再**看「有没有调用停在 `running`」。那条判据在真机 2254 条 tool/result 上从未成立
       * （核心只把 `surfaceOp === 'append'` 的结果挂回调用节点，被改写成 `replace` 的结果永远停在
       * 「未落定」，但那些调用本身正常结束甚至失败）——它是死代码，且方向正好是错的。
       * 同理**不把**「后台子 agent 已派出但报告未到」（`card.status === 'started'`）算进来：
       * 那是正常情况（后台派发本来就异步），算进来会让每个跑过 subagent 的回合都挂上标记。
       */
      const unfinished =
        closed && last !== undefined && last.todos.some((todo) => todo.status === 'in_progress')
      /**
       * 本回合**最后一个可渲染节点**的 key（跳过收尾节点）。
       *
       * 「思考中」只属于「此刻还在往里写的那一块」：把 `active` 的判据从「所属回合在跑」收窄到
       * 「这一块里包含这个节点」，于是一个节点写完之后就不再显示「思考中」，而是显示「思考已完成」。
       * 跳过收尾节点的原因：它不参与任何过程折叠（见 {@link isFooterNode}），拿它当判据会让
       * 整个回合没有一块算「正在写」。
       */
      let liveKey = null
      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        if (!isFooterNode(nodes[index])) {
          liveKey = nodes[index].key
          break
        }
      }

      return {
        // key 必须**按分组**唯一：同一个回合里可能因为插队消息而有多个分组（见 deriveFlow）。
        key: `turn:${turn}:${inputNode?.key ?? 'head'}`,
        turn,
        input: inputNode,
        /** 这一组的开头是什么：普通用户发言还是插队消息（渲染层据此选座位与标记）。 */
        inputKind: inputNode?.kind ?? 'user',
        closed,
        /** 回合真的被掐断了吗（唯一判据，见上面的 `cutOff`）。 */
        cutOff,
        /** 回合结束了但最后一个任务列表没走完（中性信号，见上面的 `unfinished`）。 */
        unfinished,
        /**
         * 这一组的节点**全部必然渲染成空**（{@link isBlankNode}）吗？
         *
         * 只用于一件事：没有用户输入的空组不渲染（见 `deriveFlow` 的过滤）。
         */
        blank: nodes.every(isBlankNode),
        durationMs: startedAt === undefined || endedAt === undefined ? null : Math.max(0, endedAt - startedAt),
        startedAt,
        liveKey,
        inputText: messageTextOf(inputNode),
        planned,
        planNodes,
        segments,
        looseNodes,
        closing,
        /**
         * 模型是否显式声明过「总结从这里开始」（本回合调过 `chat_flow_summary`）。
         *
         * 渲染层据此选渲染方式：声明过 → `closing` 是**整段**要画在过程外面的总结；
         * 没声明 → 退回既有启发式（`closing` 只是「最后一段正文」，靠 run 下标分流）。
         */
        summaryMarked: markIndex >= 0,
        footerNodes,
        subagents,
        stats: statsOfNodes(planned ? nodes : looseNodes, subagents),
      }
    }

    /**
     * 主派生：chat 快照 → 回合分组列表。
     *
     * 一个用户输入开一个分组（这就是「任务处理流」的时间边界）。
     *
     * ⭐ **插队消息（`steering`）同样开一个分组**（用户要求）：用户发的内容必须始终留在最外层、
     * 不能被任何折叠节点吞掉，而且「一个节点里用户发了消息」就意味着**那个节点结束了**
     * （他要么去处理另一件事，要么追加了新内容）。把 steering 当成分组边界同时满足这两点：
     * 它以气泡形式成为新分组的开头（永远在最外层），前面那一组的内容不再跨过它继续堆叠。
     *
     * @param snapshot - `useChat((s) => s)` 拿到的快照。
     * @returns `{turns}`。
     */
    function deriveFlowUnsafe(snapshot) {
      const nodes = orderedNodes(snapshot)
      // 子 agent 的报告来自稍后的结算通知，所以索引必须建在**整棵节点树**上
      // （通知可能落在下一个回合里），而不是逐个回合去建。
      const subagents = collectSubagentContext(nodes)
      const timelineTurns = snapshot?.timeline?.turns
      const groups = []
      let current = null
      /**
       * 第一条用户发言**之前**就已经存在的节点。
       *
       * ⚠️ 核心会把「系统提示词」节点排在第一条 `user/message` 之前（`turn/start` 也早于它，
       * 本机实测 seq 5 vs 8），这类节点若自成一组，渲染出来就是一个没有输入气泡、
       * 只剩「任务耗时 + 无操作」的折叠块，回合号又与真正的第一回合**同号**——看起来就像
       * 第一回合的思考被复制了一份留在最前面（用户报告过两次，第十六轮只挡住了 `turn-process`，
       * 漏了 `system-prompt`：{@link isBlankNode} 不认它）。
       *
       * 它们本来就属于第一回合（系统提示词是随第一回合的请求发出去的），所以先攒着，
       * 等第一条用户消息出现时**并进那一组**：这样它和注入的上下文合成同一个折叠体，
       * 最前面也就不会再冒出一个孤零零的折叠头。
       */
      let leading = []
      for (const node of nodes) {
        if (node.kind === 'user' || node.kind === 'steering') {
          current = { turn: turnOfNode(node), input: node, nodes: [] }
          // 攒下的前置节点并入这一组（`unshift` 保序：它们本来就排在用户消息前面）。
          if (leading.length > 0) {
            current.nodes.unshift(...leading)
            leading = []
          }
          groups.push(current)
          continue
        }
        if (current === null) {
          /**
           * 只有**自己渲染不出内容**的前置节点才攒着并入第一回合：`turn-process`（本插件接管）
           * 与上下文类（`system-prompt` / `context`——系统提示词本来就随第一回合的请求发出去）。
           *
           * 反过来，有内容的孤儿节点（历史分页后窗口正好从回合中间开始）必须**自成一组**留在最前面，
           * 那些节点本身是要看的，只是没有输入气泡。
           */
          if (isBlankNode(node) === true || isContextNode(node) === true) {
            leading.push(node)
            continue
          }
          current = { turn: turnOfNode(node), input: undefined, nodes: [] }
          current.nodes.unshift(...leading)
          leading = []
          groups.push(current)
        }
        current.nodes.push(node)
      }
      // 窗口里根本没有用户发言（历史分页正好从回合中间开始）——退化成原来那个「有内容就保留」的头组。
      if (leading.length > 0) {
        groups.push({ turn: turnOfNode(leading[0]), input: undefined, nodes: leading })
      }
      return {
        turns: groups
          .map((item) =>
            buildTurnGroup(item.turn, item.input, item.nodes, subagents, timelineTurns?.get(item.turn)),
          )
          /**
           * ⚠️ **丢掉「没有用户输入、又没有任何可列出内容」的分组**（用户报告过「每个对话的最前端
           * （第一个用户输入之前）都会有一个无操作的思考，时长和第一次任务的第一个思考相同」）。
           *
           * 第一条用户发言之前的节点现在已经**并进第一回合**（见上面的 `leading`），
           * 这里兜的是剩下那一种：窗口里从头到尾没有用户发言（历史分页正好从回合中间开始），
           * 而那一组的节点全都渲染不出东西（`turn-process` 被本插件接管、
           * `assistant-step` 没有正文也没有推理）——只剩一个「任务耗时 + 无操作」的折叠头。
           *
           * 保留有内容的分组（那些孤儿节点本身是要看的，只是没有输入气泡）——判据是
           * 「这一组的每个节点都必然渲染成空」（{@link isBlankNode}），而不是「统计条目为 0」：
           * `workflow-run` / 核心新增的未知 kind 有原生外观却不在统计口径里。
           */
          .filter(
            (group) => group.input !== undefined || group.footerNodes.length > 0 || !group.blank,
          ),
      }
    }

    /**
     * 派生的入口：**永不抛**。
     *
     * 上面那一整套推导都是照着核心当前的节点形状写的，而核心快照的形状会随版本变化
     * （字段改名、数组变对象、嵌套更深）。那种变化不该把整个「任务页面」标签打成白屏——
     * 用户会以为会话坏了。
     *
     * 所以这里兜一层：任何异常都只降级成「空但活着」的视图（标签还在、能切回对话），
     * 并在控制台留一条可追的线索。降级视图用一份空快照现算，因此它必然与正常路径同形。
     *
     * @param snapshot - `useChat((s) => s)` 拿到的快照。
     * @returns `{turns}`；异常时为空的 `{turns: []}`。
     */
    function deriveFlow(snapshot) {
      try {
        return deriveFlowUnsafe(snapshot)
      } catch (error) {
        console.warn('[chat-flow] 派生任务流失败，已降级成空视图', error)
        try {
          return deriveFlowUnsafe({ nodes: new Map(), order: [] })
        } catch {
          return { turns: [] }
        }
      }
    }
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
    /* ──────────────────────────── 样式 ──────────────────────────── */

    /**
     * 一次性注入样式表。
     *
     * 颜色与字号全部走主题 token（`--dsw-*` / `--dsh-*`），不写死色值，
     * 这样浅色/深色主题与用户字号设置都会自动跟随。
     * 类名前缀 `dcf-` 是本插件私有（DSH 里各插件的 `<style>` 是全局的，前缀撞车会互相污染）。
     *
     * 布局分三层，这是右侧导轨能工作的前提：
     * - `.dcf-root` 是块级满宽容器（**不带** max-width）；
     * - `.dcf-rail-slot` 是**零高 sticky 槽**，占满宽度、钉在滚动视口顶部，只在里面绝对定位出导轨；
     * - `.dcf-main` 才是阅读列（限宽 + 居中 + 左右留白让开导轨）。
     *
     * 视觉层次（用户要求「分出主次、该加背景板就加」）：
     * 背景板 = 任务列表快照 `.dcf-plate`；卡片 = 一次操作 `.dcf-card`；
     * 「思考中/思考完成」是容器的标题行，不加板，只靠左侧竖线与缩进表达从属关系。
     */
    const FLOW_CSS = `
.dcf-root{display:block;width:100%;padding:14px 0 8px;box-sizing:border-box;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
.dcf-main{display:flex;flex-direction:column;gap:14px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:0 30px;box-sizing:border-box}
.dcf-empty{color:var(--dsw-alias-label-tertiary);padding:8px 2px}
.dcf-hint{color:var(--dsw-alias-label-tertiary);font-size:13px;background:0 0;border:none;cursor:pointer;text-align:left;padding:4px 2px}
.dcf-hint:hover{color:var(--dsw-alias-label-secondary)}
.dcf-loading{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:6px 2px}
.dcf-spinner{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);animation:dcf-spin .8s linear infinite}
@keyframes dcf-spin{to{transform:rotate(360deg)}}
.dcf-turn{display:flex;flex-direction:column;gap:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;scroll-margin-top:12px}
.dcf-turn:first-child{border-top:none;padding-top:0}
.dcf-ask{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.dcf-askactions{display:flex;justify-content:flex-end}
.dcf-askbuttons{display:flex;align-items:center;gap:6px;min-height:20px}
.dcf-mini{background:0 0;border:none;color:var(--dsw-alias-label-caption);font:inherit;font-size:12px;line-height:18px;padding:0 4px;cursor:pointer;border-radius:4px}
.dcf-mini:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dcf-ask .dcf-bubble{background:var(--dsw-specific-bubble);border-radius:18px;padding:9px 14px;max-width:min(82%,640px);white-space:pre-wrap;word-break:break-word}
.dcf-block{display:flex;flex-direction:column;gap:6px}

/* 原生叶子行：内容 100% 由核心的原生组件渲染，本插件只给行容器与行距。
   核心的阅读列靠 flowItem 兄弟选择器给出行距（dsh-client-ui-chat/lib/client.js:1440），
   而本视图的列是 .dcf-main，所以要自己补上同一条间距（模板里不能出现反引号）。
   折叠体内部比正文行紧一档（8px）：那里是一串动作行，用同一档间距会显得散。 */
.dcf-leaf{display:block;min-width:0}
.dcf-leaf:empty{display:none}
.dcf-leaf+.dcf-leaf{margin-top:var(--dsh-chat-flow-gap,16px)}
.dcf-body>.dcf-leaf+.dcf-leaf,.dcf-platebody>.dcf-leaf+.dcf-leaf{margin-top:8px}
.dcf-leaf+.dcf-thinking,.dcf-thinking+.dcf-leaf,.dcf-leaf+.dcf-block,.dcf-block+.dcf-leaf{margin-top:var(--dsh-chat-flow-gap,16px)}
.dcf-body>.dcf-block,.dcf-body>.dcf-thinking{margin-top:0}
.dcf-note{color:var(--dsw-alias-label-caption);font-size:12px}
/* 一段等宽正文 + 它可能有的截断说明（ClampedPre）：两者贴在一起，说明行不再另起一块。 */
.dcf-ctxpart{display:flex;flex-direction:column;gap:4px;min-width:0}
.dcf-text{overflow-wrap:anywhere}
.dcf-text p{margin:0 0 8px}
.dcf-text p:last-child{margin-bottom:0}
.dcf-pre{margin:0;padding:8px 10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border-radius:6px;overflow:auto;max-height:280px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary)}

/* 行：可折叠的一行标题。整行是按钮（触摸目标 ≥ 32px），hover 才给底色。 */
.dcf-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-row:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}
.dcf-row[data-static=true]{cursor:default}
.dcf-row[data-static=true]:hover{background:0 0}
/* 锁住的折叠行（任务还在跑时的「任务过程」）：点不动，因此也不给 hover 反馈。 */
.dcf-row[data-locked=true]:hover{background:0 0}
/* 展开箭头：**必须让包裹盒恰好等于图标盒**，否则旋转中心不是箭头的几何中心。
   svg 默认是 inline，行高（本视图 22px 左右）会把包裹盒撑高、图标掉到基线上——
   于是在 14×14 的盒子里，旋转中心（盒中心）与箭头中心差了半个行高，看起来就是「绕着角转」。
   用 flex 居中 + svg 的 display:block 把两者对齐，并显式写 transform-origin:center 兜底。
   （注意：本文件是模板字符串，注释里不能出现反引号。） */
.dcf-chev{flex:none;width:14px;height:14px;margin-top:4px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);transition:transform .22s cubic-bezier(.2,.8,.2,1);transform-origin:center}
.dcf-chev>svg{display:block}
.dcf-chev[data-open=true]{transform:rotate(90deg)}
.dcf-title{flex:none;color:var(--dsw-alias-label-secondary)}
.dcf-summary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-count{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dcf-badge{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}
.dcf-body{display:flex;flex-direction:column;gap:6px;padding:2px 0 4px 22px}

/* 子代理过程：内联在子代理卡里的子会话步骤列。
   内容是子会话自己的节点（工具卡 / 思考 / 正文），所以行距沿用叶子那一档并收紧一档；
   max-height 让长过程自己滚，不把卡片撑成整屏。 */
.dcf-subagent{margin-top:2px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:2px}
.dcf-subprocess{display:flex;flex-direction:column;gap:8px;max-height:420px;overflow:auto;padding:2px 0}
.dcf-subprocess .dcf-leaf+.dcf-leaf{margin-top:8px}
.dcf-subagent .dcf-hint{padding:2px 0}

/* 子代理下拉菜单：任务视图顶部的工具条（只在会话真的有子代理时出现）。
   菜单绝对定位在触发器下方，max-height 让它自己滚；状态图标用 data-tone 复用 chip 那套颜色。 */
.dcf-agentbar{width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:4px 30px 2px;box-sizing:border-box;display:flex;align-items:center}
.dcf-agent{position:relative;display:inline-flex}
.dcf-agenttrigger{display:flex;align-items:center;gap:6px;border:0;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 6px;border-radius:6px;font-size:13px}
.dcf-agenttrigger:hover{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12))}
.dcf-agentglyph{flex:none;font-size:10px;line-height:1;color:var(--dsw-alias-label-caption)}
.dcf-agentglyph[data-state=running]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-primary))}
.dcf-agenttitle{font-weight:500}
.dcf-agentcount{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}
.dcf-agentmenu{position:absolute;top:100%;left:0;z-index:20;min-width:240px;max-width:360px;max-height:320px;overflow:auto;margin-top:4px;padding:4px;display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-primary,#fff));border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.16)}
.dcf-agentrow{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;text-align:left;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--dsw-alias-label-primary);font-size:13px}
.dcf-agentrow:hover:not(:disabled){background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12))}
.dcf-agentrow:disabled{cursor:default;opacity:.7}
.dcf-agentrow[data-depth="1"]{padding-left:20px}
.dcf-agentrow[data-depth="2"]{padding-left:32px}
.dcf-agentrow[data-depth="3"]{padding-left:44px}
.dcf-agentrow[data-depth="4"]{padding-left:56px}
.dcf-agentlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-agentmode{flex:none;color:var(--dsw-alias-label-caption);font-size:11px}
.dcf-agentstate{flex:none;font-size:11px;line-height:1;color:var(--dsw-alias-label-caption)}
.dcf-agentstate[data-tone=ok]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-agentstate[data-tone=err]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-agentstate[data-tone=warn]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.dcf-agentstate[data-tone=live]{color:var(--dsw-alias-label-primary)}
.dcf-agentstate[data-state=running]{animation:dcf-agentpulse 1.6s ease-in-out infinite}
@keyframes dcf-agentpulse{0%,100%{opacity:1}50%{opacity:.35}}

/* 折叠动画：grid-template-rows 0fr ↔ 1fr，不需要 JS 量高度。
   子树**保持挂载**（与核心的稳定 seat 同思路）：卸载会丢掉嵌套块的展开状态，
   进出也会退化成「瞬间替换」。收起时用 visibility 把子树的 Tab 焦点一并摘掉。 */
.dcf-fold{display:grid;grid-template-rows:0fr;visibility:hidden;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.dcf-fold[data-open=true]{grid-template-rows:1fr;visibility:visible;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}
.dcf-fold>*{min-height:0;overflow:hidden}

/* 任务列表快照面板：**思考块以外的任务列表要有背景板**（用户要求）——
   它是这一轮任务的「状态板」，与一行行动作明细不是同一层级，用底色 + 描边把它托起来。 */
.dcf-plate{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;padding:2px 4px;margin:2px 0}
.dcf-platehead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:8px;padding:4px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-platehead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-platetitle{flex:none;color:var(--dsw-alias-label-primary)}
.dcf-platebody{display:flex;flex-direction:column;gap:1px;padding:2px 6px 4px 22px}
.dcf-change{color:var(--dsw-alias-label-caption);font-size:12px;padding:2px 0 4px}

/* 任务行：快照里的项与「子任务」折叠体共用一套状态样式。 */
.dcf-tasks{display:flex;flex-direction:column;gap:2px}
.dcf-task{display:flex;flex-direction:column;gap:2px}
.dcf-taskrow{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
button.dcf-taskrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-taskrow[data-status=completed] .dcf-tasktitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dcf-taskrow[data-status=in_progress] .dcf-tasktitle{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-taskrow[data-status=pending] .dcf-tasktitle{color:var(--dsw-alias-label-secondary)}
.dcf-dot{flex:none;margin-top:6px}
.dcf-dot-pending{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dcf-tasktitle{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}

/* 「思考中 / 思考完成」：容器的标题行 + 左侧竖线表达从属，不加背景板（不与卡片抢层级）。 */
.dcf-thinking{display:flex;flex-direction:column;gap:2px}
.dcf-thinkinghead{border-left:2px solid var(--dsw-alias-border-l2)}
.dcf-thinking[data-live=true] .dcf-thinkinghead{border-left-color:var(--dsw-alias-label-primary)}
.dcf-thinkingtitle{flex:none;color:var(--dsw-alias-label-tertiary)}
/* 浮动光效：一道高光在文字上循环扫过，用来表达「还在处理」。 */
.dcf-thinkingtitle[data-shimmer=true]{background-image:linear-gradient(100deg,var(--dsw-alias-label-tertiary) 0%,var(--dsw-alias-label-tertiary) 38%,var(--dsw-alias-label-primary) 50%,var(--dsw-alias-label-tertiary) 62%,var(--dsw-alias-label-tertiary) 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dcf-shimmer 1.8s linear infinite}
@keyframes dcf-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}

/* 卡片：一次操作的背景板。头部一行，展开体在里面。 */
.dcf-card{background:0 0;border:0;border-radius:0;overflow:visible}
.dcf-card[data-live=true]{}
.dcf-cardhead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;padding:4px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-cardhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-cardhead:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:-2px}
.dcf-cardicon{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}
.dcf-cardtitle{flex:none;color:var(--dsw-alias-label-tertiary)}
.dcf-cardsummary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-cardbody{display:flex;flex-direction:column;gap:6px;padding:0 6px 6px 22px}

/* 状态徽标：同一套色调语义给所有卡片复用。 */
.dcf-chip{flex:none;border-radius:999px;padding:1px 8px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12));color:var(--dsw-alias-label-tertiary)}
.dcf-chip[data-tone=ok]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=err]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-chip[data-tone=warn]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=live]{color:var(--dsw-alias-label-primary)}
.dcf-chip[data-tone=add]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=del]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-chip[data-tone=muted]{opacity:.7}

/* 提问卡：问题 + 选项（被选中的那项高亮）。 */
.dcf-question{display:flex;flex-direction:column;gap:2px}
.dcf-questiontext{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dcf-option{color:var(--dsw-alias-label-tertiary);font-size:13px;padding-left:14px;position:relative}
.dcf-option::before{content:'·';position:absolute;left:4px}
.dcf-option[data-chosen=true]{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-option[data-chosen=true]::before{content:'✓'}

/* 右侧回合导轨：粘在滚动视口顶部的零高槽里，绝对定位出竖向刻度条。 */
.dcf-rail-slot{position:sticky;top:0;z-index:7;height:0;pointer-events:none}
.dcf-rail{--dcf-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px));position:absolute;right:6px;top:calc(var(--dcf-rail-band) / 2);transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;padding:6px 0;max-height:min(420px,max(0px,calc(var(--dcf-rail-band) - 80px)));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;pointer-events:auto}
.dcf-rail::-webkit-scrollbar{display:none}
/* 刻度：一个方格，里面写**回合号**（用户要求数字显示；横线认不出这是第几轮）。
   状态靠边框与文字颜色区分，不靠形状——形状已经让给数字了。 */
.dcf-mark{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:20px;padding:0;border:1px solid var(--dsw-alias-border-l4,#3a3a3a);border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10px;line-height:1;font-variant-numeric:tabular-nums;cursor:pointer;transition:border-color .14s ease,color .14s ease,background-color .14s ease}
.dcf-mark:hover{border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-secondary,#ccc)}
.dcf-mark[data-active=true]{border-color:var(--dsw-alias-label-primary);background:var(--dsw-alias-surface-tertiary,rgba(140,140,140,.2));color:var(--dsw-alias-label-primary)}
.dcf-mark[data-loaded=false]{border-style:dashed;opacity:.6}
.dcf-mark[data-live=true] .dcf-marknum{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark[data-busy=true] .dcf-marknum{color:transparent}
.dcf-mark .dcf-spinner{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:10px;height:10px}
.dcf-mark:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px}
.dcf-scroll-bottom-btn{position:fixed;bottom:56px;right:28px;z-index:8;display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,#444);background:var(--dsw-alias-surface-secondary,rgba(30,30,30,.85));color:var(--dsw-alias-label-secondary,#ccc);cursor:pointer;backdrop-filter:blur(4px);box-shadow:0 2px 12px rgba(0,0,0,.35);transition:opacity .18s ease,transform .14s ease}
.dcf-scroll-bottom-btn:hover{background:var(--dsw-alias-surface-tertiary,rgba(50,50,50,.9));transform:translateY(-1px)}
.dcf-scroll-bottom-btn:active{transform:translateY(0)}
.dcf-scroll-bottom-btn:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px}

@keyframes dcf-mark-live{0%,100%{opacity:1}50%{opacity:.35}}

/* 窄屏 / 手机：阅读列收窄内边距、导轨变细并让位、触摸目标加大、避开安全区。
   导轨**不隐藏**——它是这个视图的主要导航；只把它压细并给内容留出右侧空间。 */
@media (max-width:720px){
.dcf-root{padding:10px 0 8px}
.dcf-main{gap:12px;padding:0 20px 0 12px}
.dcf-agentbar{padding:4px 20px 2px 12px}
.dcf-rail{right:2px;gap:10px;max-height:min(320px,max(0px,calc(var(--dcf-rail-band) - 48px)))}
.dcf-mark{width:24px;height:24px;font-size:11px}
.dcf-ask .dcf-bubble{max-width:100%}
.dcf-summary{max-width:42vw}
.dcf-cardhead,.dcf-platehead{padding:9px 10px}
button.dcf-row,button.dcf-taskrow{min-height:34px;align-items:center}
.dcf-chev{margin-top:0}
.dcf-dot{margin-top:0}
.dcf-cardsummary{font-size:12px}
.dcf-pre{max-height:220px;font-size:11px}
.dcf-cardbody{padding:0 10px 10px 10px}
.dcf-body{padding:2px 0 4px 14px}
.dcf-platebody{padding:2px 8px 6px 16px}
.dcf-leaf+.dcf-leaf{margin-top:12px}
}

/* 行首状态标记（目前只有插队消息用）：贴在气泡上方，说明这条消息是怎么进来的。 */
.dcf-leaf-marked{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dcf-leafmarker{align-self:flex-end;margin-right:4px}

/* 待发送 / 插队的消息：坐在列表末尾，一眼看出「我发的消息去哪了」。 */
.dcf-pending{display:flex;flex-direction:column;align-items:flex-end;gap:4px;opacity:.92}
.dcf-pendingstate{display:flex;justify-content:flex-end;padding-right:4px}

/* 视图层错误摘要：不白屏、可读、可反馈（正常情况永远看不到它）。 */
.dcf-error{display:flex;flex-direction:column;gap:8px;margin:10px 0;padding:12px 14px;border:.5px solid var(--dsw-alias-state-error-primary,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08))}
.dcf-errortitle{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-weight:500}

/* 触屏设备：去掉只对鼠标有意义的悬浮反馈，避免点击后残留 hover 态。
   刻度仍然要够大（34px 宽），数字读得清。 */
@media (hover:none){
.dcf-rail{right:0;gap:12px}
.dcf-mark{width:34px;height:24px}
.dcf-row:hover,button.dcf-taskrow:hover,.dcf-cardhead:hover,.dcf-platehead:hover{background:0 0}
}

/* 动效收敛：尊重系统的「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
.dcf-fold,.dcf-fold[data-open=true],.dcf-chev,.dcf-mark{transition:none}
.dcf-mark[data-live=true] .dcf-marknum{animation:none}
.dcf-thinkingtitle[data-shimmer=true]{animation:none;background-image:none;color:inherit}
}
`

    /** 注入样式：按固定 id 去重，重复调用不会堆 `<style>`。 */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = FLOW_CSS
      document.head.appendChild(style)
    }
    /* ──────────────────────────── 消息 ──────────────────────────── */

    /** 复制一段文本到剪贴板，并把「已复制」状态显示一小会儿。 */
    function useCopyAction(text) {
      const [copied, setCopied] = useState(false)
      const onCopy = useCallback(() => {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            navigator.clipboard.writeText(text)
          }
        } catch {
          // 剪贴板不可用（非安全上下文等）：静默失败，不打断阅读。
        }
        setCopied(true)
        if (typeof window !== 'undefined') window.setTimeout(() => setCopied(false), 1500)
      }, [text])
      return [copied, onCopy]
    }

    /**
     * 单个文本节点的渲染上限（字符）。
     *
     * 历史里出现过单条正文几十万字符的情况（把整个文件贴进回复、模型一次吐出超长答案）：整段交给
     * `MarkdownText` 或塞进 `<pre>`，浏览器要花几百毫秒到几秒排版、再吃掉几十上百 MB 内存，
     * 面板看起来就像卡死了。这里统一截断，并在下面补一行「已截断」说明——**不静默丢内容**。
     */
    const MAX_RENDER_CHARS = 200000

    /**
     * 截断超长正文。
     *
     * @param value - 原文本（非字符串当成空串）。
     * @param max - 上限（默认 {@link MAX_RENDER_CHARS}）。
     * @returns `{text, truncated, total}`：`total` 只在截断时给出（原始字符数）。
     */
    function clampText(value, max = MAX_RENDER_CHARS) {
      const text = typeof value === 'string' ? value : ''
      if (!(max > 0) || text.length <= max) return { text, truncated: false }
      return { text: text.slice(0, max), truncated: true, total: text.length }
    }

    /**
     * 超长正文的截断说明行（没截断时什么都不画）。
     *
     * @param props - `clamped`（{@link clampText} 的结果）、`t`。
     * @returns 说明行；`t` 缺席时退回裸键（与视图其余部分的降级口径一致）。
     */
    function TruncationNote({ clamped, t }) {
      if (clamped === null || typeof clamped !== 'object' || clamped.truncated !== true) return null
      const translate = typeof t === 'function' ? t : (key) => key
      return h(
        'div',
        { className: 'dcf-note' },
        translate('flow.text.truncated', { shown: clamped.text.length, total: clamped.total }),
      )
    }

    /**
     * 一段等宽正文（`<pre>`）+ 超长时的截断说明。
     *
     * 文件卡的入参/结果、上下文注入、子代理的任务描述都走这里：这些都是**原文照排**的长文本，
     * 也是历史上真正把面板拖卡的那一类。
     *
     * @param props - `text`、`t`。
     * @returns 正文块（内部自带说明行）。
     */
    function ClampedPre({ text, t }) {
      const clamped = clampText(text)
      return h(
        'div',
        { className: 'dcf-ctxpart' },
        h('pre', { className: 'dcf-pre' }, clamped.text),
        h(TruncationNote, { clamped, t }),
      )
    }

    /**
     * 用户消息气泡（字面文本，不做 markdown 解析——与核心的用户气泡语义一致）。
     *
     * 行内内容走 {@link UserText}（平台的 `projectUserText`，`@文件` / `/技能` 是 chip）。
     *
     * ⚠️ **这里必须照着核心的 DOM 约定输出属性**，否则别人的插件挂不上来：
     * 回退插件（`dsh-rewind-plugin`）用一段 DOM 桥，按
     * `[data-chat-flow-kind="user"][data-chat-anchor-key]` 找用户消息座位，
     * 再往座位里的 `[data-actions-reveal]` 容器的**最后一个子元素**里 portal 一个「还原到此处」按钮
     * （它要求那个容器里**已经有一个按钮**，否则整条座位被跳过）。
     * 所以这里给座位打上这两个属性，并在里面放一个真实的「复制」按钮：
     * 既是有用的功能，也是那个容器被认领的前提。
     *
     * @param props - `text`、`nodeKey`（该消息节点的 key，用作锚点）、`kind`（`user` / `steering`）、`t`。
     * @returns 用户消息行。
     */
    function UserBubble({ text, nodeKey, kind, t }) {
      const [copied, onCopy] = useCopyAction(typeof text === 'string' ? text : '')
      if (typeof text !== 'string' || text.trim() === '') return null
      // 复制按钮始终拿**原文**，只有渲染走截断后的文本。
      const clamped = clampText(text)
      const anchors =
        nodeKey === undefined
          ? {}
          : { 'data-chat-flow-kind': kind ?? 'user', 'data-chat-anchor-key': nodeKey }
      return h(
        'div',
        { className: 'dcf-ask', ...anchors },
        h('div', { className: 'dcf-bubble' }, h(UserText, { text: clamped.text })),
        h(TruncationNote, { clamped, t }),
        h(
          'div',
          { className: 'dcf-askactions', 'data-actions-reveal': 'true' },
          h(
            'div',
            { className: 'dcf-askbuttons' },
            h(
              'button',
              { type: 'button', className: 'dcf-mini', title: t('flow.copy'), onClick: onCopy },
              copied ? t('flow.copied') : t('flow.copy'),
            ),
          ),
        ),
      )
    }

    /**
     * 助手正文。
     *
     * 用核心的 `MarkdownText` 而不是自造渲染：它已经处理了不可信输出（丢弃原始 HTML、
     * 失效不安全链接、增量流式高亮），自己写会把这些安全与性能细节一并丢掉。
     *
     * @param props - `text`、`labels`、`t`（只为超长正文的截断说明行，缺席时退回裸键）。
     */
    function AssistantText({ text, labels, t }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      const clamped = clampText(text)
      return h(
        'div',
        { className: 'dcf-text' },
        h(MarkdownText, { text: clamped.text, labels }),
        h(TruncationNote, { clamped, t }),
      )
    }

    /* ──────────────────────────── 基础零件 ──────────────────────────── */

    /** 每个卡片类型对应的行首图标（同一类型用同一个字形，一眼能扫出操作类型）。 */
    const CARD_ICONS = {
      command: 'IconCodeOutline16',
      file: 'IconEditOutline16',
      mcp: 'IconCordisPluginOutline14',
      question: 'IconQuestionOutline14',
      subagent: 'IconAgentPresetOutline16',
      plain: 'IconInspectOutline12',
    }

    /**
     * 取某个卡片类型的图标组件。
     *
     * @param kind - 卡片类型。
     * @returns 图标组件；primitives 里没有该字形时返回 `null`（渲染层留等宽占位）。
     */
    function iconForCard(kind) {
      const icon = primitives[CARD_ICONS[kind] ?? '']
      if (typeof icon === 'function' || (icon !== null && typeof icon === 'object' && icon !== undefined)) return icon
      const fallback = primitives.IconInspectOutline12
      return typeof fallback === 'function' ? fallback : null
    }

    /**
     * 可折叠行左端的箭头：**状态与旋转都挂在包裹容器上**。
     *
     * ⚠️ primitives 的图标组件只接受 `size` / `className` 两个 prop
     * （`({ size = 14, className }) => jsx('svg', {...})`），`data-*` **不会**透传到 `<svg>`。
     * 所以 `data-open` 与旋转都放在外层 `<span class="dcf-chev">` 上，否则 CSS 的
     * `[data-open=true]` 永远匹配不到、箭头永远不转（这是本视图第一个真实缺陷）。
     *
     * @param props - `open`：展开时向右旋转 90°，指向下。
     * @returns 箭头容器。
     */
    function Chevron({ open }) {
      const icon = primitives.IconChevronRightOutline14
      return h(
        'span',
        { className: 'dcf-chev', 'data-open': open === true ? 'true' : 'false' },
        typeof icon === 'function' ? h(icon, {}) : null,
      )
    }

    /**
     * 折叠容器：切换 CSS grid 轨道高度（`0fr ↔ 1fr`）并过渡，可选**懒加载**。
     *
     * 三个设计点：
     * 1. **默认保持挂载**——展开状态归组件自己所有（例如展开的任务里那个展开的「思考中」），
     *    卸载会把它丢掉；核心的 `ChatNodeSeat` 也奉行「稳定 seat、只隐藏不卸载」。所以
     *    `lazy` 默认关闭：收起只改 CSS，子树留在树里。
     * 2. **`lazy` 只给装了重子树的折叠体用**（当前只有「思考中 / 思考完成」块）——它默认收起、
     *    而正文里的每一条明细都要经原生座位 `conversation.chat.node` 走一遍核心渲染，一个长
     *    会话里这就是几百次白跑。这类折叠体在收起时只留**空壳**（`.dcf-fold` + 空白 `.dcf-body`），
     *    展开时才把子树挂上。空壳留在 DOM 里是为了让「展开」那一帧仍有 CSS 过渡可插值
     *    （连容器一起卸载就变成瞬间替换而不是滑开）。
     *    卸载**不会**丢嵌套块的展开状态：状态归 `useCollapse` 所有，存在 localStorage 里，
     *    重新挂载时按同一个键读回来（见 `30-collapse.js`）。
     * 3. **不量高度**——`grid-template-rows` 的过渡由浏览器插值，无需 `useLayoutEffect` +
     *    `scrollHeight`，内容流式增长时也不会抖。收起时再用 `visibility: hidden`（延迟到动画
     *    结束）把子树从 Tab 顺序里摘出去。
     *
     * @param props - `open`、`className`（内层类名，承载 padding/gap）、`children`、`lazy`。
     * @returns 折叠容器；**没有内容**时返回 `null`（不留下无意义的空壳）。
     */
    function Fold({ open, className, children, lazy }) {
      if (children === undefined || children === null) return null
      // 懒加载路径：收起即不渲染子树；其余折叠体照旧「收起只改 CSS」。
      const body = open === true || lazy !== true ? children : null
      return h(
        'div',
        { className: 'dcf-fold', 'data-open': open === true ? 'true' : 'false' },
        h('div', { className: className ?? 'dcf-body' }, body),
      )
    }

    /**
     * 通用折叠行：一行标题 + 摘要 + 右侧徽标，展开体经 {@link Fold}。
     *
     * 交互与核心的工具行一致（点整行切换、`aria-expanded` 可读），因为这是同一个心智模型：
     * 先看一行摘要，需要时再展开看明细。不可展开的行走纯文本行（`div`）而不是 disabled 按钮
     * ——它是一条标签，不是一个失效控件。
     *
     * `locked` 表示「此刻不允许开合」（例如任务还在跑时的「任务过程」）：整行退化成静态行并带
     * `data-locked`，用户点不动它；`open` 与摘要照常显示，所以读者仍然看得到状态。
     *
     * @param props - `open`、`onToggle`、`leading`、`title`、`summary`、`trailing`、`children`、`className`、`locked`。
     * @returns 可折叠行。
     */
    function DisclosureLine({ open, onToggle, leading, title, summary, trailing, children, className, locked }) {
      const interactive = typeof onToggle === 'function' && locked !== true
      const cells = [
        h(Chevron, { open }),
        leading ?? null,
        title === undefined || title === null ? null : h('span', { className: 'dcf-title' }, title),
        summary === undefined || summary === null || summary === ''
          ? null
          : h('span', { className: 'dcf-summary' }, summary),
        trailing ?? null,
      ]
      const row = interactive
        ? h(
            'button',
            { type: 'button', className: 'dcf-row', 'aria-expanded': open === true, onClick: onToggle },
            ...cells,
          )
        : h(
            'div',
            { className: 'dcf-row', 'data-static': 'true', 'data-locked': locked === true ? 'true' : undefined },
            ...cells,
          )
      return h('div', { className: className ?? 'dcf-block' }, row, h(Fold, { open }, children))
    }

    /* ──────────────────────────── 卡片 ──────────────────────────── */

    /** 状态徽标：命令/提问/子 agent 的四态都用它，颜色由 `data-tone` 决定。 */
    function StatusChip({ tone, text }) {
      if (typeof text !== 'string' || text === '') return null
      return h('span', { className: 'dcf-chip', 'data-tone': tone }, text)
    }

    /** 命令卡的状态文案（四态）。 */
    function commandStatusText(t, status) {
      if (status === 'running') return t('flow.status.running')
      if (status === 'failed') return t('flow.status.failed')
      if (status === 'cancelled') return t('flow.status.cancelled')
      return t('flow.status.done')
    }

    /** 状态 → 色调（复用同一套颜色语义，避免每张卡自己发明一套）。 */
    function toneOfStatus(status) {
      if (status === 'failed') return 'err'
      if (status === 'cancelled') return 'warn'
      if (status === 'running') return 'live'
      return 'ok'
    }

    /**
     * 卡片外壳：图标 + 标题 + 摘要 + 状态徽标，展开体在下方。
     *
     * 所有专属卡片都用它，因此「卡片长什么样、展开怎么动」只有一处实现。
     *
     * @param props - `kind`（决定图标）、`title`、`summary`、`chips`、`live`、`open`、`onToggle`、`children`。
     * @returns 卡片。
     */
    function Card({ kind, title, summary, chips, live, open, onToggle, children }) {
      const icon = iconForCard(kind)
      const leading = icon === null ? h('span', { className: 'dcf-chev' }) : h(icon, { className: 'dcf-cardicon' })
      return h(
        'div',
        { className: 'dcf-card', 'data-kind': kind, 'data-live': live === true ? 'true' : 'false' },
        h(
          'button',
          { type: 'button', className: 'dcf-cardhead', 'aria-expanded': open === true, onClick: onToggle },
          h(Chevron, { open }),
          leading,
          h('span', { className: 'dcf-cardtitle' }, title),
          summary === undefined || summary === null || summary === ''
            ? null
            : h('span', { className: 'dcf-cardsummary' }, summary),
          ...(Array.isArray(chips) ? chips : []),
        ),
        h(Fold, { open, className: 'dcf-cardbody' }, children),
      )
    }

    /** 文件编辑卡的差异徽标：红色 `−N`、绿色 `+N`。 */
    function DiffChips({ added, removed }) {
      const chips = []
      if (removed > 0) chips.push(h('span', { key: 'minus', className: 'dcf-chip', 'data-tone': 'del' }, `−${removed}`))
      if (added > 0) chips.push(h('span', { key: 'plus', className: 'dcf-chip', 'data-tone': 'add' }, `+${added}`))
      if (chips.length === 0) chips.push(h('span', { key: 'none', className: 'dcf-chip', 'data-tone': 'muted' }, '±0'))
      return chips
    }

    /** 命令卡：头部一行状态，展开后是终端卡片（命令 + 输出）。 */
    function CommandCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, card.status === 'running')
      const chips = [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: commandStatusText(t, card.status) })]
      if (card.exitCode !== undefined && card.exitCode !== 0) {
        chips.push(h(StatusChip, { key: 'exit', tone: 'err', text: t('flow.exitCode', { code: card.exitCode }) }))
      }
      if (card.signal !== undefined) {
        chips.push(h(StatusChip, { key: 'signal', tone: 'warn', text: t('flow.signal', { signal: card.signal }) }))
      }
      return h(
        Card,
        {
          kind: 'command',
          title: t('flow.category.command'),
          summary: card.commandShort,
          chips,
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(TerminalBlock, {
          command: card.command,
          output: card.output,
          running: card.status === 'running',
          exitCode: card.exitCode,
          signal: card.signal,
          maxLines: 14,
          labels: terminalLabels(t),
        }),
      )
    }

    /** 文件编辑卡：头部显示路径与 `−N/+N`，展开后是入参与结果。 */
    function FileCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      const counts = card.diff ?? { added: 0, removed: 0 }
      return h(
        Card,
        {
          kind: 'file',
          title: t('flow.category.file'),
          summary: card.fileName,
          chips: DiffChips(counts),
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h('div', { className: 'dcf-note' }, t('flow.card.diffNote')),
        h(ClampedPre, { text: card.argsRaw === '' ? t('flow.noOutput') : card.argsRaw, t }),
        card.output === '' ? null : h(ClampedPre, { text: card.output, t }),
      )
    }

    /** MCP 卡：头部只写函数名，展开才给输入与返回值。 */
    function McpCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      const title = card.server === '' ? card.mcpTool : `${card.server} · ${card.mcpTool}`
      return h(
        Card,
        {
          kind: 'mcp',
          title: t('flow.category.mcp'),
          summary: title,
          chips: [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: commandStatusText(t, card.status) })],
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(JsonBlock, { label: t('flow.card.input'), payload: card.args }),
        card.output === '' ? null : h(JsonBlock, { label: t('flow.card.result'), payload: card.output }),
      )
    }

    /** 提问卡：头部是问题本身，展开后是选项与用户回答（按问题 id 回配）。 */
    function QuestionCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, card.answered !== true)
      const first = card.prompts[0]
      const summary =
        first === undefined ? card.summary : first.header !== '' ? `${first.header}：${first.question}` : first.question
      const body = []
      for (const prompt of card.prompts) {
        const parts = [h('div', { key: 'q', className: 'dcf-questiontext' }, prompt.question)]
        for (const option of prompt.options) {
          const chosen = prompt.selected.includes(option)
          parts.push(
            h('div', { key: `o:${option}`, className: 'dcf-option', 'data-chosen': chosen ? 'true' : 'false' }, option),
          )
        }
        if (prompt.custom !== '') parts.push(h('div', { key: 'custom', className: 'dcf-option' }, prompt.custom))
        body.push(h('div', { key: prompt.id === '' ? prompt.question : prompt.id, className: 'dcf-question' }, parts))
      }
      if (card.output !== '') {
        body.push(h(JsonBlock, { key: 'answer', label: t('flow.card.answer'), payload: card.output }))
      }
      return h(
        Card,
        {
          kind: 'question',
          title: t('flow.category.question'),
          summary,
          chips: [
            h(StatusChip, {
              key: 'status',
              tone: card.status === 'cancelled' ? 'warn' : card.answered === true ? 'ok' : 'live',
              text:
                card.status === 'cancelled'
                  ? t('flow.status.cancelled')
                  : card.answered === true
                    ? t('flow.status.done')
                    : t('flow.card.waiting'),
            }),
          ],
          live: card.answered !== true && card.status !== 'cancelled',
          open,
          onToggle: toggle,
        },
        body,
      )
    }

    /**
     * 子 agent 卡：**输出默认展开**，子 agent 结束后**自动折叠**这个节点。
     *
     * 与「思考中」同一层（都是任务下的处理过程），因此层级是
     * 任务处理流 > 子任务 > 小处理过程 = 子 agent 操作（用户当轮要求的分级）。
     * 展开体是子 agent 交回的报告文本；报告下方还有一块「子代理过程」——子会话的内部步骤
     * 不在父会话的节点树里（子会话是独立会话），只有**读子会话自己的事件流**才看得见，
     * 见 `58-subagent.js`（拿不到时那块面板自己消失，卡片行为与以前完全一致）。
     */
    function SubagentCard({ card, t, sessionId, keyPrefix }) {
      const report = card.report
      // 默认展开的时机不是「收到 tool/result」而是「收到结算通知」：后台派发时结果只是一行
      // `started subagent <id>`，子 agent 那时还在跑（见 core-seams.md §8.7）。
      const live = report === undefined && card.status !== 'failed' && card.status !== 'cancelled'
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, live)
      const statusText2 = card.status === 'started' ? t('flow.status.started') : commandStatusText(t, card.status)
      const body = []
      if (card.prompt !== '') body.push(h(ClampedPre, { key: 'prompt', text: card.prompt, t }))
      if (report === undefined) {
        body.push(h('div', { key: 'await', className: 'dcf-note' }, t('flow.card.awaitReport')))
      } else {
        if (report.summary !== '') body.push(h('div', { key: 'summary', className: 'dcf-note' }, report.summary))
        if (report.text !== '') {
          const reportText = clampText(report.text)
          body.push(h('div', { key: 'report', className: 'dcf-text' }, h(MarkdownText, { text: reportText.text, labels: card.markdownLabels })))
          body.push(h(TruncationNote, { key: 'report-note', clamped: reportText, t }))
        }
      }
      // 子代理过程：卡片展开时才读子会话（`active` 就是卡片自己的展开态）。
      body.push(h(SubagentProcess, { key: 'process', card, t, sessionId, keyPrefix, active: open }))
      return h(
        Card,
        {
          kind: 'subagent',
          title: t('flow.card.subagent'),
          summary: card.summary === '' ? card.prompt.split('\n', 1)[0] : card.summary,
          chips: [h(StatusChip, { key: 'status', tone: toneOfStatus(card.status), text: statusText2 })],
          live,
          open,
          onToggle: toggle,
        },
        body,
      )
    }

    /** 兜底卡：没有专属卡片的工具（只读内置、未知插件工具）——一行标题 + 摘要，展开是入参与结果。 */
    function PlainCard({ card, t, sessionId, keyPrefix }) {
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:card`, false)
      return h(
        Card,
        {
          kind: 'plain',
          title: card.name,
          summary: card.summary,
          chips: card.status === 'failed'
            ? [h(StatusChip, { key: 'status', tone: 'err', text: t('flow.status.failed') })]
            : [],
          live: card.status === 'running',
          open,
          onToggle: toggle,
        },
        h(JsonBlock, { label: t('flow.card.input'), payload: card.args }),
        card.output === '' ? null : h(JsonBlock, { label: t('flow.card.output'), payload: card.output }),
      )
    }

    /** 按卡片类型分派。所有展开态用同一个 `keyPrefix` 作为持久化键前缀（= 节点 key）。 */
    function ToolCard({ card, t, sessionId, labels, keyPrefix }) {
      const shared = { card: { ...card, markdownLabels: labels }, t, sessionId, keyPrefix }
      if (card.kind === 'command') return h(CommandCard, shared)
      if (card.kind === 'file') return h(FileCard, shared)
      if (card.kind === 'mcp') return h(McpCard, shared)
      if (card.kind === 'question') return h(QuestionCard, shared)
      if (card.kind === 'subagent') return h(SubagentCard, shared)
      return h(PlainCard, shared)
    }

    /** 「思考」行：默认折叠，展开后是原始推理文本。 */
    function ThinkingEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `think:${entry.key}`, false)
      const clamped = clampText(entry.text)
      const lines = clamped.text.split('\n').length
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.category.thinking'),
          trailing: h('span', { className: 'dcf-badge' }, String(lines)),
        },
        h('pre', { className: 'dcf-pre' }, clamped.text),
        h(TruncationNote, { clamped, t }),
      )
    }

    /** 「思考」块里的一行非工具过程（斜杠命令、上下文压缩、重试…）：只显示标题。 */
    function ProcessRowEntry({ entry, t }) {
      return h(DisclosureLine, {
        open: false,
        leading: h('span', { className: 'dcf-chev' }),
        title: t(entry.titleKey),
      })
    }

    /**
     * 「上下文注入」折叠点：把这一段的多次注入**合并**在一个折叠点里（用户要求）。
     *
     * 折叠时只显示段数，展开后逐段显示注入正文（原文保留换行）。
     */
    function ContextEntry({ entry, t, sessionId }) {
      const [open, toggle] = useCollapse(sessionId, `ctx:${entry.key}`, false)
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t(entry.titleKey),
          trailing: h('span', { className: 'dcf-badge' }, t('flow.context.count', { count: entry.items.length })),
        },
        entry.items.map((item) => h(ClampedPre, { key: item.key, text: item.text, t })),
      )
    }
    /* ──────────────────────────── 原生节点座位 ──────────────────────────── */

    /**
     * 核心的**对话节点插槽**：本视图的每一行内容都从这里渲染。
     *
     * 用户要求「命令运行、工具调用、思考的展示方式都用原生的 DSH 的，自己只处理节点之间的层级关系」。
     * 这个槽就是核心的叶子渲染面：17 个 kind 全部有原生条目——14 个在 `dsh-client-ui-chat`
     * （`user` / `steering` / `context` / `system-prompt` / `assistant-step` / `command` /
     * `manual-compaction` / `compaction` / `model-retry` / `turn-error` / `turn-max-tokens` /
     * `turn-process` / `turn-tail` / `unknown`），另有 `tool-call`（ui-tool，内部再按工具名分派到
     * 命令卡 / 差异块 / 读取块 / 搜索块 / 提问卡…）、`command-input`（ui-goal）、
     * `workflow-run`（ui-workflow-run）。事实与行号见 `docs/references/core-seams.md` §13。
     */
    const NATIVE_NODE_SLOT = 'conversation.chat.node'

    /** 消息图片插槽：原生用户/助手座位经它渲染附件（ui-attachment 注册的条目）。 */
    const NATIVE_IMAGES_SLOT = 'conversation.message.images'

    /** 本插件自己的会话作用域子槽：只为让渲染器给本条目 `renderSlot` 与 `SessionProvider`。 */
    const OWN_SEAT_SLOT = 'chat-flow.seat'

    /**
     * ⚠️ **本视图自己接管的合成节点**（不交给原生座位）定义在派生层：`20-derive.js` 的
     * `OWNED_NODE_KINDS`——那里同时说明为什么 `turn-tail` 必须交给核心而不是自己画。
     * 放在派生层是因为「哪些节点属于本插件」是**模型层的事实**：座位筛选（`seatNodesOf`）
     * 与「空块」判定（`isBlankNode`）都从同一处读，避免两份名单走偏。
     */

    /**
     * 本条目声明的子槽表。
     *
     * ⚠️ **这里有一个刻意的技巧，依据是核心源码而不是猜测**：`register()` 的子槽冲突检查只枚举
     * **自有可枚举**键（`dsh-client-ui-slots/lib/index.js:100` 的 `Object.keys(options.children)`），
     * 而 `renderSlot` 的所有权检查只做属性读取（`dsh-client-ui-renderer/lib/client.js:285`
     * 的 `entry.children?.[key]`）。核心 ui-chat 的视图条目**已经声明**了
     * `conversation.chat.node` 与 `conversation.message.images`，直接写进 children 会抛
     * 「slot is already declared」。把这两个核心子槽挂成**不可枚举属性**：冲突检查看不到它们，
     * 所有权检查读得到它们，于是本条目获得 `renderSlot` 的授权，却既不去声明、也永远不会
     * 在释放时连带把别人的子槽收掉（`releaseEntry` 同样只枚举自有可枚举键，见 §13）。
     *
     * `chat-flow.seat` 是本插件**自己**的会话作用域子槽（空实现）：条目一旦声明了 children，
     * 渲染器才会把 `renderSlot` 放进 kit；其中有会话作用域子槽时才会给 `SessionProvider`。
     *
     * @returns children 表。
     */
    function nativeViewChildren() {
      const children = {}
      children[OWN_SEAT_SLOT] = { kind: 'single', scope: 'session' }
      const coreSlots = [
        [NATIVE_NODE_SLOT, { kind: 'keyed', scope: 'session' }],
        [NATIVE_IMAGES_SLOT, { kind: 'single', scope: 'session' }],
      ]
      for (const [key, spec] of coreSlots) {
        Object.defineProperty(children, key, {
          value: spec,
          enumerable: false,
          writable: false,
          configurable: true,
        })
      }
      return children
    }

    /**
     * 节点所在回合的**数据存储**，作为插槽的 `hookContext` 传下去。
     *
     * 与核心 `turnDataOf`（`dsh-client-ui-chat/lib/client.js:1467-1470`）逐字同义：
     * 只有 `location.kind` 是 `turn` / `step` 时才有；`unresolved` 或没有 location 时是 `undefined`。
     * 这个值必须**每次渲染都传**（哪怕是 `undefined`），因为该槽子规格上挂着上下文 hook 工厂
     * （`CHAT_NODE_INJECT`，见 §13）；渲染器发现「有上下文 hook 却没给 hookContext」会直接抛
     * `SlotAssemblyError`（`dsh-client-ui-renderer/lib/client.js:635`）。
     *
     * @param node - 对话节点。
     * @returns 回合数据存储，或 `undefined`。
     */
    function turnDataOfNode(node) {
      const location = node?.location
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.data : undefined
    }

    /** 节点所在回合号（原生座位没有这个属性，本视图用它输出核心同款的 `data-chat-turn`）。 */
    function turnOfChatNode(node) {
      const location = node?.location
      return location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
    }

    /**
     * 原生座位外层的错误边界。
     *
     * **为什么必须有**：本视图把整块界面交给别人的组件渲染，任何一次原生渲染抛错都会顺着
     * React 冒泡到插槽条目的错误边界，条目被判「让位」（abdicate）——整块对话区变成
     * `data-slot-error`，代价远大于少渲染一行。这里把失败收敛在**单个节点**的范围内：
     * 那一行退化成自绘叶子，其余行照常。
     */
    class NativeLeafBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        // 显式报错而不是静默吞掉：真机出问题时这条日志是唯一的线索。
        console.warn('[chat-flow] 原生节点座位渲染失败，该行改用自绘叶子：', error)
      }

      render() {
        return this.state.failed === true ? (this.props.fallback ?? null) : this.props.children
      }
    }

    /**
     * 真正调用插槽的那一层（抛错发生在它的渲染里，因此被外层边界接住）。
     *
     * `fallback` 同时交给核心：某个 kind 没有任何条目时，插槽自己会渲染它
     * （`dsh-client-ui-renderer/lib/client.js:828`），所以「核心没装 ui-tool」这类情况
     * 也会退化成自绘卡片，而不是留一片空白。
     */
    function NativeSeatInner({ node, owner, renderSlot, fallback }) {
      return renderSlot(
        NATIVE_NODE_SLOT,
        { ...owner, node },
        {
          entryKey: typeof node?.kind === 'string' ? node.kind : 'unknown',
          hookContext: turnDataOfNode(node),
          fallback,
        },
      )
    }

    /**
     * 一个节点的原生座位。
     *
     * @param props - `node`、`owner`（原生座位需要的主人参数）、`renderSlot`、`fallback`。
     * @returns 座位；`renderSlot` 不可用（例如装配里没有 ui-chat）时直接给回退叶子。
     */
    function NativeSeat({ node, owner, renderSlot, fallback }) {
      const safeFallback = fallback ?? null
      if (typeof renderSlot !== 'function') return safeFallback
      return h(
        NativeLeafBoundary,
        { fallback: safeFallback },
        h(NativeSeatInner, { node, owner, renderSlot, fallback: safeFallback }),
      )
    }

    /**
     * 自绘叶子：原生座位不可用时的退路，复用本插件原有的卡片层。
     *
     * @param props - `node`、`row`（{@link nodeRowOf} 的结果）、`t`、`sessionId`、`labels`。
     * @returns 叶子；该节点没有可渲染模型时返回 `null`。
     */
    function ChatFlowLeaf({ node, row, t, sessionId, labels }) {
      if (row === null || row === undefined) return null
      if (row.kind === 'tool') {
        return h(ToolCard, { card: row.card, t, sessionId, labels, keyPrefix: `n:${row.key}` })
      }
      if (row.kind === 'thinking') return h(ThinkingEntry, { entry: row, t, sessionId })
      if (row.kind === 'row') return h(ProcessRowEntry, { entry: row, t })
      if (row.kind === 'message') {
        return h(UserBubble, { text: row.text, nodeKey: node?.key, kind: node?.kind, t })
      }
      if (row.kind === 'assistant') return h(AssistantText, { text: row.text, labels, t })
      return h(ClampedPre, { text: row.text, t })
    }

    /**
     * 一行节点：**原生座位优先、自绘叶子兜底**，并补上核心的 DOM 约定属性。
     *
     * `data-chat-anchor-key` / `data-chat-flow-kind` / `data-chat-flow-key` / `data-chat-turn`
     * 是核心 `ChatNodeSeat` 外层容器（`dsh-client-ui-chat/lib/client.js:1535-1544`）输出的属性，
     * 别人的插件按它们找座位——例如回退插件用
     * `[data-chat-flow-kind="user"][data-chat-anchor-key]` 定位用户发言，再往行内的按钮容器里
     * 挂一个「还原到此处」按钮（`dsh-rewind-plugin/lib/client.js:1111-1123`）。
     *
     * @param props - `node`、`row`、`seat`（`{owner, renderSlot}`）、`t`、`sessionId`、`labels`、`marker`（可选的状态标记文字）。
     * @returns 行。
     */
    function NativeNodeRow({ node, row, seat, t, sessionId, labels, marker }) {
      const fallback = h(ChatFlowLeaf, { node, row, t, sessionId, labels })
      const attributes = {
        className: marker === null || marker === undefined ? 'dcf-leaf' : 'dcf-leaf dcf-leaf-marked',
        'data-chat-flow-kind': node.kind,
        'data-chat-flow-key': node.key,
        'data-chat-anchor-key': node.key,
      }
      const turn = turnOfChatNode(node)
      if (turn !== undefined) attributes['data-chat-turn'] = String(turn)
      const content = [
        h(NativeSeat, {
          key: 'seat',
          node,
          owner: seat?.owner,
          renderSlot: seat?.renderSlot,
          fallback,
        }),
      ]
      // 状态标记（目前只有插队消息用）：挂在行首，说明「这条消息是怎么进来的」。
      if (marker !== null && marker !== undefined) {
        content.unshift(h('span', { key: 'marker', className: 'dcf-chip dcf-leafmarker', 'data-tone': 'warn' }, marker))
      }
      return h('div', attributes, content)
    }

    /** 一批节点的回退模型（按节点 key 索引）；空结果不建 Map，避免每行都白查一次。 */
    function rowModelsOf(nodes, subagents) {
      const models = new Map()
      for (const node of nodes) {
        const row = nodeRowOf(node, subagents)
        if (row !== null) models.set(node.key, row)
      }
      return models
    }

    /**
     * 会话相对路径 → 主机可用的绝对路径。
     *
     * 与核心的 `resolveWorkspacePath`（`@deepseek-ai/dsh-util-workspace-path/lib/index.js:16-20`）
     * 同义：`/` 开头与 Windows 盘符/UNC 前缀视为绝对路径，其余拼到会话 cwd 下。
     * 那个助手是包内私有导出、不在平台 seed 模块表里，所以这里自己实现同义逻辑。
     *
     * @param cwd - 会话工作区根。
     * @param path - 绝对或用例相对路径。
     * @returns 绝对路径；cwd 未知时原样返回。
     */
    function resolveSeatPath(cwd, path) {
      if (typeof path !== 'string' || path === '') return path
      if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')) return path
      if (typeof cwd !== 'string' || cwd === '') return path
      return `${cwd.replace(/[/\\]+$/, '')}/${path.replace(/^[/\\]+/, '')}`
    }

    /**
     * 原生叶子需要的**注入面**：核心 ui-chat 在它自己的视图条目里提供的同款能力
     * （`dsh-client-ui-chat/lib/client.js:8108-8151`），本视图必须自己造一份。
     *
     * 可选服务一律用 `ctx.get(name)` 取，**不写进 `inject` 列表**：cordis 的 `inject` 是强依赖，
     * 服务缺席会让整个插件干脆不装配（对话区连任务视图都不会出现）；而 `ctx.get` 缺席只返回
     * `undefined`，能力降级、视图照常。核心自己也用 `ctx.get('chatFileMentions')`（`ui-chat:8123`）。
     *
     * @param ctx - 客户端插件上下文。
     * @param sessionId - 本条目所属会话。
     * @returns 注入面。
     */
    function nativeSeatFace(ctx, sessionId) {
      const optional = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
      const uiConversation = optional('uiConversation')
      const remote = optional('remote')
      return {
        /** 按会话 cwd 打开文件（原生叶子里点文件名会走到这里）。 */
        openFile: async (path) => {
          if (remote?.session === undefined) throw new Error('chat-flow: remote.session 不可用，无法打开路径')
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          const result = await remote.session.openWorkspacePath({ path: resolveSeatPath(cwd, path) })
          if (result.ok !== true) throw new Error(`chat-flow: 打开路径失败（${result.error?.message ?? '未知原因'}）`)
        },
        /** 附件图片 URL；核心在同一个位置提供同名的 `{peek}` 挂件（`ui-chat:8133`）。 */
        loadImage:
          uiConversation === undefined
            ? undefined
            : Object.assign((attachment) => uiConversation.imageUrl(sessionId, attachment), {
                peek: (attachment) => uiConversation.peekImageUrl(sessionId, attachment),
              }),
        /** 助手消息里的文件引用；服务缺席时给 `undefined`，原生叶子会跳过提及渲染（`ui-chat:8123`）。 */
        fileMentions: (owner) => {
          const service = optional('chatFileMentions')
          return typeof service?.forClosing === 'function' ? service.forClosing(owner) : undefined
        },
        /** 从某个 seq 分叉出新会话（回合尾部的分支按钮用，`ui-chat:8141-8149`）。 */
        forkAt: (seq) => {
          const sessions = ctx.sessions
          if (typeof sessions?.fork !== 'function') return
          sessions.fork({ sessionId, atSeq: seq, increaseTitle: true }).then(
            (childId) => sessions.open(childId),
            // 分叉失败（会话已被释放等）不该打断阅读：显式忽略，不写空 catch。
            () => undefined,
          )
        },
      }
    }

    /** 要渲染的节点：剔除本视图自己接管的合成节点（见 {@link OWNED_NODE_KINDS}）。 */
    function seatNodesOf(nodes) {
      return nodes.filter((node) => node !== null && node !== undefined && !OWNED_NODE_KINDS.has(node.kind))
    }

    /**
     * 「上下文注入」折叠点：一段里的多次注入**合并进同一个折叠点**（用户要求）。
     *
     * 折叠态只显示注入段数，展开后每一段仍是**原生座位**（核心的 `context` 条目带来源与形态标签），
     * 只是被收进了同一个折叠容器里——层级由本插件给，内容仍由核心画。
     *
     * @param props - `nodes`（该段全部 context 节点）、`models`、`t`、`sessionId`、`seat`、`labels`。
     * @returns 折叠点。
     */
    function ContextFold({ nodes, models, t, sessionId, seat, labels }) {
      const [open, toggle] = useCollapse(sessionId, `ctx:${nodes[0].key}`, false)
      return h(
        DisclosureLine,
        {
          open,
          onToggle: toggle,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.row.context'),
          trailing: h('span', { className: 'dcf-badge' }, t('flow.context.count', { count: nodes.length })),
        },
        nodes.map((node) =>
          h(NativeNodeRow, {
            key: node.key,
            node,
            row: models.get(node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        ),
      )
    }
    /* ────────────────────── 子代理过程（内联读子会话） ────────────────────── */

    /**
     * 子代理席位的 React 上下文。
     *
     * 子代理卡坐在很深的一层（`FlowBody → TurnGroup → NodeSequence → NativeNodeRow →
     * ChatFlowLeaf → ToolCard → SubagentCard`），把「读子会话」的能力逐层透传要动 5 处签名；
     * 改成上下文后，视图顶层（`TaskFlowView`）注入一次就够。
     *
     * `null` = 本视图拿不到子代理席位（宿主没装 ui-session / ui-conversation，或取不到会话
     * binding），此时子代理卡退回「只显示报告」的老行为，一个空壳都不多画。
     * 子代理过程内部也把它显式压成 `null`：子会话里的子代理卡只显示报告，不做无限递归。
     */
    const SubagentSeatContext = react.createContext(null)

    /** 未展开时的稳定空状态（`useState` 的初值必须是同一个引用，否则每次渲染都换对象）。 */
    const SUBAGENT_CHAT_IDLE = Object.freeze({ phase: 'idle' })

    /** 子代理过程最多画多少步：超出时从最近一步往前截，徽标仍显示真实总步数。 */
    const MAX_SUBAGENT_ROWS = 120

    /** 子代理下拉树最多列多少行（超出截断；正常会话远小于这个数）。 */
    const MAX_SUBAGENT_TREE_ROWS = 60

    /** 子代理树最多画几层（子代理还能再派子代理，但层数必须有底）：depth 从 0 起算，共 4 层。 */
    const MAX_SUBAGENT_TREE_DEPTH = 4

    /**
     * 子代理席位：把「某个子会话自己的对话快照」读给父会话里的卡片用。
     *
     * **为什么能这么读**（核心侧的依据见 `.agents/docs/references/core-seams.md` §16）：
     * - 父会话的节点树里**没有**子会话的内部步骤——子会话是独立会话，派发工具的结果只有
     *   一行 `started subagent <uuid>`，之后父流里只剩一条 `subagent-settled` 通知。
     *   所以「像 TRAE 一样看见子代理在干什么」只能读**子会话自己的事件流**；
     * - **必须先 retain**：平台的 binding 只存在于 retain 过的 scope 上（`sessions.binding(id)`
     *   读 `scopes.get(id)?.binding`，scopes 由 `retainScope`/`materializeScope` 写入），所以
     *   `sessions.retain(address, {source})` 是这条链路的入口；`reference.ready` 落地后
     *   `binding` 才有值。reference 由本文件按 watcher 引用计数保活，最后一个 watcher 退订时
     *   `release()`，不把子会话永久钉在内存里；
     * - `ctx.sessions.binding(childId)` 给的是子会话的 binding，其 `eventSource` 就是子会话
     *   的事件源；`uiConversation.binding(childId).target('chat')` 把它解成
     *   `{getSnapshot, subscribe}`，形状与本视图的 `useChat` 完全一致——派生与渲染都能原样复用；
     * - **不会切换舞台**：`sessions.open(id)` / `uiWorkspace.openSession(target)` 会把 stage 切到
     *   子会话（`manager.select` 里 `this.selected = childSessionId`），这里绕开它们，只走
     *   `retain` + `configureSubagent(address)` + `session.open()`——窗口打开 ⟺ 事件在流里，
     *   与「当前看的是谁」无关；
     * - 地址（`{parentSessionId, childSessionId, mode}`）来自平台记账：`sessions.subagentAddress(
     *   childId)` 先查本地地址表再查会话投影 `subagentCatalog`；`retain` 接受地址对象并把地址
     *   记进本地表，所以「父会话 + 子会话」这个最小地址也够用。目录水合入口是
     *   `sessions.refreshProjections(parent)`（子代理目录就是会话投影之一）。
     *
     * 拿不到任何一环就**如实降级**：面板显示一句说明，并留「打开子会话」按钮走核心自己的
     * `ctx.uiWorkspace.openSession(target)`（那条路一定会切舞台，但至少用户点得到）。
     *
     * @param ctx - 客户端插件上下文（`ctx.sessions` 必在；`uiConversation` / `uiWorkspace` 用
     *   `ctx.get()` 取，缺席是正常装配）。
     * @param sessionId - 当前视图的会话 id（= 子代理的父会话）。
     * @returns 子代理席位；`ctx.sessions` 不可用时返回空对象（视图照常渲染，只是没有过程面板）。
     */
    function subagentSeatFace(ctx, sessionId) {
      const sessions = ctx.sessions
      if (sessions === undefined || sessions === null || typeof sessions.binding !== 'function') return {}

      /** 可选服务一律 `ctx.get()`：缺席不阻塞本插件，也不写进 `inject`。 */
      const serviceOf = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)

      /**
       * 本会话子代理目录的条目。
       *
       * 权威来源是**会话投影** `subagentsByParent`→`subagentCatalog`：平台把目录做成会话投影
       * （`dsh-subagent/lib/index.js` 的投影键 `subagentCatalog`），客户端读
       * `sessions.list` 快照的 `projectionsBySession[sessionId].values.subagentCatalog`。
       * 条目形状是 `{id, createdAt, mode, label?}`——**没有 `kind` 字段**，所以这里不筛 `kind`。
       *
       * @param snapshot - 可选的会话列表快照（省一次 `getSnapshot`）。
       * @returns 条目数组；读不到时为空数组。
       */
      function catalogEntriesOf(snapshot) {
        const list =
          snapshot ?? (typeof sessions.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined)
        const projected = list?.projectionsBySession?.[sessionId]?.values?.subagentCatalog
        if (Array.isArray(projected)) return projected
        // 兼容更早的字段形状（历史版本塞在 list 快照顶层）；两个都没有就是空目录。
        const legacy = list?.subagentsByParent?.[sessionId]?.entries
        return Array.isArray(legacy) ? legacy : []
      }

      /** 目录里这个子会话的地址（`subagentAddress` 没记过时的来源）。 */
      function catalogAddressOf(childId) {
        const entry = catalogEntriesOf().find((candidate) => candidate?.id === childId)
        if (entry === undefined) return undefined
        return {
          parentSessionId: sessionId,
          childSessionId: childId,
          ...(typeof entry.mode === 'string' ? { mode: entry.mode } : {}),
        }
      }

      /**
       * 子会话的地址：平台的 `sessions.subagentAddress` 是权威来源（retain 过、或目录里已有），
       * 拿不到就退到目录条目，再退到「父会话 + 子会话」这个最小地址——`sessions.retain` 接受
       * 地址对象并把 `{parentSessionId, childSessionId, mode?}` 记进本地地址表。
       */
      function addressOf(childId) {
        const direct = typeof sessions.subagentAddress === 'function' ? sessions.subagentAddress(childId) : undefined
        if (direct !== undefined && direct !== null) return direct
        return catalogAddressOf(childId) ?? { parentSessionId: sessionId, childSessionId: childId }
      }

      /**
       * 子会话的 chat 源：`uiConversation.binding(childId).target('chat')`。
       *
       * 它要求该会话**已被 retain**（`uiConversation.binding` 内部断言
       * `this.sessions.binding(sessionId) === owner`，未保活时抛 `unknown session`），
       * 所以调用方必须先 `await ensureRetained(childId)`。
       */
      function chatOf(childId) {
        const conversation = serviceOf('uiConversation')
        if (conversation === undefined || typeof conversation.binding !== 'function') return undefined
        try {
          const target = conversation.binding(childId).target('chat')
          if (target !== undefined && target !== null && typeof target.getSnapshot === 'function') return target
        } catch {
          // 未保活/未登记的会话：核心的 `binding()` 会抛（`uiConversation.binding: unknown session …`），
          // 这里按「读不到」处理，让调用方走降级分支。
        }
        return undefined
      }

      /**
       * 拉一次本会话的会话投影（子代理目录就是投影之一）。
       *
       * 真 API 是 `sessions.refreshProjections(sessionId)`（“Load all Session projections once
       * per connection; retry an unsuccessful initial read”）；核心自己的目录 UI 也用它。
       * 幂等、失败只留痕：拉不动时地址可能已经在本地记账里（用户刚在头部目录里点过）。
       */
      function refreshCatalog() {
        if (typeof sessions.refreshProjections !== 'function') return
        try {
          const task = sessions.refreshProjections(sessionId)
          if (task !== undefined && task !== null && typeof task.catch === 'function') {
            task.catch((error) => {
              console.warn('[chat-flow] 拉取子代理目录失败：', error)
            })
          }
        } catch (error) {
          console.warn('[chat-flow] 拉取子代理目录失败：', error)
        }
      }

      /**
       * 保活记账：`retain` 的 reference 活到该 childId 的最后一个 watcher 退订为止。
       *
       * 平台的 binding **只在 retain 过的 scope 上存在**，所以「内联读子会话」必须先 retain；
       * 反之，永久 retain 会把每个看过一眼的子会话钉在内存里，因此按 watcher 引用计数释放。
       */
      const leases = new Map()

      function leaseOf(childId) {
        let lease = leases.get(childId)
        if (lease === undefined) {
          lease = { watchers: 0, reference: null, opening: null }
          leases.set(childId, lease)
        }
        return lease
      }

      /**
       * 保活一个子会话（幂等）。
       *
       * 成功才缓存；失败**不缓存**——目录或子会话可能随后才水合，而「第一次没读到就永久不可用」
       * 正是这条链路以前最大的坑。
       *
       * @param childId - 子会话 id。
       * @returns `'ready' | 'unlisted' | 'error'`。
       */
      function ensureRetained(childId) {
        const lease = leaseOf(childId)
        if (lease.reference !== null) return Promise.resolve('ready')
        if (lease.opening !== null) return lease.opening
        lease.opening = (async () => {
          if (typeof sessions.retain !== 'function') return 'no-retain'
          const reference = sessions.retain(addressOf(childId), { source: 'chatFlow' })
          lease.reference = reference ?? null
          if (reference !== null && reference !== undefined && reference.ready !== undefined) {
            await reference.ready
          }
          return 'ready'
        })().catch((error) => {
          console.warn('[chat-flow] 保活子会话失败：', error)
          lease.opening = null
          lease.reference = null
          return 'error'
        })
        return lease.opening
      }

      /** 释放一次保活；引用计数归零时真的 `release()`。 */
      function releaseLease(childId) {
        const lease = leases.get(childId)
        if (lease === undefined) return
        lease.watchers -= 1
        if (lease.watchers > 0) return
        leases.delete(childId)
        const reference = lease.reference
        if (reference !== null && reference !== undefined && typeof reference.release === 'function') {
          try {
            reference.release()
          } catch (error) {
            console.warn('[chat-flow] 释放子会话保活失败：', error)
          }
        }
      }

      /**
       * 打开子会话的窗口（幂等）。返回 `'ready' | 'unlisted' | 'error'`。
       *
       * 同一张卡在会话里可能反复挂载/卸载（切视图、翻页重组），所以**成功**结果按 childId 缓存；
       * 目录只拉一次。失败不留在缓存里，下一次展开会重试。
       */
      const opened = new Map()
      let catalogTouched = false
      function ensureOpen(childId) {
        const pending = opened.get(childId)
        if (pending !== undefined) return pending
        const task = (async () => {
          if (catalogTouched !== true) {
            catalogTouched = true
            refreshCatalog()
          }
          const status = await ensureRetained(childId)
          if (status !== 'ready') return status === 'no-retain' ? 'unlisted' : status
          const binding = sessions.binding(childId)
          if (binding === undefined) return 'unlisted'
          const address = addressOf(childId)
          if (address !== undefined && typeof binding.session?.configureSubagent === 'function') {
            binding.session.configureSubagent(address, true)
          }
          await binding.session?.open?.()
          return 'ready'
        })().catch((error) => {
          console.warn('[chat-flow] 打开子会话窗口失败：', error)
          return 'error'
        })
        opened.set(childId, task)
        void task.then((status) => {
          if (status !== 'ready') opened.delete(childId)
        })
        return task
      }

      return {
        /**
         * 订阅一个子会话的对话快照，返回退订函数。
         *
         * 监听器收到 `{phase}`：
         * - `'loading'` —— 正在拉目录 / 开窗口；
         * - `'ready'` —— 带 `snapshot`（形状同 `useChat` 的快照）；
         * - `'unavailable'` —— 带 `reason`（`'unlisted' | 'no-chat' | 'error'`），面板据此降级。
         *
         * @param childId - 子会话 id。
         * @param listener - 状态回调。
         * @returns 退订函数。
         */
        watch(childId, listener) {
          // 每个 watcher 持有一份保活；最后一个退订时才 `release()`。
          leaseOf(childId).watchers += 1
          let cancelled = false
          let unsubscribe = null
          const emit = () => {
            const chat = chatOf(childId)
            if (chat === undefined) {
              listener({ phase: 'unavailable', reason: 'no-chat' })
              return
            }
            listener({ phase: 'ready', snapshot: chat.getSnapshot() })
          }
          listener({ phase: 'loading' })
          void (async () => {
            const status = await ensureOpen(childId)
            if (cancelled) return
            if (status !== 'ready') {
              listener({ phase: 'unavailable', reason: status })
              return
            }
            const chat = chatOf(childId)
            if (chat === undefined) {
              listener({ phase: 'unavailable', reason: 'no-chat' })
              return
            }
            // 订阅本身会 `activate('chat')`（核心在 subscribe 里激活目标），所以先订阅再取快照。
            unsubscribe = typeof chat.subscribe === 'function' ? chat.subscribe(emit) : null
            emit()
          })()
          return () => {
            if (cancelled) return
            cancelled = true
            if (typeof unsubscribe === 'function') unsubscribe()
            releaseLease(childId)
          }
        },

        /**
         * 跳到子会话（降级按钮）：走核心的 `uiWorkspace.openSession(target)`——平台自己的
         * 目录行/侧栏跳转用的就是它，这条路会切舞台，只在用户明确点击时走。
         */
        openSubagent(childId) {
          const workspace = serviceOf('uiWorkspace')
          if (workspace === undefined || typeof workspace.openSession !== 'function') return false
          try {
            workspace.openSession(addressOf(childId))
            return true
          } catch (error) {
            console.warn('[chat-flow] 打开子会话失败：', error)
            return false
          }
        },

        /**
         * 读一次「子代理目录」的原始材料：会话列表快照 + 本会话的目录条目。
         *
         * 两样都要：列表快照（`byId` 里有全机的 `parentId` 链与 `running`）负责**树形结构与实时运行态**，
         * 目录条目负责**标签与模式（一次性/可续）**（目录是按需拉的，可能还没水合）。
         *
         * @returns `{list, catalog}`；读不到时字段为空。
         */
        catalog() {
          const snapshot =
            typeof sessions.list?.getSnapshot === 'function' ? sessions.list.getSnapshot() : undefined
          return { list: snapshot, catalog: { entries: catalogEntriesOf(snapshot) } }
        },

        /**
         * 订阅会话列表快照（子代理新增/运行态变化都会推）。返回退订函数。
         *
         * @param listener - 变化回调。
         * @returns 退订函数；列表不可订阅时返回空函数。
         */
        subscribeCatalog(listener) {
          if (typeof sessions.list?.subscribe !== 'function') return () => {}
          return sessions.list.subscribe(listener)
        },

        /**
         * 拉一次本会话的子代理目录（幂等、单飞由核心保证）。
         *
         * 只在**真的要看的时候**调：下拉菜单展开、或已经确认有子代理时。空会话不打扰宿主。
         */
        refreshCatalog,
      }
    }

    /**
     * 子代理过程要画的行种类——与 {@link subagentRowOf} 的分派**一一对应**。
     *
     * 用白名单而不是「排除法」：`nodeRowOf` 还会产出 `context`（上下文压缩/注入）与 `row`
     * （斜杠命令、重试这类过程标注），它们是**父会话**的过程注解，在子代理过程里是噪音；
     * 而且 `subagentRowOf` 对它们没有分派，放行就会画出空叶子。
     */
    const SUBAGENT_ROW_KINDS = Object.freeze(['tool', 'thinking', 'assistant', 'message'])

    /**
     * 子代理过程的行模型：把子会话的快照拍平成「步骤行」。
     *
     * 复用单节点回退模型 {@link nodeRowOf}（它天然逐节点独立、不做跨节点合并），只做两件事：
     * - 保留 {@link SUBAGENT_ROW_KINDS} 列出的四种行；
     * - 顶层节点里只留用户发言（子会话的输入是什么），不画父视图那套分段头。
     *
     * @param snapshot - 子会话的 chat 快照（`{order, nodes}`）。
     * @returns 行数组（呈现序；每项带 `key` 与 `kind`）。
     */
    function subagentRowsOf(snapshot) {
      const nodes = orderedNodes(snapshot)
      if (nodes.length === 0) return []
      const subagents = collectSubagentContext(nodes)
      const rows = []
      for (const node of nodes) {
        const row = nodeRowOf(node, subagents)
        if (row === null || row === undefined) continue
        if (!SUBAGENT_ROW_KINDS.includes(row.kind)) continue
        // 顶层节点里只有用户发言/引导消息值得显示（子会话的输入是什么）。
        if (isTopLevelNode(node) && row.kind !== 'message') continue
        rows.push(row)
      }
      return rows
    }

    /**
     * 按「展开时才开始读」的方式订阅一个子会话。
     *
     * `seat` 或 `childId` 为空时**不订阅**（面板收起、卡片收起、或席位缺席），
     * 这样一张没展开的卡不会白白拉一个子会话的历史窗口。
     *
     * @param seat - {@link subagentSeatFace} 的产物，或 `null`。
     * @param childId - 子会话 id；空串表示不读。
     * @returns `{phase, snapshot?, reason?}`。
     */
    function useSubagentChat(seat, childId) {
      const [state, setState] = useState(SUBAGENT_CHAT_IDLE)
      useEffect(() => {
        if (seat === null || seat === undefined || childId === '') return undefined
        let alive = true
        const unsubscribe = seat.watch(childId, (next) => {
          if (alive) setState(next)
        })
        return () => {
          alive = false
          if (typeof unsubscribe === 'function') unsubscribe()
        }
      }, [seat, childId])
      return state
    }

    /**
     * 「子代理过程」面板：子代理卡展开后，在报告下方内联列出子会话自己的步骤。
     *
     * 三条纪律：
     * - **只在展开时读**：`active`（卡片展开）与自身展开状态同时为真才调 `watch`；
     * - **拿不到就降级**：读不到快照时只显示一句说明 + 「打开子会话」按钮，绝不空转；
     * - **不递归**：面板内部把 {@link SubagentSeatContext} 压成 `null`，子会话里的子代理卡
     *   只显示报告（否则一层套一层，读窗口的数量会随深度指数增长）。
     *
     * @param props - `card`（子代理卡模型）、`t`、`sessionId`、`keyPrefix`、`active`（卡片是否展开）、
     *   `seat`（可选：显式席位，**测试接缝**；不传才走 context）。
     * @returns 过程面板；席位缺席或没有 childId 时返回 `null`。
     */
    function SubagentProcess({ card, t, sessionId, keyPrefix, active, seat: seatProp }) {
      /* 测试替身的手写 React 只有默认值语义（见 test/helpers/load-bundle.mjs 的 createContext），
         所以显式 `seat` 是对面板单独做用例的唯一入口。 */
      const seat = seatProp !== undefined ? seatProp : react.useContext(SubagentSeatContext)
      const childId = typeof card.childId === 'string' ? card.childId : ''
      const usable = childId !== '' && seat !== null && seat !== undefined && typeof seat.watch === 'function'
      const [open, toggle] = useCollapse(sessionId, `${keyPrefix}:process`, active === true)
      const reading = usable && active === true && open === true
      const state = useSubagentChat(reading ? seat : null, reading ? childId : '')
      const rows = useMemo(() => (state.phase === 'ready' ? subagentRowsOf(state.snapshot) : []), [state])
      if (!usable) return null
      const labels = card.markdownLabels
      const shown = rows.length > MAX_SUBAGENT_ROWS ? rows.slice(rows.length - MAX_SUBAGENT_ROWS) : rows
      let summary = ''
      if (state.phase === 'loading') summary = t('flow.subagent.loading')
      else if (state.phase === 'unavailable') summary = t('flow.subagent.unavailable')
      else if (state.phase === 'ready') summary = t('flow.subagent.steps', { count: rows.length })
      const body = []
      if (state.phase === 'ready') {
        if (rows.length === 0) body.push(h('div', { key: 'empty', className: 'dcf-note' }, t('flow.subagent.empty')))
        else {
          const list = []
          for (const row of shown) {
            list.push(h('div', { key: row.key, className: 'dcf-leaf' }, subagentRowOf(row, { t, sessionId: childId, labels, keyPrefix })))
          }
          body.push(
            h(
              'div',
              { key: 'list', className: 'dcf-subprocess' },
              shown.length < rows.length
                ? h('div', { className: 'dcf-note' }, t('flow.subagent.truncated', { count: shown.length }))
                : null,
              list,
            ),
          )
        }
      }
      return h(
        'div',
        { className: 'dcf-subagent', 'data-dcf-subagent': 'true', 'data-phase': state.phase },
        h(
          DisclosureLine,
          {
            open,
            onToggle: toggle,
            title: t('flow.subagent.process'),
            summary,
            className: 'dcf-block',
          },
          // 子会话内部的子代理卡只显示报告：把席位显式压成 null。
          h(SubagentSeatContext.Provider, { value: null }, body),
        ),
        seat !== null && seat !== undefined && typeof seat.openSubagent === 'function'
          ? h(
              'button',
              {
                key: 'open',
                type: 'button',
                className: 'dcf-hint',
                'data-dcf-subagent-open': 'true',
                onClick: () => {
                  seat.openSubagent(childId)
                },
              },
              t('flow.subagent.open'),
            )
          : null,
      )
    }

    /**
     * 一行子代理步骤。工具卡 / 思考行 / 正文 / 用户发言各走各自的既有组件——
     * 子会话的节点形状与父会话一模一样，所以这里不需要第二套渲染。
     *
     * @param row - {@link subagentRowsOf} 的一行。
     * @param props - `t`、`sessionId`（传子会话 id：折叠键与父会话分开命名空间）、`labels`、`keyPrefix`。
     * @returns 行。
     */
    function subagentRowOf(row, { t, sessionId, labels, keyPrefix }) {
      if (row.kind === 'tool') {
        return h(ToolCard, { card: row.card, t, sessionId, labels, keyPrefix: `${keyPrefix}:${row.key}` })
      }
      if (row.kind === 'thinking') return h(ThinkingEntry, { entry: row, t, sessionId })
      if (row.kind === 'assistant') return h(AssistantText, { text: row.text, labels, t })
      if (row.kind === 'message') return h(UserBubble, { text: row.text, nodeKey: row.key, kind: 'user', t })
      return null
    }

    /* ─────────────────── 子代理下拉菜单（任务视图顶部） ─────────────────── */

    /**
     * 五态：三个是用户点名要的（工作中 / 失败 / 完成），另两个是**如实降级**必须留出来的——
     * 「已中断」（用户自己停的，不该说成失败）与「状态未知」（历史窗口里没有结算通知，不能猜）。
     */
    const SUBAGENT_STATES = Object.freeze(['running', 'done', 'failed', 'interrupted', 'unknown'])

    /** 状态图标（用户要求「每个子代理选项右端用图标显示工作状态」）。 */
    const SUBAGENT_STATE_GLYPH = Object.freeze({
      running: '●',
      done: '✓',
      failed: '✕',
      interrupted: '⊘',
      unknown: '○',
    })

    /** 状态 → 色调：复用卡片那套颜色语义（`data-tone`，见 `50-nodes.js` 的 `toneOfStatus`）。 */
    const SUBAGENT_STATE_TONE = Object.freeze({
      running: 'live',
      done: 'ok',
      failed: 'err',
      interrupted: 'warn',
      unknown: 'muted',
    })

    /**
     * 状态 → 文案键。
     *
     * 写成显式映射而不是 `flow.agents.state.${state}`：字典测试（`test/client-locale.test.js`）
     * 会静态扫描「每个键都被引用」，模板串拼出来的键它扫不到，会当成死文案判红。
     */
    const SUBAGENT_STATE_LABEL = Object.freeze({
      running: 'flow.agents.state.running',
      done: 'flow.agents.state.done',
      failed: 'flow.agents.state.failed',
      interrupted: 'flow.agents.state.interrupted',
      unknown: 'flow.agents.state.unknown',
    })

    /** 结算通知文本 → 状态。文本来自宿主的 `settlementSummary`（英文，与界面语言无关）。 */
    const SUBAGENT_SETTLEMENT_PATTERNS = Object.freeze([
      ['failed', /failed before it finished|ended abnormally|declined the task|ran out of room/],
      ['interrupted', /was stopped before it finished/],
      ['done', /finished and will do no further work/],
    ])

    /**
     * 结算通知文本 → 五态之一。
     *
     * 唯一权威来源是宿主写给父会话的那条 `subagent-settled` 通知：
     * `dsh-subagent/lib/index.js:641-654` 的 `settlementSummary(childId, stopReason)` 按
     * `completed / aborted / max-tokens / refusal / error` 各给一句话。会话列表里**没有**任何失败字段
     * （`dsh-api-session-controller/lib/types/list.js` 只有 `running` / `blank` / `title` / `parentId` /
     * `origin` / `projectionValues`），所以「失败」只能从这句话读；认不出来的文本一律算「未知」，
     * 不猜——猜错比不显示更糟。
     *
     * @param text - 通知的 `summary` 或正文。
     * @returns 状态字符串。
     */
    function subagentStateOfSettlement(text) {
      if (typeof text !== 'string' || text === '') return 'unknown'
      for (const [state, pattern] of SUBAGENT_SETTLEMENT_PATTERNS) {
        if (pattern.test(text)) return state
      }
      return 'unknown'
    }

    /**
     * 一个子代理的地址缩写（拿不到标签时的兜底显示）。
     *
     * @param childId - 子会话 id。
     * @returns 前 8 位。
     */
    function shortChildId(childId) {
      return typeof childId === 'string' && childId.length > 8 ? childId.slice(0, 8) : String(childId ?? '')
    }

    /**
     * 子代理树（下拉菜单的行模型）——纯函数，不碰 React、不碰 ctx。
     *
     * 结构来源是**会话列表的 `parentId` 链**（`byId[id].parentId`），而不是目录条目：目录只给
     * 「本会话的直接子代理」，而子代理还能再派子代理；`byId` 里有全机的父子关系，可以一直往下走
     * （核心自己的下拉也是这么做的：`indexSubagentDescendants(summaries)`）。目录条目用来补齐
     * **标签、模式**与**诊断行**，列表里没有它们。
     *
     * 状态优先级（见 {@link subagentStateOfSettlement} 的说明）：
     * 1. 诊断行 → `failed`（子会话本身不健康，核心用 error 点表示）；
     * 2. 正在跑（`byId.running` 或目录 `activity:'running'`）→ `running`；
     * 3. 有结算通知 → 按通知文本判 `done` / `failed` / `interrupted`；
     * 4. 其余 → `unknown`（多半是历史窗口里没有那条通知，或目录还没水合）。
     *
     * @param parentSessionId - 父会话 id（= 本视图的会话）。
     * @param options - `{list, catalog, notices}`：会话列表快照、本会话目录、结算通知表
     *   （`Map<子会话 id, {summary, text}>`，由 `20-derive.js` 的 `collectSubagentNotices` 产出）。
     * @returns `{rows, total}`；`rows` 已按上限截断，`total` 就是列出的行数（上限就是上限，徽标不虚报）。
     */
    function subagentTreeOf(parentSessionId, options) {
      const list = options?.list
      const byId = list !== undefined && list !== null && typeof list.byId === 'object' && list.byId !== null ? list.byId : {}
      const entries = Array.isArray(options?.catalog?.entries) ? options.catalog.entries : []
      const notices = options?.notices instanceof Map ? options.notices : undefined
      const catalogChildren = new Map()
      const diagnostics = []
      for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') continue
        // 平台的目录条目形状是 `{id, createdAt, mode, label?}`——**没有 `kind`**，所以「有 id 就是
        // 子会话」；只有显式 `kind: 'diagnostic'` 才当诊断行（兼容更早的形状）。
        if (entry.kind === 'diagnostic') diagnostics.push(entry)
        else if (typeof entry.id === 'string' && entry.id !== '') catalogChildren.set(entry.id, entry)
      }

      /** 一个子会话 → 一行。 */
      function rowOf(childId, depth) {
        const summary = byId[childId]
        const entry = catalogChildren.get(childId)
        const notice = notices === undefined ? undefined : notices.get(childId)
        const detail = notice === undefined ? '' : notice.summary !== '' ? notice.summary : notice.text
        let state = 'unknown'
        if (summary?.running === true || entry?.activity === 'running' || entry?.running === true) state = 'running'
        else if (notice !== undefined) state = subagentStateOfSettlement(`${notice.summary}\n${notice.text}`)
        const label =
          typeof entry?.label === 'string' && entry.label !== ''
            ? entry.label
            : typeof summary?.title === 'string' && summary.title !== ''
              ? summary.title
              : typeof summary?.displayTitle === 'string' && summary.displayTitle !== ''
                ? summary.displayTitle
                : shortChildId(childId)
        return {
          key: childId,
          childId,
          kind: 'child',
          depth,
          state,
          detail: String(detail ?? ''),
          label: String(label),
          mode: typeof entry?.mode === 'string' ? entry.mode : '',
        }
      }

      const rows = []
      const seen = new Set()
      function walk(id, depth) {
        if (depth >= MAX_SUBAGENT_TREE_DEPTH) return
        // 直接子代理：目录（有标签/模式）∪ 列表（有实时运行态）取并集。
        const candidates = []
        if (depth === 0) for (const childId of catalogChildren.keys()) candidates.push(childId)
        for (const childId of Object.keys(byId)) {
          if (byId[childId]?.parentId !== id) continue
          if (!candidates.includes(childId)) candidates.push(childId)
        }
        for (const childId of candidates) {
          if (seen.has(childId)) continue
          seen.add(childId)
          rows.push(rowOf(childId, depth))
          if (rows.length >= MAX_SUBAGENT_TREE_ROWS) return
          walk(childId, depth + 1)
          if (rows.length >= MAX_SUBAGENT_TREE_ROWS) return
        }
      }
      walk(typeof parentSessionId === 'string' ? parentSessionId : '', 0)

      // 目录诊断行（子会话不可读之类的目录级问题）：没有 childId，不可点，但要看得见。
      for (const entry of diagnostics) {
        if (rows.length >= MAX_SUBAGENT_TREE_ROWS) break
        rows.push({
          key: `diagnostic:${rows.length}:${String(entry.id ?? '')}`,
          childId: '',
          kind: 'diagnostic',
          depth: 0,
          state: 'failed',
          detail: '',
          label: String(entry.reason ?? entry.label ?? entry.id ?? ''),
          mode: '',
        })
      }
      const total = rows.length
      return { rows: total > MAX_SUBAGENT_TREE_ROWS ? rows.slice(0, MAX_SUBAGENT_TREE_ROWS) : rows, total }
    }

    /**
     * 「子代理」下拉菜单：任务视图顶部的一条工具条。
     *
     * **为什么画在这里**：标签栏由核心渲染，`viewTabs()`（`dsh-client-ui-conversation/lib/client.js:16555`）
     * 只产出 `{id, label}`——标签上挂不了菜单；`conversation.view` 的注册形状也没有 actions 字段。
     * 所以菜单放在**任务视图自己的顶部**：它就在标签栏正下方，且只在**这个会话真的有子代理**时才出现。
     *
     * 三条纪律：
     * - 没有子代理 → 整个工具条不渲染（一个像素都不占）；
     * - 不打扰宿主：目录只在「已确认有子代理」或「菜单展开」时才拉（`seat.refreshCatalog()`）；
     * - 点击一行 = `seat.openSubagent(childId)`，走进那个子代理的对话（这条路会切舞台，正是用户要的）。
     *
     * @param props - `seat`（子代理席位）、`sessionId`、`t`、`notices`（结算通知表）。
     * @returns 工具条；没有子代理或席位缺席时返回 `null`。
     */
    function SubagentBar({ seat, sessionId, t, notices }) {
      const usable = seat !== null && seat !== undefined && typeof seat.catalog === 'function'
      const [open, setOpen] = useState(false)
      const [, force] = useState(0)
      const rootRef = useRef(null)
      const data = usable ? seat.catalog() : undefined
      const tree = usable
        ? subagentTreeOf(sessionId, { list: data?.list, catalog: data?.catalog, notices })
        : { rows: [], total: 0 }

      // 列表快照一变就重画（子代理新增、运行态变化都会推）。
      useEffect(() => {
        if (!usable || typeof seat.subscribeCatalog !== 'function') return undefined
        const unsubscribe = seat.subscribeCatalog(() => force((value) => value + 1))
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [usable, seat])

      // Escape 与点外关闭。
      useEffect(() => {
        if (open !== true) return undefined
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onDown = (event) => {
          const node = rootRef.current
          if (node !== null && node !== undefined && typeof node.contains === 'function' && node.contains(event.target)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onDown)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onDown)
        }
      }, [open])

      if (!usable || tree.rows.length === 0) return null
      const running = tree.rows.filter((row) => row.state === 'running').length
      const toggle = () => {
        const next = open !== true
        setOpen(next)
        // 展开时拉一次目录：标签/模式/诊断行都在目录里，列表快照给不了。
        if (next && typeof seat.refreshCatalog === 'function') seat.refreshCatalog()
      }
      const rows = []
      for (const row of tree.rows) {
        const stateLabel = t(SUBAGENT_STATE_LABEL[row.state] ?? 'flow.agents.state.unknown')
        rows.push(
          h(
            'button',
            {
              key: row.key,
              type: 'button',
              role: 'menuitem',
              className: 'dcf-agentrow',
              'data-dcf-agentrow': 'true',
              'data-state': row.state,
              'data-depth': String(row.depth),
              'data-kind': row.kind,
              disabled: row.childId === '',
              title: row.detail === '' ? row.label : `${row.label} — ${row.detail}`,
              onClick: () => {
                if (row.childId === '') return
                setOpen(false)
                if (typeof seat.openSubagent === 'function') seat.openSubagent(row.childId)
              },
            },
            h('span', { className: 'dcf-agentlabel' }, row.label),
            row.mode === 'one-shot' || row.mode === 'continuable'
              ? h(
                  'span',
                  { className: 'dcf-agentmode' },
                  t(row.mode === 'one-shot' ? 'flow.agents.mode.oneShot' : 'flow.agents.mode.continuable'),
                )
              : null,
            h(
              'span',
              {
                className: 'dcf-agentstate',
                'data-state': row.state,
                'data-tone': SUBAGENT_STATE_TONE[row.state] ?? 'muted',
                'aria-label': stateLabel,
                title: stateLabel,
              },
              SUBAGENT_STATE_GLYPH[row.state] ?? '○',
            ),
          ),
        )
      }
      return h(
        'div',
        {
          className: 'dcf-agentbar',
          'data-dcf-agentbar': 'true',
          'data-running': running > 0 ? 'true' : 'false',
          ref: rootRef,
        },
        h(
          'div',
          { className: 'dcf-agent' },
          h(
            'button',
            {
              type: 'button',
              className: 'dcf-agenttrigger',
              'data-dcf-agenttrigger': 'true',
              'aria-expanded': open === true,
              onClick: toggle,
            },
            h(
              'span',
              { className: 'dcf-agentglyph', 'data-state': running > 0 ? 'running' : 'idle' },
              running > 0 ? SUBAGENT_STATE_GLYPH.running : SUBAGENT_STATE_GLYPH.unknown,
            ),
            h('span', { className: 'dcf-agenttitle' }, t('flow.agents.title')),
            h(
              'span',
              { className: 'dcf-agentcount' },
              running > 0
                ? t('flow.agents.running', { count: running })
                : t('flow.agents.count', { count: tree.total }),
            ),
            h(Chevron, { open }),
          ),
          open === true
            ? h('div', { className: 'dcf-agentmenu', 'data-dcf-agentmenu': 'true', role: 'menu' }, rows)
            : null,
        ),
      )
    }
    /* ──────────────────────────── 「思考中 / 思考完成」块 ──────────────────────────── */

    /**
     * 把统计分段拼成一行本地化文本。
     *
     * 文案组装放在**渲染层**而不是派生层：派生层只认类别键，中文/英文由 `t` 决定。
     * 每一项都是**完整句子**（用户要求「思考 x 次 执行 y 条命令 读取 w 个文件 编辑 z 个文件
     * 这种说法」），所以计数作为参数传进模板，而不是在句子后面再挂一个裸数字——
     * 中文的量词是跟着名词走的，拼接会拼出「执行 5 命令」这种半截话。
     * **计数为 0 的类别完全不显示**（用户明确要求）；全部为 0 时退化成「N 个操作」或「无操作」。
     *
     * @param stats - {@link statsOfNodes} 的结果。
     * @param t - locale 座位。
     * @returns 折叠态那一行统计文本。
     */
    function describeStats(stats, t) {
      const { segments, listed } = statsSummary(stats)
      if (segments.length === 0) return listed > 0 ? t('flow.ops', { count: listed }) : t('flow.noOps')
      return segments.map((segment) => t(CATEGORY_LOCALE_KEYS[segment.category], { count: segment.count })).join(' · ')
    }

    /**
     * 「思考中 / 思考完成」块：一段处理过程的折叠容器。
     *
     * - 标题随状态切换：还在跑 = **思考中**（带浮动光效），跑完 = **思考完成**，被停掉 = **未完成**；
     * - 折叠时只显示非零的统计项（思考 x 次 / 执行 y 条命令 / 读取 w 个文件 / 编辑 z 个文件 /
     *   调用 k 个 MCP 工具 / 提问 v 次，0 值不显示）；
     * - 默认展开条件 = 这段过程所属的任务/回合正在进行；结束后自动收起；
     * - **容器是插槽的，内容是核心的**：行内每一行都走原生座位（命令卡、工具卡、思考行…），
     *   多次上下文注入合并进同一个折叠点（{@link ContextFold}）。
     *
     * @param props - `blockKey`、`nodes`、`models`、`stats`、`t`、`sessionId`、`active`、`cutOff`、`labels`、`seat`。
     * @returns 折叠块。
     */
    function ThinkingBlock({ blockKey, nodes, models, stats, t, sessionId, active, cutOff, labels, seat }) {
      // **默认永远收起**（懒加载：收起时正文不进 DOM——本块是唯一传 `lazy: true` 的折叠体，
      // 因为它的明细最多且每条都要经原生座位走一遍核心渲染；展开时正文按需重建）。
      // 折叠头一行给出状态（思考中 / 思考已完成 / 思考被打断）与统计，需要看过程时点开。
      const [open, toggle] = useCollapse(sessionId, blockKey, false)
      const rows = useMemo(() => groupProcessNodes(nodes), [nodes])
      const body = []
      for (const row of rows) {
        if (row.kind === 'contexts') {
          body.push(
            h(ContextFold, {
              key: `ctx:${row.nodes[0].key}`,
              nodes: row.nodes,
              models,
              t,
              sessionId,
              seat,
              labels,
            }),
          )
          continue
        }
        body.push(
          h(NativeNodeRow, {
            key: row.node.key,
            node: row.node,
            row: models.get(row.node.key),
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }
      /**
       * 标题只看**这一块自己**有没有被中断（`cutOff`）。
       *
       * ⚠️ 不能把「回合还没收尾」（`unfinished`）当成被打断：回合级的标志里含着
       * 「后台子 agent 已派出但报告未到」这类正常情况，一挂上去就变成**每一块都写「被打断」**
       * （用户报告过）。回合级的标志只用在「任务过程」折叠头的警示 chip 上。
       */
      const title =
        active === true
          ? t('flow.thinking.live')
          : cutOff === true
            ? t('flow.thinking.cutOff')
            : t('flow.thinking.done')
      return h(
        'div',
        { className: 'dcf-thinking', 'data-live': active === true ? 'true' : 'false' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-row dcf-thinkinghead',
            'aria-expanded': open === true,
            // 折叠键写进 DOM：本块是全插件**唯一**懒加载的折叠体，收起时正文根本不在树里，
            // 「这一块的键是什么」就成了排查与测试都绕不开的信息（同时也是 localStorage 里的键）。
            'data-fold-key': blockKey,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h('span', { className: 'dcf-thinkingtitle', 'data-shimmer': active === true ? 'true' : 'false' }, title),
          // 折叠点后面不加数字（用户要求）：统计本身就说明了这一段做了什么。
          h('span', { className: 'dcf-summary' }, describeStats(stats, t)),
        ),
        h(Fold, { open, className: 'dcf-body', lazy: true }, body),
      )
    }

    /**
     * 渲染一段节点：按「过程 run / 正文 run」交替排列。
     *
     * **为什么按 run 切**（用户要求）：一段过程里一旦出现对用户可见的正文，
     * 前面的思考块就**封口**（结束），后面的动作属于**下一个**思考块——
     * 于是「思考中」不再是一整段任务的巨大容器，而是「一次思考 → 一段输出 → 再思考」的节奏。
     *
     * `mode` 决定渲染哪一半（两份互斥，同一节点不会被画两次）：
     * - `inside`（默认）：画进「任务过程」的那一份。`summary === true` 时**跳过最后一段正文**
     *   （那一段要留在最外层当汇报）；
     * - `summary`：只画**最后一段正文**（任务结束时对用户的汇报）。
     *
     * 用户当轮要求「思考过程中穿插的对用户输出的内容应该合并到任务过程的节点里面去，
     * 而不应该显示在最外层的层级」：所以跑动中（`summary` 不为真、外面也不画）过程中写的正文
     * 全都在任务过程里；只有任务结束后的那一段留在最外层。
     *
     * **收尾节点（`turn-tail`）在这里被剔除**：它的位置由回合层固定在「总结之后」单独渲染
     * （见 `isFooterNode`），任何折叠体都不该把它卷进去——否则复制/点赞/点踩/分支按钮会
     * 跑到「任务过程」里面去（用户报告过）。
     *
     * @param props - `nodes`、`blockKey`、`t`、`sessionId`、`labels`、`active`、`liveKey`、`subagents`、`mode`、`summary`、`seat`。
     * @returns 节点序列；没有任何可显示内容时返回 `null`。
     */
    function NodeSequence({ nodes, blockKey, t, sessionId, labels, active, liveKey, subagents, mode, summary, seat }) {
      // 最外层节点（用户发言 / 插队 / 收尾控件）由回合层渲染：这里剔除它们；run 也会在它们处断开。
      const seatNodes = useMemo(() => seatNodesOf(nodes).filter((node) => !isTopLevelNode(node)), [nodes])
      const runs = useMemo(() => nodeRunsOf(seatNodes), [seatNodes])
      // 回退模型只在这里算一次：正文行与过程块共用这份 Map，避免重复解析工具块。
      const models = useMemo(() => rowModelsOf(seatNodes, subagents), [seatNodes, subagents])
      const summaryIndex = lastInlineRunIndex(runs)
      const children = []
      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index]
        if (mode === 'summary' ? index !== summaryIndex : summary === true && index === summaryIndex) continue
        if (run.kind === 'process') {
          // 整块都渲染成空的过程（见 {@link isBlankNode}）不画：画出来只有一个「无操作」的折叠头，
          // 看起来就像一个凭空的思考块（用户报告过最前面那块残留）。
          if (run.nodes.every(isBlankNode)) continue
          const first = run.nodes[0]
          /**
           * 这一块**正在写**吗？判据是「回合在跑 **且** 本块包含回合的最后一个可渲染节点」。
           * 只判回合会让同一回合里早已写完的块一直显示「思考中」（用户报告过）；
           * 只判节点又会让回合结束后的最后一块永远停在「思考中」。
           */
          const blockActive =
            active === true &&
            liveKey !== null &&
            liveKey !== undefined &&
            run.nodes.some((node) => node.key === liveKey)
          children.push(
            h(ThinkingBlock, {
              // 每个 run 一块：key 与折叠状态键都用该 run 的第一个节点（稳定且唯一）。
              key: `run:${first.key}`,
              blockKey: `${blockKey}:${first.key}`,
              nodes: run.nodes,
              models,
              stats: statsOfNodes(run.nodes, subagents),
              t,
              sessionId,
              active: blockActive,
              cutOff: cutOffOf(run.nodes),
              labels,
              seat,
            }),
          )
          continue
        }
        for (const node of run.nodes) {
          children.push(
            h(NativeNodeRow, {
              key: node.key,
              node,
              row: models.get(node.key),
              seat,
              t,
              sessionId,
              labels,
            }),
          )
        }
      }
      if (children.length === 0) return null
      return h('div', { className: 'dcf-block' }, children)
    }
    /* ──────────────────────────── 计划 / 任务列表快照 / 子任务 ──────────────────────────── */

    /** 状态点在任务行左侧：已完成/进行中用 primitives 的 `StateDot`，未开始用空心圆。 */
    function TaskDot({ status, stalled }) {
      if (status === 'completed') return h(StateDot, { state: 'done', size: 10, className: 'dcf-dot' })
      // ⚠️ `ongoing` 是**会转的**状态点。回合已结束（例如被用户停止）却还挂在 in_progress 上的任务
      // 必须换成静态的警示点，否则界面一直在转，等于告诉用户「还在干活」——那是错的。
      if (status === 'in_progress') {
        return h(StateDot, { state: stalled === true ? 'warning' : 'ongoing', size: 10, className: 'dcf-dot' })
      }
      // 「已停止」：被后续任务列表接管的那一项。用 primitives 的中性静态点（`idle` 没有专属配色，
      // 走 currentColor）——它既不是「还在转」，也不是「出错了」，只是不再运行。
      if (status === 'stopped') return h(StateDot, { state: 'idle', size: 10, className: 'dcf-dot' })
      return h('span', { className: 'dcf-dot dcf-dot-pending' })
    }

    /**
     * 任务行在界面上的**显示状态**。
     *
     * 快照内容永远冻结（用户要求「显示也是显示这时的状态」），但**运行状态不能冻结**：
     * 后续列表一出现，旧列表里那一项就不再是「进行中」了——它已经被接管。
     * 不这么做的话，一个回合从头到尾**第一步那一版**都挂着会转的进度圈
     * （用户报告过「老的任务列表都在第一步，都有进度圈在转」）。
     *
     * @param segment - 分段视图模型（认 `superseded`）。
     * @param status - 该快照里冻结的状态。
     * @returns `stopped`（被接管），否则原样返回。
     */
    function displayStatusOf(segment, status) {
      return segment.superseded === true && status === 'in_progress' ? 'stopped' : status
    }

    /**
     * 把毫秒格式化成「x分x秒」（有小时才加小时位）。
     *
     * **分位始终显示**：用户要求计时「从 0 分 0 秒开始」，所以刚开跑的任务显示 `0分3秒`
     * 而不是 `3秒`——位数固定，读数时不会跳。
     */
    function formatDuration(ms, t) {
      const total = Math.max(0, Math.round(ms / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const parts = []
      if (hours > 0) parts.push(t('flow.duration.hour', { count: hours }))
      parts.push(t('flow.duration.minute', { count: minutes }))
      parts.push(t('flow.duration.second', { count: seconds }))
      return parts.join('')
    }

    /** 任务状态的本地化文字。 */
    function statusText(t, status) {
      if (status === 'completed') return t('flow.status.completed')
      if (status === 'in_progress') return t('flow.status.in_progress')
      if (status === 'stopped') return t('flow.status.stopped')
      return t('flow.status.pending')
    }

    /**
     * 任务列表**快照面板**：每一次 `todo_write` 的冻结状态各成一块（背景板）。
     *
     * 这是用户当轮要求的核心语义：「不能全局调用，只有有更新任务列表，就要存储一次这时的状态，
     * 之后显示也是显示这时的状态」。所以这里渲染的是**该分段自己的那份快照**，
     * 而不是「当前最新列表」——否则对话里每处列表都长一样，历史进度就没有意义了。
     *
     * **默认展开规则**（三条用户要求合起来）：
     * - **只有最后一块（当前那一版）默认展开**（用户要求「如果一个任务列表出现后列表被更新了，
     *   那么老的任务列表就应该自动折叠」）：旧版是历史，展开只是占地方；
     * - 当前这一版里，**整张表全部已完成时也默认收起**（用户要求「当任务列表更新为『全部已完成』
     *   状态时，不需要展开」）——这时候没有「进度」可看；
     * - 用户手动点过就以用户的选择为准（`useCollapse` 只在显式切换时写 localStorage）。
     *
     * ⚠️ 表内**运行状态跟着最新的列表走**：被接管的旧版里「进行中」那一项显示成「已停止」、
     * 点也不再转（见 {@link displayStatusOf}）——冻结的是**内容**，不是「还在不在跑」。
     *
     * @param props - `segment`、`t`、`sessionId`、`unfinished`。
     * @returns 快照面板。
     */
    function SnapshotPlate({ segment, t, sessionId, unfinished }) {
      /** 这一版是不是「当前那一版」（后面还有更新的列表就被接管了）。 */
      const current = segment.superseded !== true
      /** 整张表是否都已完成（空表不算），据此决定默认展开还是默认收起。 */
      const allDone = segment.todos.length > 0 && segment.completedCount === segment.todos.length
      const [open, toggle] = useCollapse(sessionId, `plate:${segment.key}`, current && allDone !== true)
      /**
       * 面板正文：**只写「哪些已完成」**（用户要求），不再写「本次变化（X ✓ · Y ▶）」那种对比说明。
       * 逐项列表本身带着状态点与状态徽标，所以这一行只是把「这一版里已经完成的部分」点名出来。
       */
      const done = segment.todos.filter((todo) => todo.status === 'completed').map((todo) => todo.content)
      const body = []
      if (done.length > 0) {
        body.push(h('div', { key: 'done', className: 'dcf-change' }, t('flow.tasksDone', { text: done.join(' · ') })))
      }
      for (const todo of segment.todos) {
        // 显示状态：被接管的旧版里那一项不再是「进行中」，而是「已停止」。
        const status = displayStatusOf(segment, todo.status)
        body.push(
          h(
            'div',
            { key: `item:${todo.content}`, className: 'dcf-taskrow', 'data-status': status },
            h(TaskDot, { status, stalled: current && unfinished === true }),
            h('span', { className: 'dcf-tasktitle' }, todo.content),
            h('span', { className: 'dcf-badge' }, statusText(t, status)),
          ),
        )
      }
      return h(
        'div',
        { className: 'dcf-plate' },
        h(
          'button',
          { type: 'button', className: 'dcf-platehead', 'aria-expanded': open === true, onClick: toggle },
          h(Chevron, { open }),
          h('span', { className: 'dcf-platetitle' }, t('flow.tasks')),
          h('span', { className: 'dcf-badge' }, t('flow.tasksUpdate', { index: segment.index + 1 })),
          h(
            'span',
            { className: 'dcf-count' },
            t('flow.tasksSummary', { total: segment.todos.length, done: segment.completedCount }),
          ),
        ),
        h(Fold, { open, className: 'dcf-platebody' }, body),
      )
    }

    /**
     * 一个分段里的「子任务」折叠体：这一版列表当时正在进行的那一项。
     *
     * 这就是「完成一个任务后需要 agent 写明下一个任务，然后才显示下一个节点」的落点：
     * 下一个任务节点属于**下一个分段**，而下一个分段由那次 `todo_write` 开启。
     * 该任务在这一版快照里必然是 `in_progress`（快照是冻结的），所以状态点显示「进行中」，
     * 「已完成」会在下一块快照面板里出现。
     *
     * **默认展开只给「此刻正在做的那一项」**（`segment.isCurrentTask`，见 `buildTurnGroup`），
     * 且必须**这个回合还在跑**：任务一旦完成或回合结束，它就自动折叠（用户要求
     * 「当一个任务或一个节点完成后自动折叠」）。更早分段的折叠体没有理由继续摊开；
     * 唯一例外是「回合结束但没做完」——那时保持展开，让用户一眼看到它停在哪一步。
     *
     * ⚠️ **被后续列表接管的旧分段一律不展开**（`segment.superseded`）：即使那一项在后续列表里
     * 仍然是 `in_progress`（同一次任务跨了多版列表），展开的也应该是**最新那一版**——
     * 否则同一个任务会同时摊开好几个折叠体（用户报告过「从头至尾老的任务列表都在第一步」）。
     *
     * @param props - `segment`、`t`、`sessionId`、`labels`、`live`、`unfinished`、`subagents`、`seat`。
     * @returns 子任务折叠体；该分段没有进行中的任务时返回 `null`。
     */
    function TaskFold({ segment, t, sessionId, labels, live, unfinished, subagents, seat, liveKey }) {
      const current = segment.superseded !== true
      const [open, toggle] = useCollapse(
        sessionId,
        `task:${segment.key}`,
        current && segment.isCurrentTask === true && (live === true || unfinished === true),
      )
      if (segment.activeTask === null) return null
      /** 被接管的旧分段里，这一项也显示成「已停止」（内容冻结，运行状态跟最新列表走）。 */
      const status = displayStatusOf(segment, 'in_progress')
      return h(
        'div',
        { className: 'dcf-task' },
        h(
          'button',
          {
            type: 'button',
            className: 'dcf-taskrow',
            'data-status': status,
            'aria-expanded': open === true,
            onClick: toggle,
          },
          h(Chevron, { open }),
          h(TaskDot, { status, stalled: current && unfinished === true }),
          h('span', { className: 'dcf-tasktitle' }, segment.activeTask),
          h('span', { className: 'dcf-badge' }, t('flow.ops', { count: segment.stats.listed })),
        ),
        h(
          Fold,
          { open },
          h(NodeSequence, {
            nodes: segment.nodes,
            blockKey: `proc:${segment.key}`,
            t,
            sessionId,
            labels,
            // 「思考中」按「这一块里有没有回合的最后一个节点」判定（见 NodeSequence 的 blockActive）：
            // 这一项写完了就立刻变成「思考已完成」，而不是整回合一直挂着「思考中」。
            active: live,
            liveKey,
            unfinished,
            subagents: subagents,
            seat,
          }),
        ),
      )
    }

    /**
     * 一个回合 = 一次用户输入产生的任务流（「任务处理流」这一层）。
     *
     * 层级（用户当轮要求）：**任务处理流 > 子任务 > 小处理过程 = 子 agent 操作**。
     * - 任务处理流 = 本组件（回合）；
     * - 子任务 = {@link TaskFold}（由某次列表更新点名的那一项）；
     * - 小处理过程 = {@link ThinkingBlock}（思考中 / 思考完成），子 agent 卡片与它同级。
     *
     * 有计划：用户发言 → 规划过程 → 逐段（列表快照 + 子任务）→ 收尾。
     * 没计划：用户发言 → 按操作序列折叠（`looseNodes`）。
     *
     * @param props - `group`、`t`、`sessionId`、`labels`、`live`、`seat`、`now`。
     * @returns 回合块。
     */
    function TurnGroup({ group, t, sessionId, labels, live, seat, now }) {
      // 「任务过程」：**进行中默认展开，并且此时不允许关闭**（用户要求「任务过程中默认展开，
      // 任务完成了以后才允许关闭这个节点」）；任务结束后默认收起，用户可以自由开合（选择被记住）。
      // 回合结束但没做完的任务、以及「正在做的那一项」仍然在折叠体里，靠头上的「被打断」标记提示。
      /**
       * 任务过程头上的两枚徽标（用户裁决：只有**核心给出的中断证据**才配写「被打断」）：
       * - `cutOff`：`assistant-step` 被标 `interrupted`，或工具块错误码属于 `INTERRUPT_CODES`；
       * - `unfinished`：回合结束了，但最后一个任务列表里还留着「进行中」——这是**很常见**的事
       *   （清单本来就只写了一半、模型没回头改），所以只给中性文案，不再冒充「被打断」。
       */
      const cutOff = group.cutOff === true && live !== true
      const unfinished = group.unfinished === true && live !== true
      // 折叠状态键用 `group.key`（同一回合里可能因为插队消息而有多个分组，见 deriveFlow）。
      const [storedStageOpen, toggleStage] = useCollapse(sessionId, `stage:${group.key}`, false)
      const stageOpen = live === true ? true : storedStageOpen
      /**
       * 任务耗时：**正在跑的回合实时计时**（`now` 由视图每秒刷新一次，见 `useTick`），
       * 已经结束的回合用派生层算好的固定值。从 0 分 0 秒开始往上走。
       */
      const liveMs =
        live === true && typeof group.startedAt === 'number' && typeof now === 'number'
          ? Math.max(0, now - group.startedAt)
          : null
      const durationMs = liveMs === null ? group.durationMs : liveMs
      const durationText =
        durationMs === null ? '' : t('flow.stage.duration', { text: formatDuration(durationMs, t) })
      const statsText = describeStats(group.stats, t)
      const stageSummary = [durationText, statsText].filter((part) => part !== '').join(' · ')
      /** 用户发言走原生座位；这里只算一次它自己的回退模型。 */
      const inputRow = useMemo(
        () => (group.input === undefined ? null : nodeRowOf(group.input, group.subagents)),
        [group],
      )

      const children = []
      if (group.input !== undefined) {
        // 用户说的话永远在最外层（`NativeNodeRow` 直接在回合块里，不进任何折叠体）。
        // 插队消息额外挂一个「插队」标记：同一个回合里出现第二个气泡时，读者要知道它是怎么来的。
        children.push(
          h(NativeNodeRow, {
            key: 'ask',
            node: group.input,
            row: inputRow,
            seat,
            t,
            sessionId,
            labels,
            marker: group.inputKind === 'steering' ? t('flow.steering') : null,
          }),
        )
      }

      // ---- 折进「任务过程」的部分：动手之前的规划段 + 每段的任务列表快照 + 子任务 + 过程明细 ----
      const stage = []
      if (group.planned && group.planNodes.length > 0) {
        /**
         * 「规划过程」不再单独成折叠体（用户要求「移除掉规划过程，全部算任务过程里面」）：
         * 首个 `todo_write` 之前的那一段（想过什么、说过什么）**排在任务过程的最前面**，
         * 与快照面板、子任务、过程明细同一个折叠体。
         *
         * ⚠️ 这里**不传 `mode`/`summary`**：规划段在定义上早于任何分段，永远不可能是本回合的收尾汇报，
         * 若跟着 `summary` 逻辑跳过最后一段正文，那一段就会从界面上彻底消失。
         */
        stage.push(
          h(NodeSequence, {
            key: 'plan-sequence',
            nodes: group.planNodes,
            blockKey: `proc:plan:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            liveKey: group.liveKey,
            subagents: group.subagents,
            seat,
          }),
        )
      }
      if (group.planned) {
        for (const segment of group.segments) {
          stage.push(
            h(SnapshotPlate, {
              key: `plate:${segment.key}`,
              segment,
              t,
              sessionId,
              unfinished,
            }),
          )
          stage.push(
            h(TaskFold, {
              key: `task:${segment.key}`,
              segment,
              t,
              sessionId,
              labels,
              live,
              unfinished,
              subagents: group.subagents,
              seat,
              liveKey: group.liveKey,
            }),
          )
          if (segment.activeTask === null && segment.nodes.length > 0) {
            // 这一段已经没有「进行中」的任务了，`TaskFold` 不渲染；它自己的过程与正文都放在这里。
            // 用默认 mode（两份都渲染）：正文如果只走 process 那一份就会被丢掉。
            stage.push(
              h(NodeSequence, {
                key: `seq:${segment.key}`,
                nodes: segment.nodes,
                blockKey: `proc:${segment.key}`,
                t,
                sessionId,
                labels,
                active: live,
                liveKey: group.liveKey,
                subagents: group.subagents,
                seat,
              }),
            )
          }
        }
      }
      /**
       * 模型是否**显式声明过**「总结从这里开始」（本回合调过 `chat_flow_summary`）。
       *
       * 声明过就不再猜：标记之后的内容就是总结，整段交给最外层渲染，一条也不留在
       * 「任务过程」里；没声明则沿用启发式（最后一段正文才是汇报），老会话照旧。
       */
      const marked = group.summaryMarked === true
      /**
       * 「任务过程」那一半要画的尾巴。
       *
       * - 声明过分界：过程只剩标记**之前**的散节点（有任务列表的回合里就是空数组），
       *   总结整段在下面单独画 —— 两边绝不重叠（同一批节点里外各画一份是明令禁止的）；
       * - 没声明：没有任务列表的回合用散节点，有任务列表的回合用 `closing`（旧行为）。
       */
      const tailNodes = marked || !group.planned ? group.looseNodes : group.closing
      /**
       * 任务是否已经结束。
       *
       * 它是「过程里穿插的正文放哪儿」的开关（用户要求）：任务结束时，**最后一段正文**才是
       * 「任务结束时对用户的汇报」，留在最外层；其余（包括跑动中穿插写的那些正文）全部收进任务过程。
       */
      const closed = group.closed === true
      stage.push(
        h(NodeSequence, {
          key: 'stage-process',
          nodes: tailNodes,
          blockKey: `proc:${group.planned ? 'closing' : 'loose'}:${group.turn}`,
          t,
          sessionId,
          labels,
          active: live,
          liveKey: group.liveKey,
          subagents: group.subagents,
          mode: 'inside',
          // 声明过分界时**不用** run 下标分流（那一手会把过程尾巴的最后一段正文藏起来）。
          summary: marked ? false : closed,
          seat,
        }),
      )
      children.push(
        h(DisclosureLine, {
          key: 'stage',
          open: stageOpen,
          onToggle: toggleStage,
          // 跑动中**不允许关闭**：`locked` 让折叠头退化成静态行（点不动），完成后恢复成按钮。
          locked: live === true,
          leading: h('span', { className: 'dcf-chev' }),
          title: t('flow.stage'),
          summary: stageSummary,
          trailing: cutOff
            ? h(StatusChip, { key: 'cut', tone: 'warn', text: t('flow.status.cutOff') })
            : unfinished
              ? h(StatusChip, { key: 'stale', tone: 'muted', text: t('flow.status.unfinished') })
              : null,
        }, stage),
      )

      // ---- 留在最外面的部分：**总结**（任务没结束且模型没声明分界时什么都不放外面）----
      // 声明过分界时**立刻**拿出来（不等回合结束）：那正是模型说「接下来的话是给你的总结」的时刻，
      // 留到回合结束再拿出去，总结正文会在流式期间凭空消失几秒。
      if (closed || marked) {
        children.push(
          h(NodeSequence, {
            key: 'stage-summary',
            // 声明过分界：画 `closing` 的**全部**节点（总结里可能夹着交付工具调用或多段正文）；
            // 没声明：还是旧口径 —— `tailNodes` 里只画最后那一段连续正文。
            nodes: marked ? group.closing : tailNodes,
            blockKey: `summary:${group.turn}`,
            t,
            sessionId,
            labels,
            active: live,
            liveKey: group.liveKey,
            subagents: group.subagents,
            // `undefined` 即「不传 mode」：两种 run 都画（见 `60-process.js` 的分流闸门）。
            mode: marked ? undefined : 'summary',
            seat,
          }),
        )
      }

      // ---- 收尾节点固定排在**总结之后**（用户要求）：复制 / 点赞 / 点踩 /「在新对话中分支」在它里面。
      // 它们不进任何折叠体（`NodeSequence` 里也会把它们剔除），所以这里单独渲染一次。
      for (const node of group.footerNodes ?? []) {
        children.push(
          h(NativeNodeRow, {
            key: `footer:${node.key}`,
            node,
            row: null,
            seat,
            t,
            sessionId,
            labels,
          }),
        )
      }

      return h(
        'div',
        { className: 'dcf-turn', 'data-turn': String(group.turn), 'data-turn-anchor': String(group.turn) },
        children,
      )
    }    /* ──────────────────────────── 右侧回合导轨 ──────────────────────────── */

    /**
     * 把导轨滚到最底部（当前回合就在最后一格）。
     *
     * 导轨自己是个可滚容器（刻度多了要溢出），但它不跟阅读视口联动：**默认停在顶部**，
     * 于是高亮在最后几格时用户什么也看不见。所以挂载与刻度数变化时主动滚到底。
     * 只在这一刻滚，之后用户手动滚动不被抢（阅读时导轨跟着视口跳会很烦）。
     *
     * @param rail - `.dcf-rail` 元素（滚动容器）。
     */
    function scrollRailToBottom(rail) {
      if (rail === null || rail === undefined) return
      rail.scrollTop = rail.scrollHeight
    }

    /**
     * 把「已加载的回合」与 `turnOutline` 投影合并成导轨刻度。
     *
     * 这是核心 `mergeTurnRailItems`（`CHAT:1829-1858`）的同构实现：
     * `turnOutline` 是**全集**（含未加载回合，带 `turn` 与 `seq`），已加载的回合覆盖同名项，
     * 结果按 `turn` 升序。`seq` 是 `turn/start` 事件的 seq，也就是 `loadThrough` 的翻页目标。
     *
     * @param outline - `useProjection('turnOutline')` 的值：`{turn, seq, prompt, response}[]`，或 `undefined`。
     * @param loadedTurns - 本视图自己派生出的回合号数组。
     * @returns `{turn, loaded, seq}[]`，按 turn 升序。
     */
    function mergeRailItems(outline, loadedTurns) {
      const byTurn = new Map()
      if (Array.isArray(outline)) {
        for (const entry of outline) {
          if (entry === null || typeof entry !== 'object') continue
          if (!Number.isSafeInteger(entry.turn) || entry.turn < 0) continue
          if (!Number.isSafeInteger(entry.seq) || entry.seq < 0) continue
          byTurn.set(entry.turn, {
            turn: entry.turn,
            loaded: false,
            seq: entry.seq,
            summary: typeof entry.prompt === 'string' ? entry.prompt : '',
          })
        }
      }
      for (const turn of loadedTurns) {
        const previous = byTurn.get(turn)
        byTurn.set(turn, {
          turn,
          loaded: true,
          seq: previous?.seq ?? null,
          summary: previous?.summary ?? '',
        })
      }
      return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
    }

    /**
     * 右侧刻度条：每个回合一个刻度，点击跳到该回合（一次对话）的开头。
     *
     * 结构与核心的 `TurnNavigator` 同构但**不共用代码**（它没有任何公开导出）：
     * 一个**零高 sticky 槽**钉在滚动视口顶部，里面绝对定位出竖向刻度条。
     * 这样滚动时导轨始终停在视口里，刻度数与内容高度无关（不需要按比例定位）。
     *
     * 刻度分两种：
     * - **已加载**（`data-loaded="true"`）→ 点击直接滚动到该回合；
     * - **未加载**（`data-loaded="false"`，淡显）→ 点击先翻页加载到它，期间该刻度显示加载动画
     *   （`data-busy="true"`），加载完成后自动滚到位。
     *
     * 刻度里写**回合号数字**（用户要求：不要光秃秃的横线，刻度要能读出「这是第几轮」）：
     * 用户说的「第 N 轮」与这里的数字是同一个数，所以点击/无障碍文案都不用换算。
     * 加载中（`data-busy`）时数字让位给转圈——那一格正在等翻页，读数没有意义。
     *
     * 只有一个刻度时也渲染（它可能是唯一的一个未加载刻度）。没有可跳目标时返回 `null`。
     *
     * @param props - `items`、`activeTurn`、`liveTurn`、`busyTurn`、`onJump`、`t`。
     * @returns 导轨。
     */
    function TurnRail({ items, activeTurn, liveTurn, busyTurn, onJump, t }) {
      const railRef = useRef(null)
      const count = Array.isArray(items) ? items.length : 0

      // 挂载与刻度数变化时滚到底：默认高亮是最后一轮，滚在顶部就看不见它。
      useEffect(() => {
        scrollRailToBottom(railRef.current)
      }, [count])

      if (!Array.isArray(items) || items.length === 0) return null
      // 只有一个刻度且它已加载 = 没有可跳的目标（也没有更早的历史），不渲染。
      if (items.length < 2 && items.every((item) => item.loaded === true)) return null
      return h(
        'div',
        { className: 'dcf-rail-slot' },
        h(
          'div',
          { className: 'dcf-rail', ref: railRef, role: 'navigation', 'aria-label': t('flow.rail') },
          ...items.map((item) => {
            const busy = item.turn === busyTurn
            const label = t(item.loaded === true ? 'flow.rail.jump' : 'flow.rail.jumpLoad', { turn: item.turn })
            return h(
              'button',
              {
                key: String(item.turn),
                type: 'button',
                className: 'dcf-mark',
                'data-loaded': item.loaded === true ? 'true' : 'false',
                'data-busy': busy === true ? 'true' : 'false',
                'data-active': item.turn === activeTurn ? 'true' : 'false',
                'data-live': item.turn === liveTurn ? 'true' : 'false',
                'aria-busy': busy === true ? 'true' : undefined,
                'aria-current': item.turn === activeTurn ? 'true' : undefined,
                title: label,
                'aria-label': label,
                onClick: () => {
                  if (typeof onJump === 'function') onJump(item)
                },
              },
              h('span', { className: 'dcf-marknum' }, String(item.turn)),
              busy === true ? h('span', { className: 'dcf-spinner' }) : null,
            )
          }),
        ),
      )
    }
    /* ──────────────────────────── 任务主视图 ──────────────────────────── */

    /** 取整份快照的选择器：引用稳定，避免每次渲染都重新订阅。 */
    function identitySelector(value) {
      return value
    }

    /**
     * 空列表常量。
     *
     * ⚠️ 必须是**同一个引用**：选择器返回新建的 `[]` 会让 `useSyncExternalStore` 每帧都判定
     * 「快照变了」，进而在滚动/流式渲染时反复重渲染甚至自激。
     */
    const EMPTY_LIST = []

    /** `useSessions` 缺席时的替身：同一个渲染位置永远只调一次、返回 undefined，hook 顺序不变。 */
    function noSessions() {
      return undefined
    }

    /**
     * 每秒走一格的实时时钟（只在 `active` 为真时走）。
     *
     * 用途是「任务耗时实时统计」：回合还在跑时显示 `now - startedAt`，从 0 分 0 秒开始往上加；
     * 回合结束后渲染层改用派生层算好的固定耗时，这个定时器随之停掉（effect 的清理函数）。
     *
     * @param active - 是否需要计时。
     * @returns 当前时间戳（毫秒）。
     */
    function useTick(active) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        if (active !== true) return undefined
        setNow(Date.now())
        if (typeof setInterval !== 'function') return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /**
     * 原生座位的**主人参数**（owner props）。
     *
     * 这些参数是核心 `ChatNodeSeat` 在 `renderSlot('conversation.chat.node', routedOwner, …)` 时
     * 交给原生叶子的（`dsh-client-ui-chat/lib/client.js:1509-1553`，逐项来源见
     * `docs/references/core-seams.md` §13）。本视图自己画层级，就必须把同样的参数补齐，
     * 否则原生叶子在真机上会因为拿不到 `openFile` / `fileMentions` / `renderMessageImages`
     * 而在事件回调里抛错（点一下文件名、展开一条带附件的消息都会踩到）。
     *
     * 三项刻意留空：
     * - `selectedCallId`：核心用它高亮「详情」侧栏里选中的调用，本视图没有那个侧栏；
     * - `turnProcess`：核心的「过程折叠」控制器，本插件用自己的任务阶段折叠替代它；
     * - `cwd` 取不到时留空，原生叶子按原样使用路径。
     *
     * @param props - 本视图收到的插槽 props。
     * @param sessionId - 本视图所属会话。
     * @returns `{owner, renderSlot}`：`owner` 给原生叶子，`renderSlot` 给原生座位。
     */
    function useNativeSeat(props, sessionId) {
      const { renderSlot, openFile, forkAt, fileMentions, loadImage, openView, useSessions } = props
      const useSessionsSafe = typeof useSessions === 'function' ? useSessions : noSessions
      const cwd = useSessionsSafe((state) => (state?.byId === undefined ? undefined : state.byId[sessionId]?.cwd))
      return useMemo(
        () => ({
          renderSlot,
          owner: {
            cwd,
            selectedCallId: undefined,
            turnProcess: undefined,
            /**
             * 核心的实现是 `openView('trajectory', callId)`（`ui-chat:2020-2022`），
             * `openView` 由 `conversation.session` 作为 owner prop 交给视图条目。
             */
            inspectCall: (callId) => {
              if (typeof openView === 'function') openView('trajectory', callId)
            },
            openFile: typeof openFile === 'function' ? openFile : () => Promise.resolve(),
            forkAt: typeof forkAt === 'function' ? forkAt : () => {},
            fileMentions: typeof fileMentions === 'function' ? fileMentions : () => undefined,
            // 与核心同一行语义：把 owner 原样转交消息图片插槽，并补上 loadImage（`ui-chat:2059-2062`）。
            renderMessageImages:
              typeof renderSlot === 'function'
                ? (target) => renderSlot(NATIVE_IMAGES_SLOT, { ...target, loadImage })
                : undefined,
          },
        }),
        [renderSlot, cwd, openView, openFile, forkAt, fileMentions, loadImage],
      )
    }

    /**
     * 跳到某个回合（一次对话）的开头。
     *
     * ⚠️ **必须只滚会话体（`[data-conversation-scroll]`），绝不能用 `scrollIntoView`**
     * （用户报告过：点最后一个刻度会让整个界面连输入框一起上移半屏）。
     *
     * 原因是 shell 的结构与 CSS（`core-seams.md §7.1`）：
     * - 真正的滚动宿主是 `div.scrollBody[data-conversation-scroll]`，它里面**既有视图区也有输入框座位**
     *   （`composerSeat`），输入框靠 `position: sticky; bottom: 0` 钉在容器底部；
     * - `scrollIntoView` 会滚动**所有**可滚动祖先——包括 `overflow: hidden` 的盒子（脚本仍可滚它），
     *   而 shell 在 composer 浮层态正是把 `.viewArea` 设成 `overflow: hidden`。
     *   于是浏览器把外层盒子一起滚了，`sticky` 的参照系随之改变，界面连同输入框整体上移。
     *
     * 核心自己也是这么做的：`landOnRow` 直接算 `el.scrollTop += flowTop(row, el) - 24`（`CHAT:2154-2165`）。
     * 系统开了「减少动态效果」时用瞬时跳转，与 CSS 里的动效收敛保持一致。
     *
     * @param root - 本视图根节点。
     * @param turn - 目标回合号。
     * @returns 无。
     */
    function jumpToTurn(root, turn) {
      if (root === null || root === undefined || typeof root.querySelector !== 'function') return
      const target = root.querySelector(`[data-turn-anchor="${turn}"]`)
      if (target === null || typeof target.getBoundingClientRect !== 'function') return
      const scroller = scrollerOfView(root)
      if (scroller === null || typeof scroller.scrollTop !== 'number') return
      const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
      if (delta === 0) return
      const reduced =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
          : false
      const top = Math.max(0, scroller.scrollTop + delta)
      // `scrollTo` 支持平滑滚动，而且作用域就是这个元素——不会再牵扯外层盒子。
      if (typeof scroller.scrollTo === 'function') {
        scroller.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
        return
      }
      scroller.scrollTop = top
    }

    /**
     * 本视图所在的**会话滚动宿主**：`[data-conversation-scroll]`（shell 的 scrollBody）。
     *
     * 取不到时退化成父元素/自身：这样在测试与非常规装配下也拿得到一个可滚的盒子，
     * 而不是把动作交给 `scrollIntoView` 去滚整个文档。
     *
     * @param root - 本视图根节点。
     * @returns 滚动宿主，或 `null`。
     */
    function scrollerOfView(root) {
      if (root === null || root === undefined) return null
      const found = typeof root.closest === 'function' ? root.closest('[data-conversation-scroll]') : null
      return found ?? root.parentElement ?? root
    }

    /**
     * 任务视图主体（真正调用 hook 的地方）。
     *
     * 数据来源全部是**标准 props**，不读 DOM 取业务数据、不开自有数据通道：
     * - `useChat` 由 ui-chat 通过 `uiSession.provide({hooks:['chat']})` 提供，是整棵对话节点树；
     * - `useSession` 由 ui-session 内置源提供，用来判断 `running` / `hasMore` / `loadingOlder`；
     * - `t` 来自本条目声明的 `locale`；
     * - `loadOlder` 来自本条目自己的 `inject`。
     *
     * 布局分两层：外层是满宽块（承载右侧导轨的 sticky 槽），内层 `.dcf-main` 才是限宽阅读列。
     *
     * @param props - 见上。
     * @returns 任务流 + 右侧回合导轨。
     */
    function FlowBody(props) {
      const { sessionId, useChat, useSession, useProjection, t, loadOlder, loadThrough } = props
      const rootRef = useRef(null)
      const snapshot = useChat(identitySelector)
      const flow = useMemo(() => deriveFlow(snapshot), [snapshot])
      /**
       * 子代理结算通知（`subagent-settled`）——「子代理下拉」判 完成/失败/已中断 的唯一权威来源。
       *
       * 视图自己算一遍而不是复用 `deriveFlow` 的产物：派生层把通知按 `consumed` 标记消化进卡片，
       * 下拉菜单要的是**全量**（含已经并进卡片的那些），所以从同一棵节点树重新收敛更直白。
       */
      const agentNotices = useMemo(() => collectSubagentNotices(orderedNodes(snapshot)), [snapshot])
      const labels = useMemo(() => markdownLabels(t), [t])
      const session = useSession(identitySelector)
      const seat = useNativeSeat(props, sessionId)

      /**
       * 还没进入对话的用户消息（DSH 的「插队发送」/ 排队）。
       *
       * 选择器返回的必须是**稳定引用**（`state.queue` 本身或共享的空数组），否则 uSES 会自激。
       */
      const inbox = useSession((state) => (Array.isArray(state?.queue) ? state.queue : EMPTY_LIST))
      const submissions = useSession((state) =>
        Array.isArray(state?.pendingSubmissions) ? state.pendingSubmissions : EMPTY_LIST,
      )
      const pendingSeats = useMemo(() => pendingSeatsOf(inbox, submissions, snapshot), [inbox, submissions, snapshot])

      const running = session?.running === true
      /** 实时时钟：只有在跑的时候才每秒走一格（结束的回合用派生层算好的固定耗时）。 */
      const now = useTick(running)
      /**
       * 已加载的回合号（去重）。
       *
       * 同一个回合里可能因为**插队消息**而有多个分组（见 `deriveFlow`），导轨只需要一个刻度，
       * 所以这里去重；`liveTurn` 仍然按「最后一个分组」判定，但要用分组的 key 比较
       * （同一个回合里的前几个分组已经结束了，不该跟着一起算「正在跑」）。
       */
      const turns = useMemo(() => [...new Set(flow.turns.map((group) => group.turn))], [flow])
      const liveTurn = running && turns.length > 0 ? turns[turns.length - 1] : null
      const liveGroupKey = running && flow.turns.length > 0 ? flow.turns[flow.turns.length - 1].key : null
      /**
       * 窗口头部的 seq 代理值（核心同款）：取第一条可见节点的 `anchorSeq`。
       * 这不是真正的窗口起点 seq（`Session.baseSeq` 是私有的、不进快照），
       * 所以它只用来判断「目标 seq 是否可能已被窗口覆盖」，落位时还有兜底分支。
       */
      const firstSeq =
        snapshot.order.length === 0 ? null : (snapshot.nodes.get(snapshot.order[0])?.anchorSeq ?? null)

      /**
       * 导轨刻度 = `turnOutline` 投影（全集，含未加载回合）∪ 本视图已加载的回合。
       *
       * `turnOutline` 由 `dsh-session-turn-outline` 注册（key `turnOutline`，wire 值是数组，
       * 每项 `{turn, seq, prompt, response}`；`seq` 是该轮 `turn/start` 的 seq，即翻页目标）。
       * 投影缺失时退化成「只显示已加载的回合」。
       */
      const outline = typeof useProjection === 'function' ? useProjection('turnOutline') : undefined
      const railItems = useMemo(() => mergeRailItems(outline, turns), [outline, turns])

      const { activeTurn, busyTurn, onJump, requestLoadOlder } = useScroller(rootRef, {
        // 换会话要复位滚动记账（否则新会话会拿着旧会话的进度/锚点做决定，见 useScroller 的 F2 说明）。
        sessionId,
        turns,
        hasMore: session?.hasMore,
        loadingOlder: session?.loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
        // 首次挂载时让 rail 默认激活最后一个回合——视觉上「最末位始终是最新轮次」，
        // 与 rail 上 `data-active` 高亮配合，让用户一眼看到当前在最新回合。
        initialActiveTurn: turns.length > 0 ? turns[turns.length - 1] : null,
      })

      /**
       * 滚动位置：**切出去再切回来要回到原处**（用户报告过「切回对话会跳到已加载部分的顶部」）。
       *
       * 成因：DSH 内部切换会话/视图**不会改变 `document.visibilityState`**，而位置原来只挂在
       * `visibilitychange`/`beforeunload` 上——切出去时根本没记过；切回来时本视图是重新挂载的，
       * 而滚动宿主是 shell 的（`scrollTop` 从 0 开始），「已加载部分的顶部」就是这么来的。
       *
       * 现在的规则：
       * - 滚动过程中**持续**记录位置（锚在视口顶部那一行节点上，见 `readScrollState`）；
       * - 切出时任务在跑、切回来它已经结束 → 翻到底看最新输出（`SS_ENDED_AWAY` 记号）；
       * - 其余情况一律恢复切出时的位置（贴底的人自然还是贴底）；
       * - 任务在用户正看着时结束 → 直接翻到底（原有行为）。
       *
       * `visibilitychange`/`beforeunload` 仍然保留：切标签页、最小化、刷新、关页面
       * 都不会卸载组件，那些路径只能靠事件。sessionStorage 按 sessionId 隔离。
       */
      const SS_SCROLL = `dsh-chat-flow.scroll.${sessionId}`
      const SS_ENDED_AWAY = `dsh-chat-flow.ended-away.${sessionId}`

      /**
       * 最后一次量到的阅读位置。
       *
       * ⚠️ 卸载时不能再量：React **先**把 ref 摘掉、再跑 passive effect 的清理，
       * 那时 `rootRef.current` 已经是 `null`，所以只能把滚动过程中持续量到的快照写进存储。
       */
      const lastStateRef = useRef(null)

      /** 最近一次 `running`：离开与卸载都在闭包里处理，只有 ref 读得到当下值。 */
      const runningRef = useRef(running)
      runningRef.current = running

      /** 记住上一个 `running` 值，用来判断「离开期间状态是否变了」。 */
      const prevRunningRef = useRef(running)

      /** 记住视图在「离开」前是否可见（不在可见态时不重复翻）。 */
      const wasVisibleRef = useRef(isDocumentVisible())

      /** 量一次当前位置：更新内存快照 + 写 sessionStorage。 */
      const captureScroll = useCallback(() => {
        const root = rootRef.current
        const state = readScrollState(root, root ? scrollerOfView(root) : null)
        if (state === null) return
        lastStateRef.current = state
        try {
          sessionStorage.setItem(SS_SCROLL, encodeScrollState(state))
        } catch {
          // 隐私模式 / 配额满：位置记不住不影响使用。
        }
      }, [SS_SCROLL])

      /**
       * 挂载（以及**切换会话**）时把位置钉回去。
       *
       * 依赖 `[sessionId]` 而不是 `[]`：DSH 换会话时本视图可能只是换了 props。
       * 清理函数会把**离开的那个会话**的位置写进它自己的键（闭包里的 `sessionId` 还是旧值），
       * 新会话再从新键里读——两个会话互不串味。
       */
      useEffect(() => {
        lastStateRef.current = null
        const root = rootRef.current
        const scroller = root ? scrollerOfView(root) : null
        if (scroller !== null) {
          // 离开期间任务结束了 → 翻到底（这期间的新内容才是用户要看的）。
          const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'
          if (endedAway && runningRef.current === false) {
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
            restoreScrollState(root, scroller, bottomScrollState())
          } else {
            const saved = decodeScrollState(sessionStorage.getItem(SS_SCROLL))
            if (saved !== null) restoreScrollState(root, scroller, saved)
          }
        }
        return () => {
          // 切走 / 卸载：把最后一次量到的位置留给下一次挂载；当时还在跑就留个记号。
          const state = lastStateRef.current
          try {
            if (state !== null) sessionStorage.setItem(SS_SCROLL, encodeScrollState(state))
            if (runningRef.current === true) sessionStorage.setItem(SS_ENDED_AWAY, '1')
          } catch {
            // 同上：存储不可用就当作没有位置记录。
          }
        }
      }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

      // 切标签页 / 关页面不会卸载组件：这两条路径靠事件，动作与上面「离开 + 回来」一致。
      useEffect(() => {
        const handleLeave = () => {
          captureScroll()
          // 视图不可见时任务还在跑 → 留记号，回来时若它已结束就直接翻到底。
          if (isDocumentVisible() === false && runningRef.current === true) {
            try {
              sessionStorage.setItem(SS_ENDED_AWAY, '1')
            } catch {
              // 静默降级。
            }
          }
          wasVisibleRef.current = false
        }

        const handleActivate = () => {
          wasVisibleRef.current = true
          const root = rootRef.current
          const scroller = root ? scrollerOfView(root) : null
          if (scroller === null) return
          const endedAway = sessionStorage.getItem(SS_ENDED_AWAY) === '1'
          if (endedAway && runningRef.current === false) {
            // 任务在离开期间结束了 → 翻到底
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
            restoreScrollState(root, scroller, bottomScrollState())
            return
          }
          // 任务还在跑（或在可见时已结束）→ 恢复切出时的位置
          const saved = decodeScrollState(sessionStorage.getItem(SS_SCROLL))
          if (saved !== null) restoreScrollState(root, scroller, saved)
        }

        const handleVisibilityChange = () => {
          if (isDocumentVisible()) handleActivate()
          else handleLeave()
        }

        const handleBeforeUnload = () => {
          handleLeave()
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => {
          document.removeEventListener('visibilitychange', handleVisibilityChange)
          window.removeEventListener('beforeunload', handleBeforeUnload)
        }
      }, [sessionId, captureScroll])

      // `running` 从 true 变 false：在可见态下任务结束 → 直接翻到底
      useEffect(() => {
        if (prevRunningRef.current === true && running === false && wasVisibleRef.current === true) {
          const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
          if (scroller !== null) {
            scrollViewToBottom(scroller)
            sessionStorage.removeItem(SS_ENDED_AWAY)
            sessionStorage.removeItem(SS_SCROLL)
          }
        }
        prevRunningRef.current = running
      }, [running])

      /**
       * 快速回到底部按钮（`FloatingScrollButton`）。
       *
       * 逻辑：滚动宿主滚动超过 300px 时显示按钮；点击后滚动到最底部。
       * 只在任务进行中显示（结束后不需要快速回底，用户已能看到最新内容）。
       */
      const [showBottomBtn, setShowBottomBtn] = useState(false)

      /**
       * 会话列表快照：用来发现「已经被删掉的会话」。
       *
       * 核心没有会话删除事件，`useSessions` 是唯一可用的接缝（标准 props，官方 standardProps 清单里）。
       * 选择器返回整张快照而不是 `ids` 数组——返回新数组会让 uSES 自激。
       */
      const useSessionsSafe = typeof props.useSessions === 'function' ? props.useSessions : noSessions
      const sessionList = useSessionsSafe((state) => state)

      /**
       * 滚动监听：跟踪是否已远离底部（判据见 `isAwayFromBottom`），并**持续记录阅读位置**。
       *
       * 位置不能只在「离开事件」里记：DSH 内部换会话/换视图不触发 `visibilitychange`，
       * 那样切回来的时候存储里根本什么都没有。用 rAF 节流，一帧最多量一次。
       */
      useEffect(() => {
        const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
        if (scroller === null) return undefined
        let scheduled = false
        const handleScroll = () => {
          setShowBottomBtn(isAwayFromBottom(scroller))
          if (scheduled === true) return
          scheduled = true
          nextFrame(() => {
            scheduled = false
            captureScroll()
          })
        }
        scroller.addEventListener('scroll', handleScroll, { passive: true })
        handleScroll()
        return () => scroller.removeEventListener('scroll', handleScroll)
      }, [running, sessionId, captureScroll])

      /**
       * 会话被删除时，把本插件给那个会话留下的数据一起带走（localStorage 折叠状态 + sessionStorage 滚动记录）。
       *
       * 判据是「存储里有键、会话列表里没这个 id」（`staleSessionIds`），列表为空时不动手
       * （重连重拉会让列表短暂变空，那不是删除）；当前正在看的这个会话永远排除在外，
       * 因为刚建的空会话可能还没进列表。
       *
       * ⚠️ 这不是唯一一道网：`99-tail.js` 里还有一条**插件级**的同类清理，它不依赖本视图挂着
       * （用户可能在原生「对话」视图里删掉会话）。这里多做一件事——把「正在看的会话」也算作活着。
       */
      useEffect(() => {
        const ids = sessionList?.ids
        if (!Array.isArray(ids)) return
        const alive = new Set(ids)
        alive.add(sessionId)
        for (const stale of staleSessionIds(window, alive)) {
          purgeSessionData(stale, window)
          // 进程内折叠表是永不淘汰的缓存，删除会话时也要一起丢（见 30-collapse.js 的说明）。
          forgetCollapse(stale)
        }
      }, [sessionList, sessionId])

      /**
       * 快速回到底部按钮：固定在右下角，圆形箭头图标。
       * 视觉上在 rail 左侧，不遮挡内容。
       */
      const scrollToBottomButton = showBottomBtn && running === true
        ? h(
            'button',
            {
              key: 'scroll-to-bottom',
              type: 'button',
              className: 'dcf-scroll-bottom-btn',
              'aria-label': t('flow.scrollToBottom'),
              title: t('flow.scrollToBottom'),
              onClick: () => {
                const scroller = rootRef.current ? scrollerOfView(rootRef.current) : null
                scrollViewToBottom(scroller)
              },
            },
            h(
              'svg',
              {
                viewBox: '0 0 16 16',
                width: 16,
                height: 16,
                fill: 'currentColor',
                'aria-hidden': 'true',
              },
              h('path', { d: 'M8 12L2 6h3V2h6v4h3L8 12z' }),
            ),
          )
        : null

      const main = []
      if (session?.hasMore === true || session?.loadingOlder === true) {
        // 加载中显示动画而不是按钮：用户不需要点，滚到顶部就会自动开始加载。
        main.push(
          session.loadingOlder === true
            ? h(
                'div',
                { key: 'loading-older', className: 'dcf-loading', 'data-dcf-load-anchor': 'true' },
                h('span', { className: 'dcf-spinner' }),
                h('span', null, t('flow.loadingLocked')),
              )
            : h(
                'button',
                {
                  key: 'load-older',
                  type: 'button',
                  className: 'dcf-hint',
                  'data-dcf-load-anchor': 'true',
                  onClick: () => {
                    // 走与触顶完全同一条路径（F3）：手动加载同样要记锚点、记进度、清闸门。
                    // 直接调 `loadOlder()` 会绕过这三件记账——前插不补偿、补页不重试、连点并发。
                    requestLoadOlder()
                  },
                },
                t('flow.loadOlder'),
              ),
        )
      }
      if (flow.turns.length === 0) {
        main.push(h('div', { key: 'empty', className: 'dcf-empty' }, t('flow.empty')))
      }
      for (const group of flow.turns) {
        main.push(
          h(TurnGroup, {
            key: group.key,
            group,
            t,
            sessionId,
            labels,
            live: group.key === liveGroupKey,
            seat,
            now,
          }),
        )
      }
      // 还没进入对话的用户消息（插队 / 排队）：它们在节点树里还不存在，必须由视图自己显示，
      // 否则「我明明发了消息」在任务视图里看不到任何反应（核心在对话流末尾渲染同样这两串）。
      for (const pending of pendingSeats) {
        main.push(h(PendingBubble, { key: `pending:${pending.key}`, seat: pending, t }))
      }

      return h(
        'div',
        { className: 'dcf-root', ref: rootRef, 'data-chat-flow-owner': 'dsh-chat-flow' },
        h(SubagentBar, { seat: props.agentSeat ?? null, sessionId, t, notices: agentNotices }),
        h(TurnRail, { items: railItems, activeTurn, liveTurn, busyTurn, onJump, t }),
        scrollToBottomButton,
        h('div', { className: 'dcf-main' }, main),
      )
    }

    /**
     * 还没进入对话的那条用户消息（插队 / 排队 / 本地回显）。
     *
     * 三种状态各有一句话说明，这是用户要求「处理好插队发送消息的状态」的落点：
     * 消息不会再「发出去就没影了」——它在列表末尾有一个座位，并被明确标成「插队待处理」或「排队中」。
     *
     * `data-pending-steering` 是核心约定（它的待发送座位带这个属性，`CHAT:1224-1237`），
     * 外部的回退插件也按它找待发送座位（`dsh-rewind-plugin/lib/client.js:1114`）。
     *
     * @param props - `seat`（`{kind, key, text}`）、`t`。
     * @returns 待发送气泡行。
     */
    function PendingBubble({ seat, t }) {
      const steering = seat.kind === 'steering'
      return h(
        'div',
        {
          className: 'dcf-leaf dcf-pending',
          'data-pending-steering': steering === true ? 'true' : undefined,
          'data-submission-echo': steering === true ? undefined : 'true',
        },
        h(UserBubble, { text: seat.text, t }),
        h(
          'div',
          { className: 'dcf-pendingstate' },
          h(StatusChip, {
            tone: steering === true ? 'live' : 'muted',
            text: t(steering === true ? 'flow.pending.steering' : 'flow.pending.queued'),
          }),
        ),
      )
    }

    /**
     * 视图层错误边界：本插件自己这一侧的渲染错误**不再让整块视图让位**。
     *
     * 为什么必须有：本条目崩溃会被插槽判定为「让位」（`RENDERER:519-533` 的 abdicate），
     * 结果是整块对话区变成 `data-slot-error` 一直到刷新——用户看到的就是「任务视图莫名变白」。
     * 有了这一层，出错时只把错误摘要画出来（并留 `console.warn` 线索），视图其余部分与标签栏都还在。
     *
     * 注意：它接不住**事件回调与副作用里**抛出的错误（React 边界的固有限制），
     * 所以派生层与渲染层的取值一律写成防御式的。
     */
    class ViewBodyBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }

      static getDerivedStateFromError(error) {
        return { failed: true, message: error instanceof Error ? error.message : String(error) }
      }

      componentDidCatch(error) {
        console.warn('[chat-flow] 任务视图渲染失败，已降级为错误摘要（不再让整块视图让位）：', error)
      }

      /** 重试：清掉失败态让子树**重新挂载**（上一次失败的子树已经被卸载，重挂就是干净的）。 */
      retry() {
        this.setState({ failed: false, message: '' })
      }

      render() {
        if (this.state.failed !== true) return this.props.children
        const t = typeof this.props.t === 'function' ? this.props.t : (key) => key
        return h(
          'div',
          { className: 'dcf-error', 'data-dcf-error': this.state.message },
          h('div', { className: 'dcf-errortitle' }, t('flow.error.title')),
          h('pre', { className: 'dcf-pre' }, this.state.message),
          h('div', { className: 'dcf-note' }, t('flow.error.hint')),
          // 没有重试按钮时，一次瞬时异常（例如某个原生叶子在 `turnProcess === undefined`
          // 的上一帧抛错）会把整块视图锁死在错误摘要上，只能刷新页面——用户报的「任务视图莫名变白」。
          h(
            'button',
            {
              type: 'button',
              className: 'dcf-hint',
              'data-dcf-error-retry': 'true',
              onClick: () => this.retry(),
            },
            t('flow.error.retry'),
          ),
        )
      }
    }

    /**
     * 任务视图：`conversation.view` 的条目组件。
     *
     * 这一层只做两件事：能力探测（`useChat` 是 ui-chat 提供的，缺了就给空态而不是抛异常）
     * 与**错误边界**（自己的渲染错误降级成错误摘要，别让整块视图让位）。
     *
     * @param props - 插槽 kit + owner props。
     * @returns 任务视图。
     */
    function TaskFlowView(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      /**
       * 「子代理显示」开关。
       *
       * 席位在这里**整片**置空：`58-subagent.js` 的消费点是
       * `seatProp !== undefined ? seatProp : useContext(SubagentSeatContext)`，
       * 传 `null` 就是「明确没有席位」——子代理卡全部退化成不显示，但不影响
       * `props.agentSeat` 本身（捕获与注入照旧，这只是显示开关）。
       *
       * 必须在 `ready` 提前返回**之前**调用：hook 顺序不能随分支变化。
       */
      const ui = useUiFlags()
      const agentSeat = ui.subagent ? props.agentSeat ?? null : null
      const ready = typeof props.useChat === 'function' && typeof props.useSession === 'function'
      if (!ready) return h('div', { className: 'dcf-empty' }, t('flow.empty'))
      // 子代理席位（读子会话过程用，见 `58-subagent.js`）在这里注入一次，
      // 深处的子代理卡用 `useContext` 取——不为它逐层改 5 处组件签名。
      // 顺序是「边界在外、席位在内」：边界仍然包住整块视图主体（`TaskFlowView` 的返回值
      // 就是错误边界元素本身，视图层用例锁着这一点），而席位照样罩住所有叶子。
      return h(
        ViewBodyBoundary,
        { t },
        h(SubagentSeatContext.Provider, { value: agentSeat }, h(FlowBody, { ...props, t })),
      )
    }
    /* ──────────────────────────── 滚动行为 ──────────────────────────── */

    /** 距顶部多少像素以内算「触顶」。留一点余量，滚轮惯性到不了 0 也能触发。 */
    const TOP_LOAD_THRESHOLD_PX = 64

    /**
     * 距底部多少像素以内算「还在底部」。
     *
     * 超过它才需要「快速回到底部」按钮：几百像素的余量让「差一点点到底」不弹按钮，
     * 免得正常阅读时按钮一直闪。
     */
    const BOTTOM_THRESHOLD_PX = 300

    /**
     * 视口离开底部了吗（够不够格显示「快速回到底部」按钮）。
     *
     * 单独成函数是为了能直接测：按钮本身的显隐要靠真实的 scroll 事件，
     * 而滚动事件在 node 侧没有 DOM 就没有，判据却可以逐条断言。
     *
     * @param scroller - 滚动宿主（只看 `scrollTop` / `scrollHeight` / `clientHeight`）。
     */
    function isAwayFromBottom(scroller) {
      if (scroller === null || scroller === undefined) return false
      return scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - BOTTOM_THRESHOLD_PX
    }

    /**
     * 平滑滚到最底部。
     *
     * 「快速回到底部」按钮与「任务结束后自动跟到底」共用这一处：
     * 两处各写一遍 `scrollTo` 的话，改行为（比如换成 `auto`）必然会漏掉一处。
     *
     * @param scroller - 滚动宿主；为 `null` 时什么都不做（滚动宿主还没绑上去）。
     */
    function scrollViewToBottom(scroller) {
      if (scroller === null || scroller === undefined) return
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    }

    /** 行相对滚动宿主的位置：与页面整体滚动无关（核心 `flowTop` 同义，`CHAT:1895-1897`）。 */
    function flowTopOf(row, scroller) {
      return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    }

    /** 按节点 key 找已渲染的行（核心 `anchorElement` 同义，`CHAT:1867-1870`）。 */
    function anchorRowOf(root, key) {
      if (key === null || key === '') return null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        if (row.getAttribute('data-chat-anchor-key') === key) return row
      }
      return null
    }

    /**
     * 选一个稳定的锚点行：**视口顶部往下第一个可见节点行**（找不到就退化成第一行）。
     *
     * 为什么锚在「节点行」而不是「回合块」：加载历史时回合块会被整段重排，而节点行带
     * `data-chat-anchor-key`（核心同款属性），前插之后仍然唯一存在，才能把阅读位置钉回去。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns `{key, top}`，或没有任何节点行时 `null`。
     */
    function visibleAnchorOf(root, scroller) {
      const hostTop = scroller.getBoundingClientRect().top
      let first = null
      for (const row of root.querySelectorAll('[data-chat-anchor-key]')) {
        const key = row.getAttribute('data-chat-anchor-key')
        if (key === null || key === '') continue
        const top = flowTopOf(row, scroller)
        if (first === null) first = { key, top }
        if (row.getBoundingClientRect().top - hostTop >= 0) return { key, top }
      }
      return first
    }

    /**
     * 恢复阅读位置时最多重试多少帧。
     *
     * 视图切回来时节点是**异步**进树的：第一帧里 `scrollHeight` 往往还只有一屏，
     * 这时把 `scrollTop` 写成 30000 会被浏览器夹回 0——表现出来就是「切回来跳到已加载部分的顶部」。
     * 恢复必须逐帧重试，直到锚点行真的出现；90 帧 ≈ 1.5 秒，超过就当放弃（不再和用户抢滚动条）。
     */
    const SCROLL_RESTORE_MAX_FRAMES = 90

    /**
     * 一次触顶最多**连续补几页**。
     *
     * 核心的 `loadOlder()` 可能「成功 resolve，但什么都没加载」——真机上表现为
     * 「加载之后没有任何新内容」。三种成因（详见下面补页 effect 的注释）：请求赶在窗口安装完成前发出
     * 而拿回一页重复记录、会话绑定已释放导致注入层是静默 no-op、远端失败被核心吞掉。
     * 所以每次触顶给一笔补页预算：只要这次加载**既没让窗口头前进、也没多出回合**，就再补一页；
     * 预算用完就停并保持闸门未武装（等用户离开顶部再回来，或点按钮）。
     * 预算是硬的，所以不会退化成「一路把所有历史拉完」。
     */
    const MAX_CATCHUP_PAGES = 5

    /** 刻度跳转最多再翻几次（窗口头未知时也允许重试，避免「点了刻度毫无反应」）。 */
    const MAX_JUMP_REPAGES = 3

    /** 分页期间「钉住页面」的帧数上限（≈10 秒）：加载卡住时不能把页面永久冻住。 */
    const SCROLL_PIN_MAX_FRAMES = 600

    /** 文档当前是否可见。没有 `document`（node 侧渲染）时按「可见」处理。 */
    function isDocumentVisible() {
      if (typeof document === 'undefined' || document === null) return true
      return document.visibilityState !== 'hidden'
    }

    /** 下一帧；没有 `requestAnimationFrame` 就退化成 16ms 定时器，都没有就不再重试。 */
    function nextFrame(fn) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(fn)
        return
      }
      if (typeof setTimeout === 'function') setTimeout(fn, 16)
    }

    /**
     * 记下「现在读到哪儿」。
     *
     * ⚠️ 只记像素位置不够：切回来时窗口可能已经重新分页（更早的历史被前插进来），
     * 同一个 `scrollTop` 会落在完全不同的内容上。所以位置**锚在视口顶部那一行节点**上：
     * 记「哪一行 + 它相对视口顶的偏移」，恢复时按这一行重新算像素。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns `{atBottom, top, key, offset}`；根或宿主不在时 `null`。
     */
    function readScrollState(root, scroller) {
      if (root === null || root === undefined) return null
      if (scroller === null || scroller === undefined) return null
      const state = {
        atBottom: !isAwayFromBottom(scroller),
        top: Math.round(scroller.scrollTop),
        key: null,
        offset: 0,
      }
      const anchor = visibleAnchorOf(root, scroller)
      if (anchor !== null) {
        state.key = anchor.key
        state.offset = Math.round(anchor.top)
      }
      return state
    }

    /**
     * 把阅读位置钉回去，返回**是否已经钉住**。
     *
     * `false` 说明目标行还没进树，调用方下一帧再试（见 {@link SCROLL_RESTORE_MAX_FRAMES}）；
     * 一旦返回 `true` 就不要再调——否则会把用户这期间的手动滚动又拽回去。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @param state - {@link readScrollState} 的结果（或 {@link decodeScrollState} 解析出来的同形对象）。
     */
    function applyScrollState(root, scroller, state) {
      if (state === null || state === undefined) return true
      if (scroller === null || scroller === undefined) return true
      if (state.atBottom === true) {
        scroller.scrollTop = scroller.scrollHeight
        // 内容还没铺满一屏时「到底」是无意义的（被夹在 0），下一帧再看。
        return scroller.scrollHeight > scroller.clientHeight
      }
      const row = state.key === null || state.key === undefined ? null : anchorRowOf(root, state.key)
      if (row !== null) {
        scroller.scrollTop += flowTopOf(row, scroller) - state.offset
        return true
      }
      // 锚点行不在了（窗口整个换了一批）→ 退化成「按像素还原」，至少不比原来差。
      if (typeof state.top === 'number' && Number.isFinite(state.top) && state.top > 0) {
        scroller.scrollTop = state.top
        return true
      }
      return false
    }

    /** 逐帧重试直到钉住（内容异步进树，一帧往往不够）。 */
    function restoreScrollState(root, scroller, state) {
      let frames = 0
      const step = () => {
        if (applyScrollState(root, scroller, state) === true) return
        frames += 1
        if (frames >= SCROLL_RESTORE_MAX_FRAMES) return
        nextFrame(step)
      }
      step()
    }

    /** `{atBottom, top, key, offset}` → 存储字符串。 */
    function encodeScrollState(state) {
      if (state === null || state === undefined) return null
      return JSON.stringify(state)
    }

    /**
     * 存储字符串 → `{atBottom, top, key, offset}`。
     *
     * 兼容旧值：以前存的是**一个数字**（`String(scroller.scrollTop)`），
     * 按 `{top}` 处理，不能让升级前的记录直接作废。
     */
    function decodeScrollState(raw) {
      if (typeof raw !== 'string' || raw === '') return null
      const legacy = Number(raw)
      if (Number.isFinite(legacy)) return { atBottom: false, top: legacy, key: null, offset: 0 }
      let parsed = null
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      if (parsed === null || typeof parsed !== 'object') return null
      return {
        atBottom: parsed.atBottom === true,
        top: typeof parsed.top === 'number' && Number.isFinite(parsed.top) ? parsed.top : 0,
        key: typeof parsed.key === 'string' && parsed.key !== '' ? parsed.key : null,
        offset: typeof parsed.offset === 'number' && Number.isFinite(parsed.offset) ? parsed.offset : 0,
      }
    }

    /** 「贴到底」的位置状态（任务在离开期间结束时用它）。 */
    function bottomScrollState() {
      return { atBottom: true, top: 0, key: null, offset: 0 }
    }

    /**
     * 加载锚点（「加载更早的历史」按钮或加载提示）是不是还在视口里。
     *
     * 闸门用它而不是裸的 `scrollTop` 阈值：用户看到的就是最上面那个按钮——它露在视口里
     * 说明用户还在最顶上；它被推出视口上方，说明用户已经在读下面的内容，
     * 从这里开始算「离开顶部」，再滚回来才算一次新的触顶。
     *
     * @param root - 本视图根节点。
     * @param scroller - 滚动宿主。
     * @returns 锚点在视口内（或没有锚点时按像素阈值判断）为 `true`。
     */
    function isLoadAnchorVisible(root, scroller) {
      const anchor = root.querySelector('[data-dcf-load-anchor]')
      if (anchor === null) return scroller.scrollTop <= TOP_LOAD_THRESHOLD_PX
      return anchor.getBoundingClientRect().bottom >= scroller.getBoundingClientRect().top
    }

    /**
     * 绑定真实的滚动宿主，负责两件事：**触顶自动加载更早的历史**、**跟踪当前回合**。
     *
     * 几个必须说明的取舍：
     * 1. **滚动宿主是 shell 的，不是本视图的**。核心把会话体包在 `[data-conversation-scroll]`
     *    里（`ui-conversation` 的 scrollBody），所以这里用 `closest()` 向上找它，
     *    而不是自己再套一个滚动容器——套两层会出现嵌套滚动条。
     * 2. **防重复触发用「先离开顶部」的闸门**（`armedRef`），而不是时间冷却。
     *    加载后修正滚动位置本身会引起一次 scroll 事件，没有闸门就会自己触发自己，
     *    一路把所有历史拉完。闸门语义：只有「曾经滚到阈值以下、又回到顶部」才算一次新的触顶。
     * 3. **位置锚定**：加载更早的内容会把旧内容往下推。这里记住第一个回合元素的视口位置，
     *    内容变长后把差值补回 `scrollTop`，读者眼睛停在原处。
     *    如果浏览器原生 scroll anchoring 已经处理了，差值≈0，这一步就是空操作——两者不冲突。
     * 4. 度量放在 rAF 里做（一次滚动只量一帧），因为读 `getBoundingClientRect` 会强制布局。
     *
     * @param rootRef - 本视图根节点的 ref（滚动宿主由它向上找）。
     * @param options - `turns`（回合号数组）、`hasMore`、`loadingOlder`、`loadOlder`、`firstSeq`。
     * @returns `{activeTurn, busyTurn, onJump}`：当前视口顶部所在回合、正在加载的刻度、刻度点击。
     */
    function useScroller(rootRef, options) {
      const {
        turns = [],
        hasMore,
        loadingOlder,
        loadOlder,
        loadThrough,
        firstSeq,
        /**
         * 初始激活的回合号（由外层指定，如「rail 默认滚到底部」）。
         * 有值时：初始 `activeTurn` 直接用它；首次 measure 跳过（避免把顶部回合误设为激活）。
         */
        initialActiveTurn = null,
        /**
         * 当前会话 id。
         *
         * **换会话时必须把滚动记账全部复位**：这个 hook 的实例会被外层复用（见 `80-view.js` 的
         * 注释），而窗口头、锚点行、补页预算都是**上一个会话**的事实。不复位的话，新会话刚打开
         * 就可能拿着旧会话的进度去 `loadOlder`，或者按旧锚点把 `scrollTop` 拽到别处（F2）。
         * 不传时按 `null` 处理（单测里就是这种桩），退化成「永不复位」的旧行为。
         */
        sessionId = null,
      } = options
      const [activeTurn, setActiveTurn] = useState(initialActiveTurn)
      const [busyTurn, setBusyTurn] = useState(null)
      const [pendingJump, setPendingJump] = useState(null)
      const [settleTick, setSettleTick] = useState(0)
      /** 已用过 initialActiveTurn → 后续全走 measure。 */
      const usedInitialRef = useRef(initialActiveTurn !== null)
      /** 每次渲染刷新一次的最新值快照：事件监听只装一次，但要读到最新状态。 */
      const latest = useRef(options)
      latest.current = options
      const scrollerRef = useRef(null)
      const armedRef = useRef(true)
      const anchorRef = useRef(null)
      /** 上一个窗口头 seq：只有它变小（真的前插了）才做锚定补偿（核心同款，`CHAT:2227`）。 */
      const firstSeqRef = useRef(null)
      /** 防死循环：同一个窗口头只允许再翻一次（核心的 `jumpRepageHeadRef` 同款）。 */
      const repagedRef = useRef(null)
      /** 上一个 `loadingOlder`：用来在它落回 false 时补一次落位尝试。 */
      const wasPagingRef = useRef(options.loadingOlder === true)
      /** 本次触顶还剩几页补页预算（> 0 时才允许继续补页）。 */
      const catchupRef = useRef(0)
      /** 触发这次加载时的基线（窗口头 seq + 已加载回合数）：没进展就一直补页。 */
      const progressRef = useRef(null)
      /** 刻度跳转在同一个窗口头上已经补翻过几次。 */
      const repageAttemptsRef = useRef(0)
      /**
       * 加载落地后强制算一次「有没有进展」。
       *
       * 不能只靠渲染驱动：注入层的 `loadOlder` 可能是**静默 no-op**（会话绑定已释放），
       * 那条路径上不会引起任何 props 变化，光等渲染永远等不到——这正是「卡住不动」的形状。
       */
      const [loadTick, setLoadTick] = useState(0)
      /**
       * 正在为一次刻度跳转翻页（还在飞）吗？
       *
       * `onJump` 与落位 effect 都会调 `loadThrough`，而「窗口头已覆盖目标」的判据在 promise
       * 落地前通常还是 false，于是同一次跳转会**连发两次**（F4）。记下「有一发在飞」，
       * 落地（成功、失败或同步抛）后清空，期间落位 effect 只等不重试。
       */
      const jumpFlightRef = useRef(null)
      /** 会话标识：只在它真的变化时才复位记账（首挂载不复位，保持原有首屏行为）。 */
      const sessionKey = options.sessionId ?? null
      const lastSessionRef = useRef(sessionKey)

      /**
       * 发一次加载，并在**它落地之后**重算「有没有进展」。
       *
       * `loadOlder` 的返回值在真机上是 promise（核心的 `loadOlder` 是 async），
       * 但它**永不 reject**，失败也是 resolve——所以这里只把它当作「可以再算一次」的信号，
       * 绝不把「resolve 了」当成「加载成功了」。返回值不是 promise 时立刻算一次（单测里就是这种桩）。
       */
      const startLoad = useCallback((loader) => {
        let result = null
        try {
          result = loader()
        } catch {
          result = null
        }
        const done = () => setLoadTick((tick) => tick + 1)
        if (result !== null && result !== undefined && typeof result.then === 'function') result.then(done, done)
        else done()
      }, [])

      /**
       * 记下「现在读到哪儿」：锚点行 + 它相对滚动口的偏移，外加当时的 `scrollHeight`。
       *
       * `scrollHeight` 是给「锚点行整个被换掉」时兜底用的：那时只能按前插撑高的像素补回去
       * （F5，与 {@link applyScrollState} 的像素兜底同一思路）。
       */
      const recordAnchor = useCallback((root, scroller) => {
        if (root === null || root === undefined || scroller === null || scroller === undefined) {
          anchorRef.current = null
          return
        }
        const anchor = visibleAnchorOf(root, scroller)
        anchorRef.current = anchor === null ? null : { key: anchor.key, top: anchor.top, height: scroller.scrollHeight }
      }, [])

      /**
       * 触顶与手动按钮**共用**的「记账 + 发一次加载」（F3）。
       *
       * 手动按钮必须走这一条：只调用 `loadOlder()` 会绕过锚点/进度/闸门三件记账，
       * 结果是前插不补偿（页面跳）、补页不生效（静默 no-op 不重试）、连点还会并发加载。
       */
      const armLoad = useCallback(
        (root, scroller) => {
          const state = latest.current
          if (state.hasMore !== true || state.loadingOlder === true) return
          if (typeof state.loadOlder !== 'function') return
          recordAnchor(root, scroller)
          progressRef.current = {
            firstSeq: state.firstSeq ?? null,
            turns: Array.isArray(state.turns) ? state.turns.length : 0,
          }
          catchupRef.current = MAX_CATCHUP_PAGES
          armedRef.current = false
          startLoad(state.loadOlder)
        },
        [recordAnchor, startLoad],
      )

      /** 手动「加载更早的历史」按钮的入口：与触顶完全同一条路径（F3）。 */
      const requestLoadOlder = useCallback(() => {
        armLoad(rootRef.current, scrollerRef.current)
      }, [armLoad, rootRef])

      /**
       * 发一次「翻到 seq」，并在它**落地之后**补算一次落位。
       *
       * `loadThrough` 的 promise **永不 reject**（失败也 resolve），但真机上也可能同步抛错；
       * 而它一旦 reject 就是一条无人处理的 unhandled rejection，并且 `settleTick` 永不前进、
       * 刻度永久停在加载态（F1）。这里统一：同步抛 → 记一条 warn；promise → 成功失败都算落地。
       */
      const jumpLoad = useCallback((seq) => {
        const done = () => {
          jumpFlightRef.current = null
          setSettleTick((tick) => tick + 1)
        }
        let result = null
        try {
          result = latest.current.loadThrough(seq)
        } catch (error) {
          if (typeof console !== 'undefined') console.warn('[chat-flow] 翻页调用抛错', error)
          done()
          return
        }
        if (result !== null && result !== undefined && typeof result.then === 'function') result.then(done, done)
        else done()
      }, [])

      /**
       * 换会话：把所有滚动记账复位（F2/F6）。
       *
       * 这个 effect 必须声明在下面那些消费记账的 effect **之前**——同一个提交里 effect 按声明顺序跑，
       * 复位先跑，后面的补页/落位才不会拿着上一个会话的进度做决定。
       * 首挂载不动（`lastSessionRef` 挡住），以免改变原有首屏行为。
       */
      useEffect(() => {
        if (lastSessionRef.current === sessionKey) return
        lastSessionRef.current = sessionKey
        armedRef.current = true
        anchorRef.current = null
        firstSeqRef.current = null
        repagedRef.current = null
        repageAttemptsRef.current = 0
        wasPagingRef.current = latest.current.loadingOlder === true
        catchupRef.current = 0
        progressRef.current = null
        jumpFlightRef.current = null
        // 换会话后要重新量一次：不要留着上一个会话的激活刻度（F6）。
        usedInitialRef.current = true
        setActiveTurn(latest.current.initialActiveTurn ?? null)
        setBusyTurn(null)
        setPendingJump(null)
      }, [sessionKey])

      useEffect(() => {
        const root = rootRef.current
        if (root === null || root === undefined || typeof root.closest !== 'function') return undefined
        const scroller = root.closest('[data-conversation-scroll]') ?? root.parentElement ?? root
        scrollerRef.current = scroller
        let frame = 0

        const measure = () => {
          frame = 0
          const anchors = root.querySelectorAll('[data-turn-anchor]')
          if (anchors.length === 0) return
          const hostTop = scroller.getBoundingClientRect().top
          let current = Number(anchors[0].getAttribute('data-turn-anchor'))
          for (const anchor of anchors) {
            if (anchor.getBoundingClientRect().top - hostTop > TOP_LOAD_THRESHOLD_PX) break
            current = Number(anchor.getAttribute('data-turn-anchor'))
          }
          setActiveTurn((previous) => (previous === current ? previous : current))
        }

        const onScroll = () => {
          if (frame === 0 && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(measure)
          else measure()

          // 闸门用「加载锚点（按钮或加载提示）还在不在视口里」判定：
          // 锚点滚出视口（用户在读下面的内容）→ 重新武装；锚点回到视口（用户滚到最上面）
          // → 触发一次加载。这比裸的 scrollTop 阈值更贴近用户看到的东西。
          if (isLoadAnchorVisible(root, scroller) !== true) {
            armedRef.current = true
            return
          }
          if (armedRef.current !== true) return
          // 记账（锚点 + 进度 + 补页预算）与发加载都在 armLoad 里，与手动按钮共用同一条路径（F3）。
          armLoad(root, scroller)
        }

        // 有 initialActiveTurn 时首次不 measure：外层已经把激活回合定死在最后一个（导轨默认滚到底），
        // 这里再量一次会把**顶部的**回合误设成激活。之后再绑定时正常 measure。
        if (usedInitialRef.current === true) measure()
        else usedInitialRef.current = true
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => {
          scroller.removeEventListener('scroll', onScroll)
          scrollerRef.current = null
          if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        }
      }, [rootRef, sessionKey, armLoad])

      /**
       * 前插之后把阅读位置钉回原处（见上文第 3 点）。
       *
       * **触发条件是「窗口头真的往前挪了」**（`firstSeq` 变小），而不是「渲染了一次」：
       * 这正是核心的做法（`CHAT:2227-2231`：`anchorRef !== null && firstSeq < firstSeqRef.current`）。
       * 早期版本一渲染就把锚点消费掉，于是「加载开始」那一刻就把锚点清了，
       * 等内容真正前插进来时已经没有锚点可用——用户看到的就是**加载完页面跳一下**。
       *
       * 一页加载可能包含多页（`loadThrough` 会循环），所以补偿之后如果还在加载中，
       * 就按当前位置重新记一次锚点，让下一批前插继续钉住同一个节点。
       */
      useEffect(() => {
        const firstSeq = options.firstSeq
        const previous = firstSeqRef.current
        const anchor = anchorRef.current
        if (anchor !== null && firstSeq !== null && previous !== null && firstSeq < previous) {
          const root = rootRef.current
          const scroller = scrollerRef.current
          if (root !== null && root !== undefined && scroller !== null) {
            const row = anchorRowOf(root, anchor.key)
            if (row !== null) {
              const delta = flowTopOf(row, scroller) - anchor.top
              if (delta !== 0) scroller.scrollTop += delta
              anchorRef.current =
                options.loadingOlder === true
                  ? { key: anchor.key, top: flowTopOf(row, scroller), height: scroller.scrollHeight }
                  : null
            } else {
              // 锚点行整个被换掉了（一次前插翻过了它）：至少把这次撑高的那部分补回去，
              // 别把读者顶走（F5；{@link applyScrollState} 在同情况下退回像素还原）。
              if (typeof anchor.height === 'number' && Number.isFinite(anchor.height)) {
                const grew = scroller.scrollHeight - anchor.height
                if (grew > 0) scroller.scrollTop += grew
              }
              anchorRef.current = null
            }
          }
        }
        firstSeqRef.current = firstSeq
      }, [rootRef, options.firstSeq, options.loadingOlder])

      /**
       * 分页期间**把页面钉住**（用户要求「加载过程中不要发生跳变，可以不允许滚动操作」）。
       *
       * 做法是每帧把锚点行拉回它被记录时的视口位置：内容前插造成的位移被立刻补掉，
       * 用户在这几帧里的滚动输入也会被同一帧纠回，于是页面在加载期间看起来是**冻住**的；
       * `loadingOlder` 落回 false 时 effect 清理，一切交还用户。
       *
       * 为什么不用 `overflow: hidden` 去锁滚动条：那是 shell 的滚动容器，隐藏溢出会让经典滚动条
       * 消失、内容宽度变化十几个像素，反而制造一次横向跳动；逐帧钉住没有任何布局副作用。
       *
       * 帧数上限（`SCROLL_PIN_MAX_FRAMES`）是安全阀：核心的加载有一次彻底卡住不落回 false 的可能，
       * 那时钉住循环会把页面永久冻住——宁可放弃钉住，也不能让视图变成不能滚动的死页面。
       */
      useEffect(() => {
        if (options.loadingOlder !== true) return undefined
        if (typeof requestAnimationFrame !== 'function') return undefined
        let frame = 0
        let frames = 0
        const pin = () => {
          frames += 1
          if (frames > SCROLL_PIN_MAX_FRAMES) return
          frame = requestAnimationFrame(pin)
          const root = rootRef.current
          const scroller = scrollerRef.current
          const anchor = anchorRef.current
          if (root === null || root === undefined || scroller === null || anchor === null) return
          const row = anchorRowOf(root, anchor.key)
          if (row === null) return
          const delta = flowTopOf(row, scroller) - anchor.top
          if (delta !== 0) scroller.scrollTop += delta
        }
        frame = requestAnimationFrame(pin)
        return () => cancelAnimationFrame(frame)
      }, [rootRef, options.loadingOlder])

      /**
       * **补页**：触顶发出的加载如果没带来任何新内容，就继续补页（预算见 `MAX_CATCHUP_PAGES`）。
       *
       * 为什么必须有这一段——核心的 `loadOlder()` 会「成功 resolve 但什么都没加载」，三种成因：
       * 1. 请求赶在窗口安装完成前发出。核心用 `baseSeq` 当游标，而 `baseSeq` 的推进在
       *    `prependWindow` 里、是**异步**的；于是同一次触顶的第二次请求可能拿回**和上次完全一样的一页**，
       *    组装器按 `event.seq` 去重（`inputs.has(seq)`）后一条 fresh 都没有 → `publication = 'none'`
       *    → **界面上什么都不会出现**。
       * 2. 会话绑定已经被释放（`ctx.sessions.binding()` 取不到）→ 注入层那个 `loadOlder` 是
       *    **静默 no-op**，连 promise 都没有，点了/触顶了都不会有任何变化。
       * 3. 远端失败被核心的 `isRemoteFailure` 分支吞掉（只 `console.error`）。
       *
       * 三种情况的共同表现就是用户报的「加载之后没有任何新内容，加载了一段时间后没有加载出任何内容」，
       * 而且闸门此时已经放下（`armedRef = false`），用户停在最顶上再怎么滚都不会再触发。
       * 这里只看两个渲染事实判断有没有进展：**窗口头 seq 变小**、或**已加载回合数变多**。
       * 预算是硬的，用完就停并保持未武装；用户滚下去读内容（锚点离开视口）时立刻让位并重新武装。
       */
      useEffect(() => {
        if (catchupRef.current <= 0) return
        const state = latest.current
        // 还在加载中：等它落回 false，那时这个 effect 还会再跑一次。
        if (state.loadingOlder === true) return
        const giveUp = (rearm) => {
          catchupRef.current = 0
          progressRef.current = null
          if (rearm === true) armedRef.current = true
        }
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return giveUp(false)
        // 用户已经在读下面的内容：补页让位，等他再滚回顶部（那时算一次新的触顶）。
        if (isLoadAnchorVisible(root, scroller) !== true) return giveUp(true)
        const base = progressRef.current
        const firstSeq = state.firstSeq ?? null
        const turnCount = Array.isArray(state.turns) ? state.turns.length : 0
        if (base === null) return giveUp(false)
        const advancedHead = firstSeq !== null && (base.firstSeq === null || firstSeq < base.firstSeq)
        const grew = turnCount > base.turns
        if (advancedHead === true || grew === true) return giveUp(false)
        if (state.hasMore !== true || typeof state.loadOlder !== 'function') return giveUp(false)
        catchupRef.current -= 1
        startLoad(state.loadOlder)
      }, [rootRef, options.firstSeq, options.turns, options.loadingOlder, loadTick])

      /**
       * 点一个刻度。
       *
       * 已加载 → 直接滚过去；未加载 → 记下目标（`pendingJump`）并把刻度置为加载态，
       * 然后 `loadThrough(seq)` 翻页。**完成判定不靠 promise**（它永不 reject，失败也 resolve），
       * 而靠「目标回合变成了已加载」这个渲染事实（见下面的落位 effect）。
       */
      const onJump = useCallback(
        (item) => {
          if (item === null || typeof item !== 'object') return
          if (item.loaded === true) {
            jumpToTurn(rootRef.current, item.turn)
            return
          }
          const loadThrough = latest.current.loadThrough
          if (typeof loadThrough !== 'function' || item.seq === null) return
          recordAnchor(rootRef.current, scrollerRef.current)
          repagedRef.current = null
          repageAttemptsRef.current = 0
          setBusyTurn(item.turn)
          setPendingJump({ turn: item.turn, seq: item.seq })
          // 记「这一发在飞」：落位 effect 就不会对同一个目标再发一次（F4）。
          jumpFlightRef.current = item.seq
          jumpLoad(item.seq)
        },
        [jumpLoad, recordAnchor, rootRef],
      )

      // `loadThrough` 在 `loadingOlder` 已被普通加载占用时会**立即 resolve 而不排队**，
      // 所以必须在它落回 false 时再补一次落位尝试（核心用同样的 tick 机制）。
      useEffect(() => {
        const paging = options.loadingOlder === true
        if (wasPagingRef.current === true && paging === false && pendingJump !== null) {
          setSettleTick((tick) => tick + 1)
        }
        wasPagingRef.current = paging
      }, [options.loadingOlder, pendingJump])

      /**
       * 落位：目标回合一渲染出来就滚到它。
       *
       * 三层兜底（顺序与核心一致）：① 目标回合已是已加载且能找到锚点 → 落位收尾；
       * ② 窗口还没覆盖目标 seq → 允许**再翻几次**（同一个窗口头有界重试，防死循环，见 `MAX_JUMP_REPAGES`）；
       * ③ 都失败时退化成「滚到第一个 turn ≥ 目标的回合」，连它都找不到就留一条 warn。
       */
      useEffect(() => {
        if (pendingJump === null) return
        const root = rootRef.current
        const scroller = scrollerRef.current
        if (root === null || root === undefined || scroller === null) return
        const land = (row) => {
          const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - RAIL_LAND_OFFSET_PX
          if (delta !== 0) scroller.scrollTop += delta
        }
        const settle = () => {
          setPendingJump(null)
          setBusyTurn(null)
        }
        const row = root.querySelector(`[data-turn-anchor="${pendingJump.turn}"]`)
        if (row !== null) {
          land(row)
          settle()
          return
        }
        const state = latest.current
        const head = state.firstSeq
        // 上一发翻页（`onJump` 起的，或本 effect 上一轮起的）还没落地：等它落地后会再跑一遍，
        // 期间绝不重复发起——否则「同一刻度连发两次 loadThrough」（F4）。
        if (jumpFlightRef.current !== null) return
        // 窗口还没覆盖目标 seq（**窗口头未知时也当作没覆盖**）→ 再翻一次。
        // 早期版本这里在 `firstSeq === null` 时直接跳过再翻页这条路，于是「首节点取不到 anchorSeq」
        // 的会话里点导轨刻度会毫无反应（落位失败也没人补），所以改成：有界重试（同一个窗口头最多
        // 再翻 `MAX_JUMP_REPAGES` 次），窗口头未知也照试。次数是硬的，不会退化成死循环。
        const covered = head !== null && head !== undefined && head <= pendingJump.seq
        if (state.hasMore === true && covered !== true && typeof state.loadThrough === 'function') {
          if (state.loadingOlder === true) return
          const attempts = repagedRef.current === head ? repageAttemptsRef.current : 0
          if (attempts < MAX_JUMP_REPAGES) {
            repagedRef.current = head
            repageAttemptsRef.current = attempts + 1
            jumpFlightRef.current = pendingJump.seq
            jumpLoad(pendingJump.seq)
            return
          }
        }
        const rows = root.querySelectorAll('[data-turn-anchor]')
        let landed = false
        for (const candidate of rows) {
          const turn = Number(candidate.getAttribute('data-turn-anchor'))
          if (Number.isSafeInteger(turn) && turn >= pendingJump.turn) {
            land(candidate)
            landed = true
            break
          }
        }
        // 连兜底都没找到：不要静默「当作成功」。真机上这就是「点了刻度没反应」，
        // 留一条 warn 让下次排查有据可查（客户端没有别的留痕渠道）。
        if (landed !== true && typeof console !== 'undefined') {
          console.warn('[chat-flow] 跳转回合失败：翻页后窗口里仍找不到该回合', {
            turn: pendingJump.turn,
            seq: pendingJump.seq,
            firstSeq: head,
            hasMore: state.hasMore,
          })
        }
        settle()
      }, [settleTick, pendingJump, rootRef, jumpLoad])

      return { activeTurn, busyTurn, onJump, requestLoadOlder }
    }
    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册任务视图。
     *
     * **视图内容分两层**：
     * - **层级是插槽的**：回合分组 / 任务阶段折叠 / 任务列表快照 / 子任务 / 右侧导轨，全部由本插件画；
     * - **叶子是核心的**：每一行节点都经 `renderSlot('conversation.chat.node', …)` 交给核心的原生
     *   条目渲染（命令卡、差异块、读取块、搜索块、提问卡、思考行…），只有座位缺席或渲染失败时才
     *   退化成自绘叶子（见 `lib/client/55-native.js`）。
     *
     * 声明 `children` 有两层作用：一是渲染器**只有看到 children 才会给出 `renderSlot`**
     * （`dsh-client-ui-renderer/lib/client.js:613-621`），二是顺带拿到会话作用域的 `SessionProvider`。
     * 详见 {@link nativeViewChildren} 里的注释（含核心行号依据）。
     *
     * **为什么用独立 id（不再遮蔽核心「对话」）**：视图选择的 fallback 硬编码为
     * 「存储的偏好 → `id === 'chat'` → 否则不渲染」。遮蔽（同 id + 更低 priority）能让本视图
     * 成为默认，但核心条目仍在账本里，而标签栏读的正是账本 → 两个标签、两个都带激活下划线。
     * 核心**不允许注销别人的条目**，所以遮蔽必然留下重复标签；改用独立 id 后标签栏只有一个高亮，
     * 原生「对话」仍是默认，需要任务流时点「任务」标签（选择持久化）。
     *
     * @param ctx - 客户端插件上下文。
     * @param bridge - 核心组递进来的接缝：`{ flagsStore, FLAGS_FALLBACK }`（可能不传，见 `00-head.js`）。
     * @returns 无。
     */function apply(ctx, bridge) {
      // 接上界面开关通道（任务页面 / 子代理显示）。没传就保持 `00-head.js` 里的空实现。
      if (bridge !== undefined && bridge !== null) {
        const store = bridge.flagsStore
        if (store !== undefined && store !== null && typeof store.subscribe === 'function') {
          uiFlagsBridge.read = () => store.value
          uiFlagsBridge.subscribe = (listener) => store.subscribe(listener)
        }
        const fallbackUi = bridge.FLAGS_FALLBACK?.ui
        if (fallbackUi !== undefined && fallbackUi !== null) {
          uiFlagsBridge.fallback = {
            taskView: fallbackUi.taskView !== false,
            subagent: fallbackUi.subagent !== false,
          }
        }
      }
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-flow: dictionaries')
      const t = ctx.locale.bind(NS)

      /**
       * 会话被删掉之后，把本插件给那个会话留下的存储痕迹一起带走。
       *
       * **为什么挂在插件级而不是任务视图里**：视图级的清理只在「任务」标签页挂着时跑，
       * 而用户完全可能在原生「对话」视图（或根本没打开任何一个会话）里删掉某个会话——
       * 那时残留的 `localStorage` 折叠表与 `sessionStorage` 滚动记录会一直留着。
       * 这里直接盯会话列表快照：会话列表是唯一能观察到「某个 id 已经不在世上」的接缝
       * （核心没有删除事件，只有 `api-session/removed`，那只有列表被踢掉之后才来）。
       *
       * **代价说清楚**：判据是「存储里有键、列表里没这个 id」（`staleSessionIds`），
       * 它自带「列表为空一律不动手」的护栏（重连时列表会短暂变空，那不是删除）。
       * 极端情况下（会话还活着、但这一轮快照里恰好没有它）会误清一份 UI 状态——
       * 本插件只存折叠与滚动位置，误清最多是观感回退；相比之下「删了会话却留下痕迹」
       * 是用户明确要求避免的（「删除要彻底移除文件，不留残余」）。
       *
       * @returns 取消订阅的函数。
       */
      ctx.effect(() => {
        const list = ctx.sessions?.list
        if (list === undefined || list === null || typeof list.subscribe !== 'function') return () => {}
        const sweep = () => {
          const snapshot = typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
          const ids = snapshot?.ids
          if (!Array.isArray(ids)) return
          for (const stale of staleSessionIds(window, new Set(ids))) {
            purgeSessionData(stale, window)
            forgetCollapse(stale)
          }
        }
        const unsubscribe = list.subscribe(sweep)
        sweep()
        return typeof unsubscribe === 'function' ? unsubscribe : () => {}
      }, 'chat-flow: purge deleted sessions')

      /**
       * 「任务页面」开关：**注册 / 注销整条视图条目**，而不是把视图画成空壳。
       *
       * 为什么选注销：视图选择的回退是平台自己做的——`resolveActiveView` 是
       * 「存的偏好 → 找不到 → `id === 'chat'`」（`dsh-client-ui-conversation/lib/client.js:16385`），
       * 条目一旦从账本里摘掉，同一帧就落回原生「对话」，标签栏也不会留下一个点进去空白的页。
       * 只把内容藏起来的话标签还在、点进去是空白，那更像是坏了。
       *
       * 三件事必须对上，缺一个就会报 `slot ... is not declared` 或留下重复条目：
       * 1. **槽先声明**：`ctx.slots.register` 在 `conversation.view` 被父级条目声明之前会抛，
       *    所以注册必须发生在 `slots.inject` 的回调里（声明就绪后执行，声明塌掉时收尾）。
       * 2. **开关后到**：`apply` 时 host 的 `/flags` 可能还没回来，那时按兜底值（开）先挂上，
       *    等真实值到了再对齐——所以这里订阅 store，而不是只在 apply 里读一次。
       * 3. **幂等**：`mountView` 只在「槽已就绪」且「当前没挂」时注册，`unmountView` 只在挂着时注销。
       */
      let viewSlotReady = false
      let disposeView = null
      const unmountView = () => {
        const dispose = disposeView
        disposeView = null
        if (typeof dispose === 'function') dispose()
      }
      const mountView = () => {
        if (!viewSlotReady || disposeView !== null) return
        if (!uiFlags().taskView) return
        disposeView = ctx.slots.register(
          {
            name: 'conversation.view',
            id: TAB_VIEW_ID,
            order: TAB_VIEW_ORDER,
            label: () => t('view.flow'),
            locale: NS,
            children: nativeViewChildren(),
            inject: (sessionId) => ({
              sessionId,
              /**
               * 拉更早的历史页。
               *
               * **必须把核心的 promise 交出去**（返回它），不能吞掉：滚动层靠「这次加载落地之后
               * 窗口有没有真的变长」来决定要不要继续补页，而核心的 `loadOlder` 可能在
               * 「什么都没加载」的情况下照样 resolve（请求赶在窗口安装前发出 → 拿回一页重复记录
               * → 组装器按 seq 去重 → 界面纹丝不动）。吞掉返回值，滚动层就失去了唯一的落地信号，
               * 只能等下一次无关的渲染，于是表现为用户报的「加载之后没有任何新内容」。
               *
               * 仍然**不抛异常**：会话 binding 可能已经释放（切走会话的竞态），
               * 取不到时返回一个已 resolve 的 promise，让滚动层的补页预算去处理这种「空转」。
               *
               * @returns 加载落地的 promise（永不 reject），仅供「落地后重算」使用，成功与否要回看窗口。
               */
              loadOlder: () => {
                try {
                  return ctx.sessions.binding(sessionId)?.session.loadOlder() ?? Promise.resolve()
                } catch {
                  // 会话已释放：返回已 resolve 的 promise，调用方按「没加载到」处理。
                  return Promise.resolve()
                }
              },
              /**
               * 翻页加载到指定 seq（导轨点未加载回合用）。
               *
               * 与 `loadOlder` 的差别：它内部**循环**加载直到窗口覆盖该 seq（每页 200 条），
               * 全程把 `loadingOlder` 置真，且返回的 promise **永不 reject**（失败也 resolve）。
               * 因此调用方不能拿「promise 完成」当成功，必须回看目标回合是否已加载。
               */
              loadThrough: (seq) => {
                try {
                  return ctx.sessions.binding(sessionId)?.session.loadThrough(seq) ?? Promise.resolve()
                } catch {
                  // 会话已释放：立即 resolve，调用方按「没加载到」处理。
                  return Promise.resolve()
                }
              },
              // 原生叶子需要的主人/注入能力（openFile / loadImage / fileMentions / forkAt）。
              ...nativeSeatFace(ctx, sessionId),
              /**
               * 子代理席位：给子代理卡内联读「子会话自己的过程」用（见 `58-subagent.js`）。
               *
               * 放在这里而不是 `nativeSeatFace` 里：后者是「原生叶子需要的主人参数」，
               * 这一项只服务本插件自绘的子代理卡。
               */
              agentSeat: subagentSeatFace(ctx, sessionId),
            }),
          },
          TaskFlowView,
        )
      }
      /** 按当前开关对齐一次：开 → 挂上，关 → 摘掉（幂等）。 */
      const syncView = () => {
        if (uiFlags().taskView) mountView()
        else unmountView()
      }
      // 槽声明就绪 → 按开关挂上；声明塌掉（父级条目注销）→ 跟着收尾。
      ctx.slots.inject('conversation.view', () => {
        viewSlotReady = true
        syncView()
        return () => {
          viewSlotReady = false
          unmountView()
        }
      })
      // 开关变化：host 首次答 `/flags`、用户在设置里改、保存后强制刷新，都走这条。
      ctx.effect(() => uiFlagsBridge.subscribe(syncView), 'chat-flow: task view switch')
    }

    exports.apply = apply
    exports.inject = inject
    /**
     * 测试接缝：纯函数与常量直接暴露，node 侧测试不必模拟整套插槽就能验证派生逻辑，
     * 也能逐字断言注册参数（id / priority / order）。
     */
    exports.__internals = {
      TAB_VIEW_ID,
      TAB_VIEW_ORDER,
      // 界面开关通道（「任务页面 / 子代理显示」）：测试直接种开关值再断言注册/注销与席位门控。
      uiFlagsBridge,
      uiFlags,
      useUiFlags,
      NS,
      ZH,
      EN,
      NATIVE_NODE_SLOT,
      NATIVE_IMAGES_SLOT,
      OWN_SEAT_SLOT,
      OWNED_NODE_KINDS,
      nativeViewChildren,
      nativeSeatFace,
      subagentSeatFace,
      SubagentSeatContext,
      subagentRowsOf,
      subagentRowOf,
      useSubagentChat,
      MAX_SUBAGENT_ROWS,
      MAX_SUBAGENT_TREE_ROWS,
      MAX_SUBAGENT_TREE_DEPTH,
      SUBAGENT_STATES,
      SUBAGENT_STATE_GLYPH,
      SUBAGENT_STATE_TONE,
      subagentStateOfSettlement,
      subagentTreeOf,
      shortChildId,
      resolveSeatPath,
      turnDataOfNode,
      turnOfChatNode,
      seatNodesOf,
      rowModelsOf,
      categoryOfTool,
      cardKindOfTool,
      statsOfNodes,
      statsSummary,
      describeStats,
      summarizeToolCall,
      diffCountsOf,
      parseCommandOutcome,
      toolStatusOf,
      toolCardOf,
      processEntries,
      nodeRowOf,
      groupProcessNodes,
      cutOffOf,
      observedRpcIdsOf,
      pendingSeatsOf,
      nodeRunsOf,
      isTopLevelNode,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      diffTodos,
      MAX_JSON_PARSE_CHARS,
      MAX_RENDER_CHARS,
      clampText,
      parseJsonSafe,
      SUMMARY_TOOL_NAME,
      isSummaryMarkTool,
      isSummaryMarkNode,
      summaryMarkIndexOf,
      trailingAnswerOf,
      assistantTextOf,
      formatDuration,
      markdownLabels,
      terminalLabels,
      installStyles,
      jumpToTurn,
      TOP_LOAD_THRESHOLD_PX,
      BOTTOM_THRESHOLD_PX,
      isAwayFromBottom,
      scrollViewToBottom,
      SCROLL_RESTORE_MAX_FRAMES,
      MAX_CATCHUP_PAGES,
      MAX_JUMP_REPAGES,
      SCROLL_PIN_MAX_FRAMES,
      isLoadAnchorVisible,
      isDocumentVisible,
      readScrollState,
      applyScrollState,
      restoreScrollState,
      encodeScrollState,
      decodeScrollState,
      bottomScrollState,
      SESSION_KEY_PREFIXES,
      purgeSessionData,
      staleSessionIds,
      collapseEntry,
      forgetCollapse,
      useScroller,
      useTick,
      mergeRailItems,
      scrollRailToBottom,
      FLOW_CSS,
      /** 用户发言的行内渲染（平台的 `projectUserText` 投影，原语缺席时退回纯文本）。 */
      UserText,
      views: {
        TaskFlowView,
        FlowBody,
        ViewBodyBoundary,
        TurnGroup,
        TurnRail,
        SnapshotPlate,
        TaskFold,
        ThinkingBlock,
        NodeSequence,
        PendingBubble,
        NativeSeat,
        NativeNodeRow,
        ChatFlowLeaf,
        ContextFold,
        Fold,
        ToolCard,
        SubagentCard,
        SubagentProcess,
        SubagentBar,
        Card,
        DisclosureLine,
        UserBubble,
        AssistantText,
        TruncationNote,
        ClampedPre,
      },
    }


      return module.exports
    })()


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
        ctx.slots.register({ name: 'sidebar.footer.action', id: 'control-center-entry', priority: 50 }, ControlCenterEntry),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'control-center-panel', priority: 50 }, ControlCenterPanel),
      )
      ctx.inject(['conversation'], (conversationCtx) => {
        conversationCtx.slots.inject('conversation.view', () =>
          conversationCtx.slots.register(
            {
              name: 'conversation.view',
              // priority 5：夹在「对话」(0) 与「轨迹」(10) 之间。NEXT 的 slots.register 只认 priority。
              id: 'control-center-rules',
              priority: 5,
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
              priority: 400,
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
              priority: 10,
              inject: (sessionId) => ({ sessionId }),
            },
            ComposerVeil,
          ),
        )
      })

      // 任务流半侧（原 `dsh-chat-flow`）：注册「任务流」视图标签页与它给原生叶子的席位注入面。
      // 两半共用同一次 apply 调用；注入面是两半的并集（见文件末尾 `exports.inject`）。
      // 把核心组的开关通道**递进去**（bridge）：任务流那半侧靠它接「任务页面 / 子代理显示」
      // 两个开关——两组分片同处一个 bundle，但各自在独立的 IIFE 里，只能这样显式传。
      chatFlow.apply(ctx, { flagsStore, useFlags, FLAGS_FALLBACK })

      // 「会话删除」页要读会话列表、把删掉的行从列表里摘走、并在删完之后清掉本插件给那个会话
      // 留下的数据。三样都只有插件 ctx 里才有，所以在这里显式接进去：
      // 存储里的键（折叠表 / 滚动位置 / 已结束标记）由任务流半侧的 `purgeSessionData` 负责，
      // 内存里那张永不淘汰的折叠表由 `forgetCollapse` 负责——**两个都要调**，各管一半。
      connectSessionServices({
        list: ctx.sessions?.list ?? null,
        remove: (sessionId) => ctx.sessions?.handleSessionRemoved?.(sessionId),
        purge: (sessionId) => {
          chatFlow.__internals.purgeSessionData(sessionId, window)
          chatFlow.__internals.forgetCollapse(sessionId)
        },
      })
    }

    exports.apply = apply
    /**
     * 注入面取两半的并集：核心半侧只要 `slots`，任务流半侧还要 `locale`（界面词典）与
     * `sessions`（子代理内联席位、以及「会话被删时清残留」要读的会话列表）。
     * 并集恰好是 `['slots', 'locale', 'sessions']`。
     */
    exports.inject = Array.from(new Set([...inject, ...chatFlow.inject]))
    /**
     * 测试接缝：`test/client-bundle.test.js` / `test/client-render-react.test.js` 在 node 侧
     * 把浏览器半侧跑起来时，需要直接拿到各页面组件（渲染器里 effect 不会真的跑，
     * 没法靠点界面走到它们）。仅此导出，不对外使用。
     */
    exports.__internals = {
      // 任务流半侧的接缝**摊平到顶层**：它原有 200+ 条断言是按 `__internals.X` 直接取用的，
      // 摊平之后那些断言不用动（需要改的只有插件 id 与 inject 两处）。
      ...chatFlow.__internals,
      withDefaults,
      panelStore,
      // 认领平台「提问」卡片的 DOM 观察器：靠 DOM 认领，只能这样测（SSR 下没有真 DOM）。
      dom: { watchRuleAskCards },
      // 「会话删除」页的纯逻辑（行怎么切、子代理怎么归族）：渲染测试点不动删除按钮，
      // 而这两个函数的判据（只列顶层会话、按父链递归收子代理）正是页面正确性的全部。
      sessions: { connectSessionServices, readSessionSnapshot, sessionRowsOf, sessionSubagentIds, formatSessionTime },
      tabs: { RulesSection, McpTab, SkillsTab, MemoryTab, ScanTab, BackupTab, SettingsTab, SessionsTab, ProjectRulesView, ControlCenterPanel, ControlCenterEntry },
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
      // 整个任务流半侧的导出面（`apply` / `inject` / `__internals`）：要整块用时从这儿拿，
      // 不用去猜上面哪些键是摊平来的。
      flow: chatFlow,
    }
    return module.exports
  },
})
