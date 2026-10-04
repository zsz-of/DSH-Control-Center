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
