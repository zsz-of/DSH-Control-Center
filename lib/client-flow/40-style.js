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
