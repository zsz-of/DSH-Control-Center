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
