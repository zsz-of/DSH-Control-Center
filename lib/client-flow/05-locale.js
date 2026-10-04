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
      'flow.rail.older': '加载更早的回合',
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
      'flow.rail.older': 'Load earlier turns',
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
