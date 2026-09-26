
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
