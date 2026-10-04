/**
 * 客户端 bundle 测试：模块注册、插槽接线、以及整棵视图在 node 里的冒烟渲染。
 *
 * 用的是手写渲染器（`createElement` 直接调用函数组件），它能抓到「组件是 undefined」
 * 这类会让真实界面整块白屏的错误——这正是这个文件存在的主要理由。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { collectText, createStorage, loadBundle } from './helpers/load-bundle.mjs'
import { createProbeReact } from './helpers/probe-react.mjs'
import { SUMMARY_TOOL_NAME } from '../lib/flow/protocol.js'
import {
  assistantNode,
  blankAssistantNode,
  contextNode,
  interruptedPwshNode,
  makeSnapshot,
  pwshNode,
  steeringNode,
  subagentCallNode,
  systemPromptNode,
  todoNode,
  toolNode,
  turnProcessNode,
  turnTailNode,
  userNode,
  writeNode,
} from './helpers/flow-fixtures.mjs'

/**
 * 造一个只记录调用的客户端 ctx 桩。
 *
 * `t` 与真实 `ctx.locale.bind` 一样：注册后才有字典，因此这里返回闭包而不是快照，
 * 插值规则也与核心一致（`{name}` 单花括号）。
 */
function stubCtx() {
  const captured = { locales: [], registered: [], pending: [], effects: [] }
  const translate = (ns, key, params) => {
    const dict = captured.locales.find((item) => item.ns === ns)?.dict.zh ?? {}
    const template = dict[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  const ctx = {
    /**
     * 合并后控制中心那一半会在 apply 里 `ctx.inject(['conversation'], cb)` 注册它自己的视图与
     * 输入框扩展；桩必须像真 cordis 一样把回调跑起来（服务视为已就绪），否则那些注册不会发生。
     */
    inject(deps, run) {
      run(ctx)
    },
    effect(fn, label) {
      captured.effects.push(label)
      return fn()
    },
    locale: {
      register(ns, dict) {
        captured.locales.push({ ns, dict })
        return () => {}
      },
      bind: (ns) => (key, params) => translate(ns, key, params),
    },
    sessions: { binding: () => undefined },
    slots: {
      inject(name, run) {
        captured.pending.push([name, run])
      },
      register(options, component) {
        captured.registered.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, captured, t: (key, params) => translate('chat-flow', key, params) }
}

/** 装载 bundle 并应用一次，返回注册过的视图条目与文案函数。 */
function bootView() {
  const { ctx, captured, t } = stubCtx()
  client.apply(ctx)
  for (const [, run] of captured.pending) run()
  // 合并后同一个插槽上有两条视图：控制中心自己的「规则」与任务流。这里只要任务流那条。
  const view = captured.registered.find(
    (item) => item.options.name === 'conversation.view' && item.options.id === 'flow',
  )
  return { captured, view, t }
}

const module0 = await loadBundle()
const client = module0.exports
const { registration, requested, appendedStyles, window: window0 } = module0

test('bundle 以正确的包名注册自己，且只依赖平台 seed 模块', () => {
  assert.equal(registration.id, 'dsh-control-center', '任务流半侧合并进控制中心后，只有一个 bundle 注册')
  assert.deepEqual([...new Set(requested)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
})

test('插件声明依赖 slots / locale / sessions', () => {
  assert.deepEqual(client.inject, ['slots', 'locale', 'sessions'])
  assert.equal(typeof client.apply, 'function')
})

test('apply() 注册语言包、样式与唯一的视图条目', () => {
  const { captured, view, t } = bootView()

  assert.deepEqual(captured.locales.map((item) => item.ns), ['chat-flow'])
  assert.equal(captured.locales[0].dict.zh['flow.thinking.live'], '思考中')
  assert.deepEqual(
    captured.effects,
    ['chat-flow: dictionaries', 'chat-flow: purge deleted sessions', 'chat-flow: task view switch'],
    '语言包注册、「删除会话后的残留清理」与「任务页面开关」都应挂在 effect 上，随插件卸载回收',
  )

  // 合并后核心组也会注入它自己的样式表，所以这里只认任务流那一张（按各自的固定 id 找）。
  const flowStyles = appendedStyles.filter((node) => node.id === 'dsh-chat-flow-style')
  assert.equal(flowStyles.length, 1, '任务流样式只注入一次（按固定 id 去重）')
  assert.match(flowStyles[0].textContent, /\.dcf-root/)

  assert.ok(view !== undefined, '必须注册 conversation.view')
  assert.equal(view.options.id, 'flow', '用独立 id：遮蔽会让标签栏出现两个同 id 条目（核心不允许注销别人的条目）')
  assert.equal(view.options.priority, undefined, '不设 priority：各占一个单元格，互不遮蔽')
  assert.equal(view.options.order, 5, '排在「对话」(0) 与「轨迹」(10) 之间')
  assert.equal(view.options.locale, 'chat-flow')
  assert.equal(view.options.label(), '任务')
  assert.equal(t('flow.tasksSummary', { total: 2, done: 1 }), '2 项 · 1 已完成')

  const injected = view.options.inject('session-1')
  assert.equal(injected.sessionId, 'session-1')
  assert.equal(typeof injected.loadOlder, 'function')
  // 会话 binding 取不到时点「加载更早」不能抛（切走会话的竞态）。
  assert.doesNotThrow(() => injected.loadOlder())
})

test('注入面：视图把子代理席位一起递下去（宿主装了 sessions 就必须有）', () => {
  const { view } = bootView()

  // 席位是「内联看子代理过程」的唯一入口：注入面漏了它，卡片就会静默退回只显示报告，
  // 而组件与派生层的用例各自都能过——所以这条断言只能落在注入面上。
  const injected = view.options.inject('session-1')
  assert.ok(injected.agentSeat !== undefined && injected.agentSeat !== null, '席位必须在注入面上')
  assert.equal(typeof injected.agentSeat.watch, 'function')
  assert.equal(typeof injected.agentSeat.openSubagent, 'function')
})

test('视图渲染：任务过程 / 任务列表 / 正在处理统计都在', () => {
  const { captured, view, t } = bootView()

  const nodes = [
    userNode('u1', 1, '把 A 和 B 都做掉'),
    assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划一下。' }]),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'node --test', '3 tests passed'),
    writeNode('t2', 1, 3, 'a.js'),
    todoNode('p2', 1, 4, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'completed' },
    ]),
    assistantNode('a2', 1, 5, [{ kind: 'text', text: '两件事都做完了。' }]),
  ]
  const snapshot = makeSnapshot(nodes)
  const tree = view.component({
    sessionId: 'session-1',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    loadOlder: () => {},
  })
  const text = collectText(tree)
  assert.match(text, /把 A 和 B 都做掉/)
  assert.match(text, /任务过程/)
  assert.match(text, /任务列表/)
  assert.match(text, /2 项 · 2 已完成/)
  assert.match(text, /任务A/)
  assert.match(text, /任务B/)
  assert.match(text, /已完成/)
  assert.match(text, /两件事都做完了/)
  assert.equal(/规划过程/.test(text), false, '「规划过程」折叠体已移除，其内容并进任务过程')
  assert.equal(
    captured.registered.filter((item) => item.options.name === 'conversation.view').length,
    2,
    '「对话」视图插槽上并列两条：控制中心的「规则」与任务流',
  )
})

test('用户气泡：行内内容走平台的 projectUserText（0.2 的 primitives 里已经没有 MessageText）', async () => {
  // 以前这里取的是 `primitives.MessageText`——0.2 里没有这个导出，`componentOr` 每次都
  // 退回纯文本，用户气泡（@文件 引用、正文排版）永久降级且**不报错**。
  const calls = []
  const primitives = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'then' || typeof key === 'symbol') return undefined
        if (key === 'projectUserText') {
          return (text, sessionLabels, slashNames, slashKind, references) => {
            calls.push({ text, sessionLabels, slashNames, slashKind, references })
            return text
          }
        }
        return function Stub(props) {
          const given = props ?? {}
          return { type: 'primitive', props: { name: String(key), children: given.children ?? given.text } }
        }
      },
    },
  )
  const loaded = await loadBundle({ primitives })
  const local = loaded.exports
  const { ctx, captured, t } = stubCtx()
  local.apply(ctx)
  for (const [, run] of captured.pending) run()
  const view = captured.registered.find(
    (item) => item.options.name === 'conversation.view' && item.options.id === 'flow',
  )
  const snapshot = makeSnapshot([userNode('u1', 1, '看一下 @a.js 引用')])
  const tree = view.component({
    sessionId: 'session-1',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    loadOlder: () => {},
  })
  assert.match(collectText(tree), /看一下 @a\.js 引用/)
  const projected = calls.find((call) => call.text === '看一下 @a.js 引用')
  assert.ok(projected !== undefined, '用户发言必须交给 projectUserText 投影（它负责 @文件 / /技能 的 chip）')
  assert.deepEqual(
    projected,
    { text: '看一下 @a.js 引用', sessionLabels: [], slashNames: [], slashKind: 'skill', references: undefined },
    '参数形状与核心的用户气泡一致：本插件没有文件预览动作，references 留空（chip 仍可读、只是不可点）',
  )

  // 更老的宿主没有这个原语时：退回纯文本，而不是把正文弄丢。
  const plain = await loadBundle({ primitives: {} })
  assert.equal(plain.exports.__internals.UserText({ text: '老宿主' }), '老宿主')
})

test('超长正文：渲染层截断并补一行说明（不静默丢内容，也不把面板排到卡死）', () => {
  const { MAX_RENDER_CHARS, clampText } = client.__internals
  assert.equal(MAX_RENDER_CHARS > 0, true)

  // 边界：等于上限不动，多一个字符就截断并报出原始长度。
  assert.deepEqual(clampText('短'), { text: '短', truncated: false })
  assert.equal(clampText('x'.repeat(MAX_RENDER_CHARS)).truncated, false)
  const over = clampText('x'.repeat(MAX_RENDER_CHARS + 1))
  assert.equal(over.text.length, MAX_RENDER_CHARS)
  assert.equal(over.truncated, true)
  assert.equal(over.total, MAX_RENDER_CHARS + 1)
  assert.deepEqual(clampText(undefined), { text: '', truncated: false }, '非字符串一律当成空正文')

  // 渲染：交给原语的正文只到上限，界面上另有一行「已截断」说明（带原始长度）。
  const { view, t } = bootView()
  const huge = '长'.repeat(MAX_RENDER_CHARS + 7)
  const tree = view.component({
    sessionId: 'session-long',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('long0', 1, '来一段长的'),
          assistantNode('long1', 1, 2, [{ kind: 'text', text: huge }]),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
  })
  const markdown = findElement(tree, (element) => element.props?.name === 'MarkdownText')
  assert.ok(markdown !== undefined, '正文仍然交给 MarkdownText 渲染')
  assert.equal(markdown.props.children.length, MAX_RENDER_CHARS, '进排版的内容不超过上限')

  const note = findElement(tree, (element) => {
    if (String(element.props?.className ?? '') !== 'dcf-note') return false
    return /正文过长/.test(collectText(element))
  })
  assert.ok(note !== undefined, '截断必须留一行说明')
  assert.match(collectText(note), /只显示前 200000 个字符/)
  assert.match(collectText(note), /共 200007 个字符/, '说明里给原始长度，用户才知道自己少了多少')
})


function foldStates(element) {
  const states = []
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value.props?.className === 'dcf-fold') states.push(value.props['data-open'])
    walk(value.props?.children)
  }
  walk(element)
  return states
}

/** 在树里找第一个满足条件的元素。 */
function findElement(element, predicate) {
  let found = null
  const walk = (value) => {
    if (found !== null || value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (predicate(value)) {
      found = value
      return
    }
    walk(value.props?.children)
  }
  walk(element)
  return found
}

/** 遍历树里**每一个**满足条件的元素（`findElement` 只给第一个）。 */
function collectElements(element, visit) {
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (value.props !== undefined) visit(value)
    walk(value.props?.children)
  }
  walk(element)
}

/**
 * 点开树里所有收起的「思考中 / 思考完成」块。
 *
 * 思考块是**唯一**懒加载的折叠体（`Fold` 的 `lazy`）：收起时它的正文根本不在树里。
 * 想断言过程明细（命令卡、差异、上下文准备…）就必须先点开它——这正是用户在界面上的操作顺序。
 * 展开一层可能露出更内层的块，所以循环几轮，直到没有可点开的折叠头。
 *
 * @param view - `bootView()` 拿到的视图条目。
 * @param props - 渲染参数（带 `sessionId` / `t` / `useChat` / `useSession`）。
 */
function expandThinkingBlocks(view, props) {
  for (let pass = 0; pass < 5; pass += 1) {
    const heads = []
    collectElements(view.component(props), (element) => {
      const className = String(element.props?.className ?? '')
      if (className.includes('dcf-thinkinghead') && element.props['aria-expanded'] === false) heads.push(element)
    })
    if (heads.length === 0) return
    for (const head of heads) head.props.onClick()
  }
}

test('默认展开策略：跑动中的任务过程/任务列表/任务行展开，思考块与明细收起', () => {
  const { view, t } = bootView()
  const snapshot = makeSnapshot([
    userNode('u1', 1, '做点事'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'live-command', 'live-output'),
  ])
  const props = {
    sessionId: 'session-live',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, running: true }),
  }
  const tree = view.component(props)
  assert.match(collectText(tree), /任务A/)
  assert.match(collectText(tree), /进行中/)
  // 用户当轮的默认策略：**任务过程跑动中默认展开**（此时不允许关闭）；任务列表展开；
  // 任务行展开（就是当前那一项）；思考块默认折叠（哪怕它还在写）。
  // 思考块里那张卡片明细这一版**还不在树里**——思考块是唯一懒加载的折叠体，
  // 收起时它的正文不渲染（用户要求「折叠的内容不要加载」），所以这里只有 4 个折叠容器。
  assert.deepEqual(
    foldStates(tree),
    ['true', 'true', 'true', 'false'],
    '任务过程展开（跑动中）、任务列表展开、任务行展开、思考块收起（正文懒加载，未进树）',
  )
  assert.equal(collectText(tree).includes('live-command'), false, '收起的思考块不渲染正文（命令明细不在 DOM 里）')

  // 点开思考块 → 正文才挂上，且里面那张卡片明细仍然是收起的。
  expandThinkingBlocks(view, props)
  const opened = view.component(props)
  assert.match(collectText(opened), /live-command/, '展开思考块后正文按需重建')
  assert.deepEqual(
    foldStates(opened),
    ['true', 'true', 'true', 'true', 'false'],
    '展开思考块后第 5 个折叠容器（卡片明细）才出现，且保持收起',
  )
})

test('手动展开会被记住：覆盖默认展开策略', () => {
  const { view, t } = bootView()
  const sessionId = 'session-manual'
  const snapshot = makeSnapshot([
    userNode('u1', 1, '做点事'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'live-command', 'live-output'),
  ])
  const props = {
    sessionId,
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, running: true }),
  }
  const before = view.component(props)
  assert.deepEqual(
    foldStates(before),
    ['true', 'true', 'true', 'false'],
    '任务过程跑动中展开；任务列表、任务行展开；思考块收起（正文懒加载，未进树）',
  )

  // 点「思考中」那一行 → 展开它（默认是收起的）。「任务过程」此刻点不动，所以只能点思考块。
  const procRow = findElement(
    before,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('思考'),
  )
  assert.ok(procRow !== undefined && typeof procRow.props.onClick === 'function', '「思考」标题行应当可点')
  procRow.props.onClick()

  const after = view.component({ ...props, t })
  assert.deepEqual(foldStates(after), ['true', 'true', 'true', 'true', 'false'], '手动展开「思考」块后应保持展开')
})

test('jumpToTurn：只滚会话体、不用 scrollIntoView，并尊重「减少动态效果」', () => {
  const { jumpToTurn } = client.__internals
  const calls = []
  const scroller = {
    scrollTop: 100,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: (options) => {
      calls.push(options)
      scroller.scrollTop = options.top
    },
  }
  const target = {
    // 真实 DOM 里行的视口位置随滚动变化（这里行在内容坐标 500 处）。
    getBoundingClientRect: () => ({ top: 500 - scroller.scrollTop }),
    // 一旦被调用就会把外层盒子（含输入框）一起滚掉——必须永远不调用。
    scrollIntoView: (options) => calls.push({ scrollIntoView: options }),
  }
  const root = {
    querySelector: (selector) => (selector === '[data-turn-anchor="3"]' ? target : null),
    closest: (selector) => (selector === '[data-conversation-scroll]' ? scroller : null),
  }

  window0.matchMedia = () => ({ matches: true })
  jumpToTurn(root, 3)
  // 当前 scrollTop=100 → 行的视口 top=400；落位留 24px 空隙 → 100 + (400 - 24) = 476。
  assert.deepEqual(calls, [{ top: 476, behavior: 'auto' }], '开了减少动态效果就瞬时跳')
  assert.equal(
    calls.some((call) => 'scrollIntoView' in call),
    false,
    '绝不能退化成 scrollIntoView：它会连外层盒子（含输入框）一起滚',
  )

  // 已经在位上（行的视口 top 正好等于 24）→ 不再产生滚动。
  const settled = calls.length
  window0.matchMedia = () => ({ matches: false })
  jumpToTurn(root, 3)
  assert.equal(calls.length, settled, '目标已经在落位点上 → 不产生滚动')

  // 再往上滚一段后跳转，应当是平滑滚动。
  scroller.scrollTop = 200
  jumpToTurn(root, 3)
  assert.deepEqual(calls[settled], { top: 476, behavior: 'smooth' })

  // 目标不存在 / 根为空 / 没有可滚盒子时都不能抛。
  assert.doesNotThrow(() => jumpToTurn(root, 99))
  assert.doesNotThrow(() => jumpToTurn(null, 1))
  assert.doesNotThrow(() =>
    jumpToTurn(
      {
        querySelector: () => ({ getBoundingClientRect: () => ({ top: 0 }) }),
        closest: () => null,
        parentElement: null,
      },
      1,
    ),
  )
})

test('样式契约：折叠有过渡且收起时不可见，并尊重 reduced-motion', () => {
  const { FLOW_CSS } = client.__internals
  assert.match(FLOW_CSS, /\.dcf-fold\{[^}]*grid-template-rows:0fr/, '收起态用 0fr 轨道')
  assert.match(FLOW_CSS, /\.dcf-fold\{[^}]*visibility:hidden/, '收起态要摘掉可见性与焦点')
  assert.match(FLOW_CSS, /\.dcf-fold\[data-open=true\]\{[^}]*grid-template-rows:1fr/)
  assert.match(FLOW_CSS, /\.dcf-fold[^{]*\{[^}]*transition:grid-template-rows \.22s/)
  assert.match(FLOW_CSS, /prefers-reduced-motion:reduce/, '必须给减少动态效果留出口')
  // 导轨：sticky 零高槽 + 刻度用主题 token 上色；刻度是装数字的方格（用户要求数字显示）。
  assert.match(FLOW_CSS, /\.dcf-rail-slot\{position:sticky;top:0/)
  assert.match(FLOW_CSS, /\.dcf-rail\{[^}]*overflow-y:auto/, '刻度多了导轨自己滚')
  assert.match(FLOW_CSS, /\.dcf-mark\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/, '刻度要能居中放数字')
  assert.match(FLOW_CSS, /\.dcf-mark\[data-active=true\]\{[^}]*border-color:var\(--dsw-alias-label-primary\)/)
  assert.equal(
    /\.dcf-mark::before|\.dcf-mark\[data-[a-z]+=true\]::before/.test(FLOW_CSS),
    false,
    '横线形状已经让给数字了，旧的 ::before 规则必须清干净',
  )
})

test('缺少 useChat（ui-chat 不在装配里）时给空态而不是抛异常', () => {
  const { view } = bootView()
  const tree = view.component({ t: (key) => key })
  assert.equal(collectText(tree), 'flow.empty')
})

test('localStorage 不可用时仍然能装载（折叠状态退化成内存）', async () => {
  const storage = createStorage({ fail: true })
  const loaded = await loadBundle({ storage })
  const internals = loaded.exports.__internals
  assert.equal(typeof internals.deriveFlow, 'function')
  const flow = internals.deriveFlow(makeSnapshot([userNode('u1', 1, 'hi')]))
  assert.equal(flow.turns.length, 1)
})

test('导轨：刻度只由当前对话算（不再读 turnOutline 投影），「更早」刻度走一次普通翻页', () => {
  const { view, t } = bootView()
  const paged = []
  const tree = view.component({
    sessionId: 'session-rail-live',
    t,
    useChat: (selector) => selector(makeSnapshot([userNode('u2', 2, '第二件事'), userNode('u3', 3, '第三件事')])),
    useSession: () => ({ hasMore: true, loadingOlder: false }),
    // 用户要求任务视图实时根据对话来：投影（落盘缓存）再被读到就该报错。
    useProjection: () => {
      throw new Error('任务视图不该再读 turnOutline 投影')
    },
    loadOlder: () => {
      paged.push('older')
      return Promise.resolve()
    },
  })

  const loaded = []
  findElement(tree, (element) => {
    if (element.props?.['data-loaded'] === 'true') loaded.push(element)
    return false
  })
  assert.equal(loaded.length, 2, '两个已加载回合两个刻度')
  assert.equal(loaded[0].props['aria-label'], '跳到第 2 轮')

  const older = findElement(tree, (element) => element.props?.['data-loaded'] === 'false')
  assert.ok(older !== null && older !== undefined, '还有更早历史时要有「更早」刻度')
  assert.equal(older.props['aria-label'], '加载更早的回合')
  older.props.onClick()
  assert.deepEqual(paged, ['older'], '「更早」刻度走 requestLoadOlder（与列表顶部按钮同一条路径）')
})

test('导轨：没有更早历史时不出现「更早」刻度，只画已加载回合', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-rail-loaded-only',
    t,
    useChat: (selector) => selector(makeSnapshot([userNode('u1', 1, '一'), userNode('u2', 2, '二')])),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
  })
  assert.equal(findElement(tree, (element) => element.props?.['data-loaded'] === 'false'), null)
  assert.equal(findElement(tree, (element) => element.props?.['data-loaded'] === 'true') !== undefined, true, '已加载刻度照常渲染')
})

/* ──────────────────────────── 原生节点座位 ──────────────────────────── */

/** 记录每次原生座位调用，并按要求返回一个标记元素（默认是个纯标记，不含任何子节点）。 */
function seatSpy(behaviour) {
  const calls = []
  const renderSlot = (slot, owner, options) => {
    calls.push({ slot, owner, options })
    return behaviour === undefined ? { type: 'native', props: { slot } } : behaviour(slot, owner, options)
  }
  return { calls, renderSlot }
}

test('原生座位：每个节点都经 conversation.chat.node 交给核心渲染，并带上主人参数', () => {
  const { view, t } = bootView()
  const { calls, renderSlot } = seatSpy()
  const tool = pwshNode('t1', 1, 2, 'echo a', 'a')
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    tool,
  ])
  const openFile = () => Promise.resolve()
  const props = {
    sessionId: 'session-seat',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
    openFile,
    openView: (id) => id,
  }
  // 思考块收起时正文不渲染（懒加载），所以工具调用那一行本来就不在树里——先点开它。
  // 点开这一动作本身会走一遍渲染，会往 `calls` 里塞座位调用；清空后再渲染最后一棵树。
  expandThinkingBlocks(view, props)
  calls.length = 0
  const tree = view.component(props)

  assert.ok(calls.length >= 2, '用户发言与工具调用都应经过原生座位')
  for (const call of calls) {
    assert.equal(call.slot, client.__internals.NATIVE_NODE_SLOT)
    assert.ok(call.owner.node !== undefined, '原生座位必须拿到该节点本身')
    assert.equal(call.options.entryKey, call.owner.node.kind, 'entryKey 用节点 kind 分派原生条目')
    assert.equal(call.owner.openFile, openFile, '核心叶子要的 openFile 必须原样传下去')
    assert.equal(typeof call.owner.forkAt, 'function')
    assert.equal(typeof call.owner.fileMentions, 'function')
    assert.equal(typeof call.owner.inspectCall, 'function')
    assert.ok(Object.hasOwn(call.options, 'hookContext'), 'hookContext 这个键必须存在（槽上挂着上下文 hook 工厂）')
    assert.ok(call.options.fallback !== undefined && call.options.fallback !== null, '必须给核心一个回退叶子')
  }
  const toolCall = calls.find((call) => call.owner.node.kind === 'tool-call')
  assert.equal(toolCall.owner.node, tool)
  assert.equal(toolCall.options.entryKey, 'tool-call')
  assert.equal(toolCall.owner.turnProcess, undefined, '核心的过程折叠控制器由本插件替代，不给它主人参数')
  assert.equal(toolCall.owner.cwd, undefined, '没有 useSessions 时 cwd 留空')

  // 原生座位接手后，本插件自己的卡片不再出现在这一行（只有回退叶子才用它）。
  const nativeRows = []
  findElement(tree, (element) => {
    if (element.type === 'native') nativeRows.push(element)
    return false
  })
  assert.equal(nativeRows.length, calls.length)
  assert.equal(findElement(tree, (element) => element.props?.className === 'dcf-card'), null)
})

test('原生座位：cwd 来自 useSessions；装配里没有 renderSlot 时退回自绘叶子', () => {
  const { view, t } = bootView()
  const snapshot = makeSnapshot([userNode('u1', 1, '干活'), pwshNode('t1', 1, 1, 'echo a', 'a')])
  const { calls, renderSlot } = seatSpy()
  // 工具行在思考块正文里（懒加载），三次渲染都要先点开思考块，那一行才会进树。
  const build = (overrides) => ({
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    ...overrides,
  })

  const first = build({ sessionId: 'session-seat-cwd', renderSlot })
  expandThinkingBlocks(view, first)
  calls.length = 0
  view.component(first)
  assert.equal(calls[0].owner.cwd, undefined)

  calls.length = 0
  const second = build({
    sessionId: 'session-seat-cwd-2',
    renderSlot,
    useSessions: (selector) => selector({ byId: { 'session-seat-cwd-2': { cwd: 'D:/work' } } }),
  })
  expandThinkingBlocks(view, second)
  calls.length = 0
  view.component(second)
  assert.equal(calls[0].owner.cwd, 'D:/work')

  // 没有 renderSlot（ui-chat 不在装配里）→ 一次座位都不调，直接画自绘卡片。
  const third = build({ sessionId: 'session-no-slot' })
  expandThinkingBlocks(view, third)
  const plain = view.component(third)
  assert.notEqual(findElement(plain, (element) => element.props?.className === 'dcf-card'), null)
  assert.equal(
    calls.some((call) => call.owner.node.kind === 'tool-call'),
    true,
    '有 renderSlot 时工具调用必须走座位（自绘卡片只作为回退叶子）',
  )
})

test('原生座位：带推理的节点由本插件自绘（核心会把答案步的推理藏成 hidden → 点开一片空白）', () => {
  const { view, t } = bootView()
  const { calls, renderSlot } = seatSpy()
  const reasoning = assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '先把思路理清楚再动手' }])
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    reasoning,
    pwshNode('t1', 1, 3, 'echo a', 'a'),
  ])
  const props = {
    sessionId: 'session-thinking-own',
    t,
    useChat: (selector) => selector(snapshot),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
  }
  // 推理行在懒加载的思考块正文里：先点开思考块，它才会进树。
  expandThinkingBlocks(view, props)
  calls.length = 0
  const tree = view.component(props)

  assert.equal(
    calls.some((call) => call.owner.node === reasoning),
    false,
    '带推理的节点不能走原生座位：核心对答案步的推理写 hidden="until-found"，用户点开就是空白',
  )
  assert.equal(
    calls.some((call) => call.owner.node.kind === 'tool-call'),
    true,
    '工具调用照旧走原生座位（只把推理行改成自绘）',
  )
  assert.ok(collectText(tree).includes('先把思路理清楚再动手'), '推理正文必须真的渲染出来')
})

test('原生座位外面套着错误边界：失败时给出回退叶子，并且留日志', async () => {
  /*
    这一条需要「createElement 不立刻调用组件」的渲染器：手写渲染器会把类组件当场 new 出来，
    拿不到边界元素本身。所以要单独用探针 React 装载一份 bundle（探针的 createElement 只构造元素）。
  */
  const probeModule = await loadBundle({ react: createProbeReact().react })
  const { views } = probeModule.exports.__internals
  const fallback = { type: 'leaf' }
  const seated = { type: 'native' }
  const node = { key: 't1', kind: 'tool-call' }
  const boundary = views.NativeSeat({ node, owner: {}, renderSlot: () => seated, fallback })

  assert.equal(typeof boundary.type.getDerivedStateFromError, 'function', '必须是类组件错误边界（函数组件不是边界）')
  assert.equal(boundary.props.fallback, fallback, '边界拿到的回退叶子必须是本插件的自绘叶子')
  assert.equal(boundary.props.children.props.node, node, '边界包住的正是真正调用插槽的那一层')
  assert.equal(
    views.NativeSeat({ node, owner: {}, renderSlot: undefined, fallback }),
    fallback,
    '没有 renderSlot（装配里没有 ui-chat）时不用套边界，直接给回退叶子',
  )
  // 座位「认领了却不渲染任何东西」也是真机出现过的一类空白（核心会把答案步的推理写成
  // hidden="until-found"）：渲染成空一律退回自绘叶子，宁可多画一行也不留白。
  assert.equal(
    views.NativeSeatInner({ node, owner: {}, renderSlot: () => null, fallback }),
    fallback,
    '座位渲染成 null 时改用自绘叶子',
  )
  assert.equal(
    views.NativeSeatInner({ node, owner: {}, renderSlot: () => [], fallback }),
    fallback,
    '座位渲染成空数组时同样改用自绘叶子',
  )
  assert.equal(
    views.NativeSeatInner({ node, owner: {}, renderSlot: () => seated, fallback }),
    seated,
    '座位真的渲染出内容时原样使用',
  )

  /**
   * React 的边界契约：崩溃时调 `getDerivedStateFromError`，随后用新状态重渲染。
   * React 18 的 legacy `renderToString` **不**接住边界（实测：错误直接抛出；流式接口会把整条流中断），
   * 所以这条契约在这里逐点断言；真机上的客户端渲染器（`createRoot`）支持它。
   */
  const Boundary = boundary.type
  assert.deepEqual(Boundary.getDerivedStateFromError(new Error('x')), { failed: true })
  const instance = new Boundary({ fallback, children: 'CHILD' })
  assert.equal(instance.render(), 'CHILD', '正常时渲染子树')
  instance.state = { failed: true }
  assert.equal(instance.render(), fallback, '失败后渲染回退叶子')

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    instance.componentDidCatch(new Error('native seat boom'))
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1, '失败必须显式留日志，不能静默')
  assert.match(String(warnings[0][0]), /原生节点座位渲染失败/)
})

test('原生座位：只接管 turn-process；turn-tail 必须交给原生（复制/点赞/点踩/分支按钮在里面）', () => {
  const { seatNodesOf } = client.__internals
  const kept = seatNodesOf([
    { key: 'a', kind: 'tool-call' },
    { key: 'b', kind: 'turn-tail' },
    { key: 'c', kind: 'turn-process' },
    null,
    undefined,
    { key: 'd', kind: 'user' },
  ])
  assert.deepEqual(kept.map((node) => node.key), ['a', 'b', 'd'], 'turn-tail 必须留给原生条目渲染')
})

test('原生座位：收尾节点真的被渲染成座位（entryKey = turn-tail）', () => {
  const { view, t } = bootView()
  const { calls, renderSlot } = seatSpy()
  view.component({
    sessionId: 'session-tail-seat',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
          assistantNode('a1', 1, 2, [{ kind: 'text', text: '做完了' }]),
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false }),
    renderSlot,
  })
  const tailCall = calls.find((call) => call.owner.node.kind === 'turn-tail')
  assert.ok(tailCall !== undefined, 'turn-tail 必须经过原生座位（按钮由它渲染）')
  assert.equal(tailCall.options.entryKey, 'turn-tail')
  assert.equal(typeof tailCall.owner.forkAt, 'function', '分支按钮要 forkAt')
  assert.equal(typeof tailCall.owner.inspectCall, 'function')
})

test('turnDataOfNode / turnOfChatNode：只有 turn 与 step 两种位置有回合数据', () => {
  const { turnDataOfNode, turnOfChatNode } = client.__internals
  const data = { source: () => undefined }
  const node = { location: { kind: 'step', turn: { turn: 3, data } } }
  assert.equal(turnDataOfNode(node), data, 'hookContext 必须就是 location.turn.data')
  assert.equal(turnOfChatNode(node), 3)
  assert.equal(turnDataOfNode({ location: { kind: 'unresolved' } }), undefined)
  assert.equal(turnDataOfNode({}), undefined)
  assert.equal(turnOfChatNode(undefined), undefined)
})

test('子槽声明：核心的两个子槽挂成不可枚举属性（冲突检查看不到、所有权检查读得到）', () => {
  const { nativeViewChildren, NATIVE_NODE_SLOT, NATIVE_IMAGES_SLOT, OWN_SEAT_SLOT } = client.__internals
  const children = nativeViewChildren()

  // 核心 register() 的冲突检查遍历 `Object.keys(children)`（slots:100）——
  // 核心 ui-chat 的视图条目已经声明过这两个槽，它们绝不能出现在可枚举键里。
  assert.deepEqual(Object.keys(children), [OWN_SEAT_SLOT])
  // renderSlot 的所有权检查只做属性读取（renderer:285）。
  assert.equal(children[NATIVE_NODE_SLOT].kind, 'keyed')
  assert.equal(children[NATIVE_NODE_SLOT].scope, 'session')
  assert.equal(children[NATIVE_IMAGES_SLOT].kind, 'single')
  // 渲染器用 `Object.values(children)` 判断要不要给 SessionProvider（renderer:616）：
  // 会话作用域子槽必须出现在可枚举值里，否则原生座位会因为缺作用域绑定而抛 SlotAssemblyError。
  assert.ok(Object.values(children).some((spec) => spec.scope === 'session'))
  assert.equal(
    Object.values(children).some((spec) => spec.kind === 'chain'),
    false,
    '不是 chain 槽，renderer:615 不必给 renderSlotChain',
  )
})

test('接线：视图条目声明 children 并把原生叶子要的能力放进 inject', () => {
  const { view } = bootView()
  assert.deepEqual(Object.keys(view.options.children), ['chat-flow.seat'], '可枚举子槽只有本插件自己的那个')
  assert.equal(view.options.children['conversation.chat.node'].kind, 'keyed')

  const injected = view.options.inject('session-1')
  assert.equal(typeof injected.openFile, 'function')
  assert.equal(typeof injected.fileMentions, 'function')
  assert.equal(typeof injected.forkAt, 'function')
  // 桩 ctx 里没有 uiConversation → loadImage 降级为 undefined（原生叶子会跳过附件渲染）。
  assert.equal(injected.loadImage, undefined)
})

/** 造一个带可选服务的 ctx 桩：验证原生注入面的能力与降级。 */
function seatFaceStub(services) {
  const calls = { opened: [], forked: [], openedPaths: [] }
  const ctx = {
    get: (name) => services[name],
    sessions: {
      list: { getSnapshot: () => ({ byId: { 'session-1': { cwd: 'D:/work' } } }) },
      fork: (input) => {
        calls.forked.push(input)
        return Promise.resolve('child-1')
      },
      open: (id) => calls.opened.push(id),
    },
  }
  return { ctx, calls }
}

test('原生注入面：openFile 按会话 cwd 解析相对路径，绝对路径原样使用', async () => {
  const { nativeSeatFace, resolveSeatPath } = client.__internals
  const { ctx, calls } = seatFaceStub({
    remote: {
      session: {
        openWorkspacePath: (input) => {
          calls.openedPaths.push(input.path)
          return Promise.resolve({ ok: true })
        },
      },
    },
  })
  const face = nativeSeatFace(ctx, 'session-1')
  await face.openFile('src/a.js')
  await face.openFile('/tmp/b.js')
  await face.openFile('C:\\x\\c.js')
  await face.openFile('\\\\server\\share\\d.js')
  assert.deepEqual(calls.openedPaths, ['D:/work/src/a.js', '/tmp/b.js', 'C:\\x\\c.js', '\\\\server\\share\\d.js'])

  // 路径解析与核心 `resolveWorkspacePath` 同义（util-workspace-path:16-20）。
  assert.equal(resolveSeatPath('D:/work/', '/a'), '/a')
  assert.equal(resolveSeatPath('D:/work/', 'a'), 'D:/work/a')
  assert.equal(resolveSeatPath(undefined, 'a'), 'a')
  assert.equal(resolveSeatPath('D:/work', ''), '')
})

test('原生注入面：打开失败与服务缺席都必须显式报错，不能静默', async () => {
  const { nativeSeatFace } = client.__internals
  const failing = seatFaceStub({
    remote: {
      session: { openWorkspacePath: () => Promise.resolve({ ok: false, error: { message: 'no access' } }) },
    },
  })
  await assert.rejects(() => nativeSeatFace(failing.ctx, 'session-1').openFile('a.js'), /no access/)

  const bare = seatFaceStub({})
  await assert.rejects(() => nativeSeatFace(bare.ctx, 'session-1').openFile('a.js'), /remote\.session 不可用/)
})

test('原生注入面：loadImage / fileMentions / forkAt 的可用与降级', async () => {
  const { nativeSeatFace } = client.__internals
  const owners = []
  const { ctx, calls } = seatFaceStub({
    uiConversation: {
      imageUrl: (sessionId, attachment) => `url:${sessionId}:${attachment}`,
      peekImageUrl: (sessionId, attachment) => `peek:${sessionId}:${attachment}`,
    },
    chatFileMentions: {
      forClosing: (owner) => {
        owners.push(owner)
        return ['a.js']
      },
    },
  })
  const face = nativeSeatFace(ctx, 'session-1')
  assert.equal(face.loadImage('x.png'), 'url:session-1:x.png')
  assert.equal(face.loadImage.peek('x.png'), 'peek:session-1:x.png')
  assert.deepEqual(face.fileMentions({ seq: 9 }), ['a.js'])
  assert.deepEqual(owners, [{ seq: 9 }])

  face.forkAt(42)
  assert.deepEqual(calls.forked, [{ sessionId: 'session-1', atSeq: 42, increaseTitle: true }])
  await Promise.resolve()
  assert.deepEqual(calls.opened, ['child-1'], '分叉成功后应打开子会话')

  // 服务缺席时能力降级为「没有」，而不是抛异常把视图带崩。
  const bare = nativeSeatFace(seatFaceStub({}).ctx, 'session-1')
  assert.equal(bare.loadImage, undefined)
  assert.equal(bare.fileMentions({ seq: 1 }), undefined)
  assert.doesNotThrow(() => bare.forkAt(1))
})

/* ──────────────────────────── 本轮修的行为 ──────────────────────────── */

/** 造一个最小的回合模型（只带渲染层用到的字段）。 */
function turnGroup(overrides = {}) {
  return {
    key: 'turn:1',
    turn: 1,
    input: undefined,
    closed: false,
    unfinished: false,
    durationMs: 0,
    startedAt: 1_000_000,
    liveKey: null,
    inputText: '',
    planned: false,
    planNodes: [],
    segments: [],
    looseNodes: [],
    closing: [],
    footerNodes: [],
    subagents: { notices: new Map(), consumed: new Set() },
    stats: { counts: { thinking: 0, command: 0, read: 0, file: 0, mcp: 0, question: 0 }, listed: 0 },
    ...overrides,
  }
}

test('任务耗时：正在跑的回合实时计时（0 分 0 秒起），结束的回合用派生值', () => {
  const { views, formatDuration, ZH } = client.__internals
  const t = (key, params) => {
    const template = ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  assert.match(formatDuration(0, t), /0分0秒/, '计时从 0 分 0 秒开始，分位始终显示')
  assert.match(formatDuration(65_000, t), /1分5秒/)

  const live = views.TurnGroup({
    group: turnGroup(),
    t,
    sessionId: 'session-duration-live',
    labels: {},
    live: true,
    seat: undefined,
    now: 1_000_000 + 5_000,
  })
  assert.match(collectText(live), /任务耗时 0分5秒/, '正在跑的回合用 now - startedAt 实时算')

  const settled = views.TurnGroup({
    group: turnGroup({ closed: true, durationMs: 62_000 }),
    t,
    sessionId: 'session-duration-settled',
    labels: {},
    live: false,
    seat: undefined,
    now: 1_000_000 + 900_000,
  })
  assert.match(collectText(settled), /任务耗时 1分2秒/, '结束的回合用派生层的固定耗时，不再跟着时钟走')
})

test('插队 / 排队的消息在列表末尾有座位，并标出各自状态', () => {
  const { view, t } = bootView()
  const session = {
    hasMore: false,
    loadingOlder: false,
    running: true,
    queue: [{ id: 'q1', placement: 'steering', content: [{ type: 'text', text: '插一句话' }] }],
    pendingSubmissions: [{ requestId: 'rpc-1', placement: 'steering', text: '刚发出去的' }],
  }
  const tree = view.component({
    sessionId: 'session-pending',
    t,
    useChat: (selector) => selector(makeSnapshot([userNode('u1', 1, '干活')])),
    useSession: (selector) => selector(session),
  })
  const text = collectText(tree)
  assert.match(text, /插一句话/)
  assert.match(text, /插队待处理/)
  assert.match(text, /刚发出去的/)
  const steeringSeat = findElement(tree, (element) => element.props?.['data-pending-steering'] === 'true')
  assert.ok(steeringSeat !== undefined, '插队座位要带核心约定的 data-pending-steering（回退插件按它找座位）')

  // 已经变成正式节点的那条不再以回显形式重复出现。
  const landed = makeSnapshot([userNode('u1', 1, '干活')])
  landed.nodes.get('u1').data.source = { kind: 'user', rpcId: 'rpc-1' }
  const deduped = view.component({
    sessionId: 'session-pending-2',
    t,
    useChat: (selector) => selector(landed),
    useSession: (selector) => selector(session),
  })
  assert.equal(collectText(deduped).includes('刚发出去的'), false)
  assert.match(collectText(deduped), /插一句话/, '插队项仍在队列里，照常显示')
})

test('取消键留下的半截过程：标成「被打断」，点开才加载那半截内容', () => {
  const { view, t } = bootView()
  const half = assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '写到一半就停了' }])
  half.data.status = 'interrupted'
  const props = {
    sessionId: 'session-cut-off',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          half,
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  }
  const tree = view.component(props)
  const text = collectText(tree)
  assert.match(text, /被打断/, '半截的过程要写「被打断」（用户要求用这个词，不要「未完成」）')
  assert.equal(text.includes('未完成'), false, '不再出现「未完成」字样')
  assert.equal(text.includes('写到一半就停了'), false, '收起即不渲染：懒加载的正文不在 DOM 里')
  const head = findElement(
    tree,
    (element) =>
      String(element.props?.className ?? '').includes('dcf-thinkinghead') && collectText(element).includes('被打断'),
  )
  assert.equal(head.props['aria-expanded'], false, '思考块一律默认收起（用户要求），点开即可看到半截内容')

  expandThinkingBlocks(view, props)
  assert.match(
    collectText(view.component(props)),
    /写到一半就停了/,
    '点开折叠头后那半截内容按需加载出来（内容本身没丢，只是收起时不渲染）',
  )
})

test('视图层错误边界：本插件自己的渲染错误降级成错误摘要，而非让整块视图让位', async () => {
  // 这一条同样需要「createElement 不立刻调用组件」的探针 React 才能拿到边界元素本身。
  // 组件现在会调 hook（「子代理显示」开关），所以必须用探针的 `mount` 跑（直接调用没有槽位）。
  const probe = createProbeReact()
  const probeModule = await loadBundle({ react: probe.react })
  const { views } = probeModule.exports.__internals
  const t = (key) => key
  const element = probe.mount(views.TaskFlowView, {
    t,
    useChat: () => ({}),
    useSession: () => ({}),
  }).value
  const Boundary = element.type
  assert.equal(typeof Boundary.getDerivedStateFromError, 'function', 'TaskFlowView 必须把主体包在错误边界里')

  assert.deepEqual(Boundary.getDerivedStateFromError(new Error('boom')), { failed: true, message: 'boom' })
  assert.deepEqual(Boundary.getDerivedStateFromError('not-an-error'), { failed: true, message: 'not-an-error' })

  const instance = new Boundary({ t, children: 'BODY' })
  assert.equal(instance.render(), 'BODY', '正常时渲染视图主体')
  instance.state = { failed: true, message: 'boom' }
  const strip = instance.render()
  assert.equal(strip.props['data-dcf-error'], 'boom')
  assert.match(collectText(strip), /flow\.error\.title/)

  // 重试按钮：没有它，一次瞬时异常（例如某个原生叶子在错误的时机抛错）会把整块视图锁死在
  // 错误摘要上，用户只能刷新页面——「任务视图莫名变白且点不动」。
  const retry = findElement(strip, (element) => element.props?.['data-dcf-error-retry'] === 'true')
  assert.ok(retry !== undefined, '错误摘要必须带重试按钮')
  assert.equal(typeof retry.props.onClick, 'function', '重试按钮要能点')
  retry.props.onClick()
  assert.equal(instance.state.failed, false, '点重试清掉失败态，子树重新挂载')

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    instance.componentDidCatch(new Error('boom'))
  } finally {
    console.warn = originalWarn
  }
  assert.equal(warnings.length, 1, '必须留日志线索')
  assert.match(String(warnings[0][0]), /任务视图渲染失败/)
})

/**
 * 某个元素在树里的「折叠层深」：0 = 不在任何折叠体里，1 = 在第一层折叠体里……
 * 用来断言「收尾动作行没有被折进任务过程」。
 *
 * @param element - 根元素。
 * @param predicate - 命中判定。
 * @returns 层深；没找到时返回 -1。
 */
function foldDepthOf(element, predicate) {
  const depths = foldDepthsOf(element, predicate)
  return depths.length === 0 ? -1 : depths[0]
}

/**
 * 同 {@link foldDepthOf}，但返回**全部**命中元素的层深（按出现顺序）。
 *
 * 需要它是因为「同一段正文同时出现在里外两处」这种缺陷只断言第一个命中的层深是抓不到的。
 *
 * @param element - 根元素。
 * @param predicate - 命中判定。
 * @returns 层深数组。
 */
function foldDepthsOf(element, predicate) {
  const found = []
  const walk = (value, depth) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth)
      return
    }
    const props = value.props ?? {}
    if (predicate(value)) found.push(depth)
    walk(props.children, props.className === 'dcf-fold' ? depth + 1 : depth)
  }
  walk(element, 0)
  return found
}

test('收尾动作行排在总结之后，且不在「任务过程」折叠体里', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-footer-order',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
          assistantNode('a1', 1, 2, [{ kind: 'text', text: '两件事都做完了' }]),
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })

  const turn = findElement(tree, (element) => element.props?.className === 'dcf-turn')
  assert.ok(turn !== undefined, '应渲染出回合容器')
  const children = (Array.isArray(turn.props.children) ? turn.props.children : [turn.props.children]).filter(Boolean)
  const labels = children.map(
    (child) => child.props?.['data-chat-flow-kind'] ?? child.props?.className,
  )
  assert.equal(labels[labels.length - 1], 'turn-tail', '收尾动作行是回合的最后一个子节点（总结之后）')
  assert.equal(
    labels.indexOf('turn-tail') === labels.lastIndexOf('turn-tail') ? 1 : 0,
    1,
    '收尾动作行只渲染一次',
  )
  assert.equal(
    foldDepthOf(turn, (element) => element.props?.['data-chat-flow-kind'] === 'turn-tail'),
    0,
    '收尾动作行必须落在所有折叠体之外（用户报告过它跑进了「任务过程」）',
  )
  // 正文（总结）在收尾行之前，且正文本身也在折叠体之外。
  assert.equal(
    foldDepthOf(
      turn,
      (element) =>
        String(element.props?.className ?? '').includes('dcf-leaf') &&
        collectText(element).includes('两件事都做完了'),
    ),
    0,
    '任务汇报那一行不在任何折叠体里',
  )
})

test('「任务过程」跑动中默认展开且不允许关闭；任务结束后才可开合', () => {
  const { view, t } = bootView()
  const running = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'echo a', 'a'),
  ])
  const liveTree = view.component({
    sessionId: 'session-stage-live',
    t,
    useChat: (selector) => selector(running),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })
  const liveRow = findElement(
    liveTree,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('任务过程'),
  )
  assert.ok(liveRow !== undefined, '应有「任务过程」折叠头')
  assert.equal(liveRow.props['data-locked'], 'true', '跑动中折叠头被锁住')
  assert.equal(
    typeof liveRow.props.onClick,
    'undefined',
    '跑动中点不动它——「任务完成了以后才允许关闭这个节点」',
  )
  assert.equal(
    findElement(liveTree, (element) => element.props?.className === 'dcf-fold')?.props['data-open'],
    'true',
    '跑动中「任务过程」默认展开',
  )
  assert.match(collectText(liveRow), /任务耗时/, '折叠头上实时写着耗时')

  // 任务结束（有收尾节点）：折叠头恢复成可点按钮，默认收起，点一下能打开。
  const settledProps = {
    sessionId: 'session-stage-settled',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          turnTailNode('tt1', 1, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  }
  const settled = view.component(settledProps)
  const settledRow = findElement(
    settled,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('任务过程'),
  )
  assert.equal(settledRow.props['aria-expanded'], false, '任务结束后默认收起')
  assert.equal(typeof settledRow.props.onClick, 'function', '任务结束后可以自由开合')
  settledRow.props.onClick()
  const afterToggle = view.component(settledProps)
  const afterRow = findElement(
    afterToggle,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('任务过程'),
  )
  assert.equal(afterRow.props['aria-expanded'], true, '手动打开后保持打开')
})

/* ──────────────────────────── 本轮（第十一轮）的行为 ──────────────────────────── */

test('回合级「没走完」写中性提示，不写成「被打断」；思考块也不会被传染', () => {
  const { view, t } = bootView()
  // 一个「没善终」的回合：任务还是 in_progress，而且有后台子 agent 只回了 started 一行。
  // 但**没有任何真实中断证据**（工具都跑完了、assistant-step 也不是 interrupted）——
  // 旧版本在这里写「被打断」，正是用户报的「对话完成了却显示被打断」（回合级误报）。
  const childId = '11111111-2222-3333-4444-555555555555'
  const tree = view.component({
    sessionId: 'session-cutoff-scope',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          subagentCallNode('s1', 1, 3, '去研究一下', `started subagent ${childId}`),
          turnTailNode('tt1', 1, 4),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })

  const heads = preorderOf(tree).filter((element) =>
    String(element.props?.className ?? '').includes('dcf-thinkinghead'),
  )
  assert.ok(heads.length > 0, '应有思考块')
  for (const head of heads) {
    assert.equal(
      collectText(head).includes('被打断'),
      false,
      '这一块自己没有被中断（工具都跑完了）→ 不能写「被打断」',
    )
    assert.match(collectText(head), /思考已完成/, '正常跑完的块写「思考已完成」')
  }
  // 回合级的提示仍然挂在「任务过程」折叠头上（那里才是说回合整体的地方），但措辞是中性的：
  // 清单没走完 ≠ 被打断（用户裁决：超时/结果未知/清单陈旧都不算被打断）。
  const stageRow = findElement(
    tree,
    (element) => String(element.props?.className ?? '').includes('dcf-row') && collectText(element).includes('任务过程'),
  )
  assert.match(collectText(stageRow), /清单未走完/, '陈旧的任务清单只写中性提示')
  assert.equal(collectText(stageRow).includes('被打断'), false, '没有真实中断证据，就不许写「被打断」')
  const chip = findElement(
    stageRow,
    (element) => String(element.props?.className ?? '') === 'dcf-chip',
  )
  assert.ok(chip !== undefined, '折叠头要挂一枚状态徽标')
  assert.equal(chip.props['data-tone'], 'muted', '中性提示用 muted 色调，不报警')
})

test('回合级「被打断」只在有真实中断证据时出现（工具被取消 → warn 色）', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-cutoff-true',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
          interruptedPwshNode('t1', 1, 2, 'sleep 999'),
          assistantNode('a1', 1, 3, [{ kind: 'text', text: '停在这里。' }]),
          turnTailNode('tt1', 1, 4),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })
  const chips = preorderOf(tree).filter(
    (element) =>
      String(element.props?.className ?? '') === 'dcf-chip' && collectText(element).includes('被打断'),
  )
  assert.ok(chips.length > 0, '有真实中断证据（工具被取消）时回合级要写「被打断」')
  assert.ok(
    chips.some((chip) => chip.props['data-tone'] === 'warn'),
    '真实中断是警示色（warn），不是中性色',
  )
})

test('子 agent 只回了 started 一行时，回合不算「被打断」', () => {
  const { deriveFlow } = client.__internals
  const childId = '11111111-2222-3333-4444-555555555555'
  const group = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
      subagentCallNode('s1', 1, 2, '去研究一下', `started subagent ${childId}`),
      turnTailNode('tt1', 1, 3),
    ]),
  ).turns[0]
  assert.equal(group.closed, true)
  assert.equal(
    group.unfinished,
    false,
    '后台子 agent 报告未到是正常情况，不该把整个回合标成「被打断」',
  )
})

test('任务列表：只有最新一块默认展开，被接管的旧块自动折叠并显示「已停止」', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-plate-superseded',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [
            { content: '任务A', status: 'in_progress' },
            { content: '任务B', status: 'pending' },
          ]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          todoNode('p2', 1, 3, [
            { content: '任务A', status: 'completed' },
            { content: '任务B', status: 'in_progress' },
          ]),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })
  const heads = preorderOf(tree).filter((element) =>
    String(element.props?.className ?? '').includes('dcf-platehead'),
  )
  assert.equal(heads.length, 2, '两块任务列表快照')
  assert.equal(heads[0].props['aria-expanded'], false, '新列表出现后，旧列表自动折叠（用户要求）')
  assert.equal(heads[1].props['aria-expanded'], true, '只有最新那一块默认展开')

  // 旧块里的「进行中」不再显示运行态，而是「已停止」（内容冻结，运行状态跟最新列表走）。
  const plates = preorderOf(tree).filter((element) => element.props?.className === 'dcf-plate')
  assert.equal(plates.length, 2)
  const rowsOf = (plate) =>
    preorderOf(plate).filter((element) => String(element.props?.className ?? '').includes('dcf-taskrow'))
  const oldRow = rowsOf(plates[0]).find((row) => collectText(row).includes('任务A'))
  assert.equal(oldRow.props['data-status'], 'stopped', '被接管的旧块里那一项显示成「已停止」')
  assert.match(collectText(oldRow), /已停止/)
  // 最新那一块里进行中的那一项照旧是运行态。
  const liveRow = rowsOf(plates[1]).find((row) => collectText(row).includes('任务B'))
  assert.equal(liveRow.props['data-status'], 'in_progress')
  assert.match(collectText(liveRow), /进行中/)
  // 两块面板合起来：只有一个「进行中」（最新那一版里的任务B），旧块那一项已经变成「已停止」。
  const plateRows = plates.flatMap((plate) => rowsOf(plate))
  assert.equal(plateRows.filter((row) => row.props['data-status'] === 'in_progress').length, 1)
  assert.equal(plateRows.filter((row) => row.props['data-status'] === 'stopped').length, 1)
})

test('任务列表：整表都已完成的「当前那一版」也默认收起', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-plate-done-default',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [
            { content: '任务A', status: 'in_progress' },
            { content: '任务B', status: 'pending' },
          ]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          todoNode('p2', 1, 3, [
            { content: '任务A', status: 'completed' },
            { content: '任务B', status: 'completed' },
          ]),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })
  const heads = preorderOf(tree).filter((element) =>
    String(element.props?.className ?? '').includes('dcf-platehead'),
  )
  assert.equal(heads.length, 2, '两块任务列表快照')
  assert.equal(heads[0].props['aria-expanded'], false, '旧块被接管 → 收起')
  assert.equal(heads[1].props['aria-expanded'], false, '「全部已完成」的当前那一版也默认收起')
})

test('对话最前端不出现「无操作」的残留思考块', () => {
  const { view, t } = bootView()
  const props = {
    sessionId: 'session-blank-run',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          turnProcessNode('tp1', 1, 1),
          userNode('u1', 1, '干活'),
          blankAssistantNode('b1', 1, 1),
          assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '真的在想' }]),
          pwshNode('t1', 1, 3, 'echo a', 'a'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  }
  const tree = view.component(props)
  const text = collectText(tree)
  assert.equal(/无操作/.test(text), false, '不该出现「无操作」的思考块')
  assert.equal(
    countIn(tree, (element) => String(element.props?.className ?? '').includes('dcf-turn')),
    1,
    '最前面不该多出一个分组',
  )
  assert.equal(
    countIn(tree, (element) => String(element.props?.className ?? '').includes('dcf-thinkinghead')),
    1,
    '只有真正有内容的思考块才画',
  )
  // 懒加载：正文在收起态不进树，点开后才看得到那一条推理。
  expandThinkingBlocks(view, props)
  assert.match(collectText(view.component(props)), /真的在想/)
})

test('整块渲染成空的过程不画思考块（夹在正文之间的空白步）', () => {
  const { view, t } = bootView()
  // 空白步（没有正文也没有推理）被两段正文夹住 → 它**独占一个过程 run**，
  // 画出来就是一个「无操作」的空思考块（用户报告过最前面那块残留）。
  const props = {
    sessionId: 'session-blank-run-alone',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          assistantNode('a1', 1, 1, [{ kind: 'text', text: '先说一句。' }]),
          blankAssistantNode('b1', 1, 2),
          assistantNode('a2', 1, 3, [{ kind: 'text', text: '再说一句。' }]),
          assistantNode('a3', 1, 4, [{ kind: 'reasoning', text: '真的在想' }]),
          pwshNode('t1', 1, 5, 'echo a', 'a'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  }
  const tree = view.component(props)
  const text = collectText(tree)
  assert.equal(/无操作/.test(text), false, '空白的过程不画折叠头，也就不会出现「无操作」')
  assert.equal(
    countIn(tree, (element) => String(element.props?.className ?? '').includes('dcf-thinkinghead')),
    1,
    '只画真正有内容的那个思考块',
  )
  // 懒加载：那一块是「真正有内容」的那个，点开才看得到它的正文。
  expandThinkingBlocks(view, props)
  assert.match(collectText(view.component(props)), /真的在想/)
})

test('展开箭头：包裹盒与图标盒同尺寸并居中，旋转中心才是箭头中心', () => {
  const { FLOW_CSS } = client.__internals
  assert.match(
    FLOW_CSS,
    /\.dcf-chev\{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/,
    '箭头包裹盒用 flex 居中，避免 inline svg 被行高顶到基线上',
  )
  assert.match(FLOW_CSS, /\.dcf-chev>svg\{display:block\}/, 'svg 去掉行内基线的额外空隙')
  assert.match(FLOW_CSS, /\.dcf-chev\{[^}]*transform-origin:center/, '显式写旋转中心为几何中心')
})

test('跑动中：过程中写的正文全在「任务过程」里，最外层不放正文', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-midtext-live',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '看一眼再动手'),
          assistantNode('a1', 1, 1, [{ kind: 'text', text: '先看一下代码。' }]),
          pwshNode('t1', 1, 2, 'rg foo', 'ok'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })
  // 判定必须落在**那一行**上（`dcf-leaf`），否则祖先元素也含这段文字，断言会恒真。
  const rowOf = (needle) => (element) =>
    String(element.props?.className ?? '').includes('dcf-leaf') && collectText(element).includes(needle)
  assert.deepEqual(
    foldDepthsOf(tree, rowOf('先看一下代码。')),
    [1],
    '跑动中穿插的正文只在「任务过程」里出现一次（既不能摆到最外层，也不能里外各画一份）',
  )
})

test('任务结束后：只有最后一段正文（汇报）留在最外层', () => {
  const { view, t } = bootView()
  const rowOf = (needle) => (element) =>
    String(element.props?.className ?? '').includes('dcf-leaf') && collectText(element).includes(needle)
  const tree = view.component({
    sessionId: 'session-midtext-closed',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          assistantNode('a1', 1, 1, [{ kind: 'text', text: '先写个计划。' }]),
          todoNode('p1', 1, 2, [{ content: '任务A', status: 'completed' }]),
          assistantNode('a2', 1, 3, [{ kind: 'text', text: 'A 已经做完了。' }]),
          turnTailNode('tt1', 1, 4),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })

  assert.deepEqual(
    foldDepthsOf(tree, rowOf('A 已经做完了。')),
    [0],
    '任务结束时的那段汇报只在最外层出现一次（这是「对用户输出」的第四个时机）',
  )
  assert.deepEqual(
    foldDepthsOf(tree, rowOf('先写个计划。')),
    [1],
    '同一回合里穿插写的正文（规划阶段那句）只收在折叠体里，不摆到最外层',
  )
})

test('任务清单没收尾（最后一项仍 in_progress）时，结尾正文照样留在最外层', () => {
  const { view, t } = bootView()
  const rowOf = (needle) => (element) =>
    String(element.props?.className ?? '').includes('dcf-leaf') && collectText(element).includes(needle)
  const tree = view.component({
    sessionId: 'session-midtext-stale-plan',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          assistantNode('a1', 1, 1, [{ kind: 'text', text: '先写个计划。' }]),
          // 清单停在「进行中」：回合结束了，但最后一项没人去标 completed。
          todoNode('p1', 1, 2, [{ content: '任务A', status: 'completed' }, { content: '任务B', status: 'in_progress' }]),
          assistantNode('a2', 1, 3, [{ kind: 'text', text: '任务B 先放着，总结如下。' }]),
          turnTailNode('tt1', 1, 4),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })

  // 旧版本的收尾提取带了 `last.activeIndex < 0` 的前置条件：清单只要还有一项 in_progress，
  // 结尾正文就留在「任务过程」折叠体内——用户报的「总结显示在任务过程里面」。
  assert.deepEqual(
    foldDepthsOf(tree, rowOf('任务B 先放着，总结如下。')),
    [0],
    '收尾汇报是否留在最外层，只看它是不是结尾那段正文，与清单有没有标完无关',
  )
  assert.deepEqual(
    foldDepthsOf(tree, rowOf('先写个计划。')),
    [1],
    '规划阶段那句仍然只在折叠体里',
  )
})

/* ──────────────────────────── 本轮（第七轮）的行为 ──────────────────────────── */

/**
 * 前序遍历元素树，返回所有元素（按出现顺序）。
 *
 * @param element - 根元素。
 * @returns 元素数组。
 */
function preorderOf(element) {
  const seen = []
  const walk = (value) => {
    if (value === null || value === undefined || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    seen.push(value)
    walk(value.props?.children)
  }
  walk(element)
  return seen
}

/** 子树里满足条件的元素个数。 */
function countIn(element, predicate) {
  return preorderOf(element).filter(predicate).length
}

test('规划段并进任务过程：不再有独立的「规划过程」折叠体，也不重复显示任务列表', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-plan-once',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划一下。' }]),
          todoNode('p1', 1, 2, [
            { content: '任务A', status: 'in_progress' },
            { content: '任务B', status: 'pending' },
          ]),
          pwshNode('t1', 1, 3, 'echo a', 'a'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })

  // 任务列表只出现一次（就是那一块快照面板）——以前规划过程里还会再画一份初稿清单。
  assert.equal(
    countIn(tree, (element) => String(element.props?.className ?? '').includes('dcf-platehead')),
    1,
    '任务列表快照面板只应有一块',
  )
  // 「规划过程」作为**独立折叠体**已被移除（用户要求「移除掉规划过程，全部算任务过程里面」）：
  // 回合块的直接子节点里只该有用户气泡、任务过程、任务列表快照面板、收尾控件；没有第二个折叠头。
  assert.equal(
    countIn(tree, (element) => String(element.props?.className ?? '').includes('dcf-planfold')),
    0,
    '不应再有独立的「规划过程」折叠体',
  )
  const turn = findElement(tree, (element) => element.props?.className === 'dcf-turn')
  const children = (Array.isArray(turn.props.children) ? turn.props.children : [turn.props.children]).filter(Boolean)
  assert.equal(
    children.some((child) => String(child.props?.className ?? '').includes('dcf-planfold')),
    false,
    '回合块下不该再挂「规划过程」折叠体',
  )
  // 规划段的内容必须**还在**，而且是折进「任务过程」那个折叠体里（不能因为删折叠体把内容丢了）。
  const stage = findElement(turn, (element) => element.props?.className === 'dcf-block')
  assert.ok(stage !== undefined, '应有「任务过程」折叠体')
  const stageText = collectText(stage)
  assert.match(stageText, /先规划一下。/, '动手之前说的那段话要落在任务过程里')
  assert.match(stageText, /任务A/, '第一个任务列表快照也要在同一个折叠体里')
  assert.equal(/规划过程/.test(collectText(tree)), false, '界面上不该再出现「规划过程」这个标题')
})

test('思考块被正文切成多块：正文一出现，上一块封口，下一块重新开始', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-runs',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '第一段思考' }]),
          assistantNode('a2', 1, 3, [{ kind: 'text', text: '第一段结论' }]),
          pwshNode('t1', 1, 4, 'echo a', 'a'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })

  const nodes = preorderOf(tree)
  const heads = nodes.filter((element) => String(element.props?.className ?? '').includes('dcf-thinkinghead'))
  const textRows = nodes.filter(
    (element) =>
      String(element.props?.className ?? '').includes('dcf-leaf') && collectText(element).includes('第一段结论'),
  )
  assert.equal(heads.length, 2, '正文把过程切成两块：动作 → 正文 → 动作')
  assert.ok(nodes.indexOf(heads[0]) < nodes.indexOf(textRows[0]), '第一块在正文之前')
  assert.ok(nodes.indexOf(textRows[0]) < nodes.indexOf(heads[1]), '第二块在正文之后（新节点从这里开始）')
  assert.match(collectText(heads[0]), /思考已完成/, '被正文封口的那一块是「已完成」')
  assert.match(collectText(heads[1]), /思考中/, '还包含最后一个节点的那一块是「思考中」')
  for (const head of heads) {
    assert.equal(head.props['aria-expanded'], false, '思考块一律默认收起（用户要求）')
  }
})

test('系统提示词并入「上下文准备」，只成一个折叠点', () => {
  const { view, t } = bootView()
  const props = {
    sessionId: 'session-context-merge',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          contextNode('c1', 1, 1, '记忆：项目在 D 盘'),
          systemPromptNode('sp1', 1, 2, '你是 DSH 的编码代理'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  }
  // 上下文注入与系统提示词都是过程节点，装在懒加载的思考块正文里——先点开它。
  expandThinkingBlocks(view, props)
  const tree = view.component(props)

  const contextFolds = preorderOf(tree).filter((element) =>
    String(element.props?.className ?? '').includes('dcf-row'),
  )
  const titled = contextFolds.filter((element) => collectText(element).includes('上下文准备'))
  assert.equal(titled.length, 1, '系统提示词与上下文注入合并成同一个折叠点')
  assert.match(collectText(titled[0]), /2 段注入/, '折叠头写段数（两种来源都算）')
  assert.equal(titled[0].props['aria-expanded'], false, '默认收起')
  const text = collectText(titled[0])
  assert.match(text, /上下文准备/)
  assert.equal(
    preorderOf(tree).some((element) => collectText(element).includes('系统提示词')),
    false,
    '不再有单独的「系统提示词」行',
  )
})

test('任务列表只写「已完成：…」，不写「本次变化」', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-plate-done',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [
            { content: '任务A', status: 'in_progress' },
            { content: '任务B', status: 'pending' },
          ]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          todoNode('p2', 1, 3, [
            { content: '任务A', status: 'completed' },
            { content: '任务B', status: 'in_progress' },
          ]),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })

  const text = collectText(tree)
  assert.match(text, /已完成：任务A/, '第二块快照点出这一版里已完成的那一项')
  assert.equal(text.includes('本次变化'), false, '不再写「本次变化」那种对比说明')
  assert.equal(text.includes('✓'), false, '也不再出现变化符号')
})

test('插队消息留在最外层：它自己的行不被任何折叠体吞掉，且后面另起一块', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-steering-top',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '第一件事'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '先想一下' }]),
          steeringNode('s1', 1, 3, '顺便把这个也做了'),
          pwshNode('t1', 1, 4, 'echo b', 'b'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  })

  const nodes = preorderOf(tree)
  const steeringRow = nodes.find((element) => element.props?.['data-chat-flow-kind'] === 'steering')
  assert.ok(steeringRow !== undefined, '插队消息应当有一条自己的行')
  assert.equal(
    foldDepthOf(tree, (element) => element.props?.['data-chat-flow-kind'] === 'steering'),
    0,
    '插队消息必须在所有折叠体之外（用户要求用户内容永远留在最外层）',
  )
  assert.match(collectText(steeringRow), /插队/, '行首标记写明它是插队消息')
  // 插队之前的思考块必须在它上面，插队之后的动作在它下面。
  const heads = nodes.filter((element) => String(element.props?.className ?? '').includes('dcf-thinkinghead'))
  assert.equal(heads.length, 2, '插队把过程切成两块：插队前一块、插队后一块')
  assert.ok(nodes.indexOf(heads[0]) < nodes.indexOf(steeringRow), '第一块在插队消息之前')
  assert.ok(nodes.indexOf(steeringRow) < nodes.indexOf(heads[1]), '第二块在插队消息之后（新节点从这里开始）')
  assert.equal(text2Blocks(tree), true, '第一块被插队消息封口（思考已完成），第二块还在写（思考中）')
})

/** 断言两块的标题一个「思考已完成」、一个「思考中」（第一块被插队消息封口）。 */
function text2Blocks(tree) {
  const heads = preorderOf(tree).filter((element) =>
    String(element.props?.className ?? '').includes('dcf-thinkinghead'),
  )
  return /思考已完成/.test(collectText(heads[0])) && /思考中/.test(collectText(heads[heads.length - 1]))
}

/* ─────────────────── 回滚隐藏节点 / 懒加载边界 / 回到底部 / 删除清理 ─────────────────── */

test('被标记为隐藏的节点（回滚掉的旧版本）不出现在任务视图里', () => {
  const { orderedNodes } = client.__internals
  const node = (key) => ({ key, kind: 'user-input', visibility: 'visible', data: {} })
  const hidden = (key) => ({ key, kind: 'assistant-step', visibility: 'hidden', data: {} })
  const snapshot = {
    order: ['u1', 'h1', 'a1'],
    nodes: new Map([
      ['u1', node('u1')],
      ['h1', hidden('h1')],
      ['a1', node('a1')],
    ]),
  }
  assert.deepEqual(
    orderedNodes(snapshot).map((item) => item.key),
    ['u1', 'a1'],
    'order 里还留着的旧节点，只要 visibility=hidden 就不显示',
  )
  // order 拿不到东西时才退化成「取 Map 全部值」——降级路径同样要过滤隐藏节点。
  assert.deepEqual(
    orderedNodes({ order: [], nodes: new Map([['h1', hidden('h1')]]) }),
    [],
    '降级路径也要过滤隐藏节点',
  )
  assert.deepEqual(
    orderedNodes({ order: null, nodes: new Map([['u1', node('u1')], ['h1', hidden('h1')]]) }).map((i) => i.key),
    ['u1'],
    '降级路径留下可见节点',
  )
  assert.deepEqual(orderedNodes(undefined), [], '没有快照时给空数组')
})

test('懒加载只给思考块：其它折叠体收起时子树照旧挂载', () => {
  const { view, t } = bootView()
  const props = {
    sessionId: 'session-lazy-scope',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  }
  const tree = view.component(props)

  // 最外层「任务过程」默认收起（任务已结束），但里面的任务列表子树仍在树里——
  // 折叠动画、嵌套展开状态都依赖「只隐藏不卸载」这条契约，只有思考块例外。
  const stageFold = preorderOf(tree).find(
    (element) => String(element.props?.className ?? '').includes('dcf-fold') && collectText(element).includes('任务列表'),
  )
  assert.ok(stageFold !== undefined, '「任务过程」收起时，它里面的任务列表子树仍应挂载')
  assert.equal(stageFold.props['data-open'], 'false', '而它确实是收起的（只改 CSS 轨道高度）')

  // 思考块是唯一懒加载的折叠体：收起时正文（原生座位、命令卡）根本不在树里。
  const thinking = findElement(tree, (element) => String(element.props?.className ?? '').includes('dcf-thinking'))
  assert.ok(thinking !== undefined, '应有思考块')
  const thinkingBody = findElement(thinking, (element) => element.props?.className === 'dcf-body')
  assert.equal(thinkingBody.props.children, null, '思考块收起时正文不渲染（唯一传 lazy 的折叠体）')
  assert.equal(collectText(thinking).includes('echo a'), false, '收起态看不到命令明细')

  // 点开之后正文才进树。
  expandThinkingBlocks(view, props)
  const opened = findElement(view.component(props), (element) => String(element.props?.className ?? '').includes('dcf-thinking'))
  const openedBody = findElement(opened, (element) => element.props?.className === 'dcf-body')
  assert.notEqual(openedBody.props.children, null, '展开后正文按需加载出来')
})

test('导轨加载时默认落在最后一轮（不给初始值时留给 measure 决定）', () => {
  const { useScroller } = client.__internals
  const rootRef = { current: null }
  assert.equal(
    useScroller(rootRef, { turns: [1, 2] }).activeTurn,
    null,
    '不给 initialActiveTurn 时先不选中，等 measure() 按视口判定',
  )
  assert.equal(
    useScroller(rootRef, { turns: [1, 2], initialActiveTurn: 2 }).activeTurn,
    2,
    '给了初始值就直接落在最后一轮，不再把最上面那轮误判成 active',
  )
})

test('导轨默认高亮最后一个回合（视图侧接线）', () => {
  const { view, t } = bootView()
  const tree = view.component({
    sessionId: 'session-rail-default',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '第一件事'),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          turnTailNode('tt1', 1, 3),
          userNode('u2', 2, '第二件事'),
          pwshNode('t2', 2, 2, 'echo b', 'b'),
          turnTailNode('tt2', 2, 3),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  })

  const marks = preorderOf(tree).filter((element) => element.props?.className === 'dcf-mark')
  assert.equal(marks.length, 2, '两个回合两个刻度')
  assert.deepEqual(marks.map((element) => collectText(element)), ['1', '2'], '刻度上写的是回合号数字')
  const active = marks.filter((element) => element.props['data-active'] === 'true')
  assert.equal(active.length, 1, '同时只有一个刻度是 active')
  assert.equal(active[0].props['aria-label'], '跳到第 2 轮', '默认落在最后一轮，而不是第一轮')
  assert.equal(active[0].props['aria-current'], 'true', '无障碍上也标出当前回合')
})

test('导轨滚到底：默认停在顶部就看不见最后一格', () => {
  const { scrollRailToBottom } = client.__internals
  const rail = { scrollTop: 0, scrollHeight: 720 }
  scrollRailToBottom(rail)
  assert.equal(rail.scrollTop, 720, '滚到最底，最后一格（当前回合）才露出来')
  assert.doesNotThrow(() => scrollRailToBottom(null), '导轨还没挂上时静默跳过')
  assert.doesNotThrow(() => scrollRailToBottom(undefined), '拿不到导轨也不炸')
})

test('加载中的刻度：「更早」刻度让位给转圈，但读数文案仍可读', () => {
  const { views, ZH, OLDER_TICK } = client.__internals
  const t = (key, params) => (params === undefined ? ZH[key] ?? key : (ZH[key] ?? key).replace(/\{(\w+)\}/g, (m, name) => String(params[name])))
  const tree = views.TurnRail({
    items: [
      { turn: OLDER_TICK, loaded: false, seq: null },
      { turn: 3, loaded: true, seq: null },
    ],
    activeTurn: 3,
    liveTurn: null,
    busyTurn: OLDER_TICK,
    onJump: () => {},
    t,
  })
  const marks = preorderOf(tree).filter((element) => element.props?.className === 'dcf-mark')
  assert.equal(marks[0].props['data-loaded'], 'false', '「更早」刻度排在最前')
  assert.equal(marks[0].props['data-busy'], 'true')
  assert.equal(findElement(marks[0], (element) => element.props?.className === 'dcf-spinner') !== undefined, true, '加载中显示转圈')
  assert.equal(marks[0].props['aria-busy'], 'true')
  assert.equal(marks[0].props['aria-label'], '加载更早的回合', '数字让位了，但屏幕阅读器仍能听到这一格是什么')
})

test('快速回到底部：判据、滚动动作、样式与文案都在位', () => {
  const { isAwayFromBottom, scrollViewToBottom, BOTTOM_THRESHOLD_PX, FLOW_CSS, ZH, EN } = client.__internals
  assert.equal(BOTTOM_THRESHOLD_PX, 300)
  const scroller = (scrollTop) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 })

  assert.equal(isAwayFromBottom(scroller(0)), true, '看得见顶部 → 离底部很远，按钮该出现')
  assert.equal(isAwayFromBottom(scroller(299)), true, '离底部 301px，还没进阈值')
  assert.equal(isAwayFromBottom(scroller(300)), false, '正好差 300px：够近，按钮不出现')
  assert.equal(isAwayFromBottom(scroller(600)), false, '已经在底部')
  assert.equal(isAwayFromBottom(null), false, '滚动宿主还没绑上时不显示按钮')
  assert.equal(isAwayFromBottom(undefined), false, '拿不到滚动宿主也不炸')

  const calls = []
  scrollViewToBottom({ scrollHeight: 1234, scrollTo: (options) => calls.push(options) })
  assert.deepEqual(calls, [{ top: 1234, behavior: 'smooth' }], '点击后直接滚到最底')
  assert.doesNotThrow(() => scrollViewToBottom(null), '没有滚动宿主时静默跳过')

  assert.match(FLOW_CSS, /\.dcf-scroll-bottom-btn\{[^}]*position:fixed[^}]*bottom:56px[^}]*right:28px/)
  assert.match(FLOW_CSS, /\.dcf-scroll-bottom-btn\{[^}]*border-radius:50%/, '圆形浮动按钮')
  assert.equal(ZH['flow.scrollToBottom'], '快速回到底部')
  assert.equal(EN['flow.scrollToBottom'], 'Scroll to bottom')
})

/* ─────────────────── 切回会话：位置锚在节点行上，内容没铺开就逐帧重试 ─────────────────── */

/** 一行带锚点 key 的节点行（只要 `visibleAnchorOf` 用到的两个接口）。 */
function anchorRowFor(key, top) {
  return {
    getAttribute: (name) => (name === 'data-chat-anchor-key' ? key : null),
    getBoundingClientRect: () => ({ top }),
  }
}

/** 本视图根节点：`querySelectorAll` 返回当前已渲染的节点行。 */
function anchorRootFor(rows) {
  return { querySelectorAll: (selector) => (selector === '[data-chat-anchor-key]' ? rows : []) }
}

/** 滚动宿主（只要 `visibleAnchorOf` / `isAwayFromBottom` 用到的那几个字段）。 */
function scrollHostFor(scrollTop, scrollHeight, clientHeight) {
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    getBoundingClientRect: () => ({ top: 0 }),
  }
}

test('切回会话：位置锚在视口顶部那一行节点上（不是死记像素）', () => {
  const { readScrollState } = client.__internals
  const root = anchorRootFor([anchorRowFor('n1', 120), anchorRowFor('n2', 400), anchorRowFor('n3', 900)])
  const scroller = scrollHostFor(500, 2000, 600)

  const state = readScrollState(root, scroller)
  assert.equal(state.key, 'n1', '锚在视口顶部往下第一行')
  assert.equal(state.offset, 120, '记住它离视口顶多远：窗口重新分页后像素会变，这一行的相对位置不会')
  assert.equal(state.top, 500, '像素位置也留着，锚点行找不到时兜底')
  assert.equal(state.atBottom, false)

  assert.deepEqual(
    readScrollState(anchorRootFor([]), scroller),
    { atBottom: false, top: 500, key: null, offset: 0 },
    '一行都没渲染出来时只剩像素',
  )
  assert.equal(readScrollState(null, scroller), null, '根节点不在时什么都不记')
  assert.equal(readScrollState(root, null), null, '滚动宿主还没绑上时什么都不记')
})

test('恢复位置：锚点行出现前一直重试，出现后立刻钉住', () => {
  const { applyScrollState, restoreScrollState, SCROLL_RESTORE_MAX_FRAMES } = client.__internals
  const scroller = scrollHostFor(0, 3000, 600)
  const state = { atBottom: false, top: 0, key: 'n1', offset: 30 }

  // 内容还没进树：锚点行找不到、又没有像素兜底 → 「没钉住」，让调用方下一帧再来。
  assert.equal(applyScrollState(anchorRootFor([]), scroller, state), false)
  // 行出现了：把「这一行离视口顶的偏移」还原回去（90 - 30 = 60）。
  assert.equal(applyScrollState(anchorRootFor([anchorRowFor('n1', 90)]), scroller, state), true)
  assert.equal(scroller.scrollTop, 60)

  // 锚点行不在了（窗口整批换掉）→ 退化成按像素还原，至少不比跳回顶部差。
  const fallback = scrollHostFor(0, 3000, 600)
  const stale = { atBottom: false, top: 640, key: 'gone', offset: 0 }
  assert.equal(applyScrollState(anchorRootFor([]), fallback, stale), true)
  assert.equal(fallback.scrollTop, 640)

  const originalRaf = globalThis.requestAnimationFrame
  const frames = []
  globalThis.requestAnimationFrame = (fn) => frames.push(fn)
  try {
    let rows = []
    const root = { querySelectorAll: () => rows }
    const host = scrollHostFor(0, 3000, 600)
    restoreScrollState(root, host, state)
    assert.equal(host.scrollTop, 0, '第一帧锚点行还没进树，位置先不动')
    assert.equal(frames.length, 1, '排了下一帧继续试')
    rows = [anchorRowFor('n1', 807)]
    frames.shift()()
    assert.equal(host.scrollTop, 777, '行一出现就按锚点算像素')
    assert.equal(frames.length, 0, '钉住之后不再排帧：不抢用户这期间的滚动')

    // 一直找不到锚点行 → 重试到上限就放弃，不能无限排帧。
    const stuck = { querySelectorAll: () => [] }
    restoreScrollState(stuck, host, { atBottom: false, top: 0, key: 'nope', offset: 0 })
    let scheduled = 0
    while (frames.length > 0 && scheduled < SCROLL_RESTORE_MAX_FRAMES + 5) {
      scheduled += 1
      frames.shift()()
    }
    assert.equal(frames.length, 0, '到上限就停')
    assert.equal(scheduled <= SCROLL_RESTORE_MAX_FRAMES, true, `重试不超过 ${SCROLL_RESTORE_MAX_FRAMES} 帧`)
  } finally {
    if (originalRaf === undefined) delete globalThis.requestAnimationFrame
    else globalThis.requestAnimationFrame = originalRaf
  }
})

test('「一进来就该在底部」与旧版位置记录：都还认得', () => {
  const { applyScrollState, bottomScrollState, decodeScrollState, encodeScrollState, isDocumentVisible } = client.__internals

  // 内容还没铺满一屏时「到底」是无意义的（被夹在 0）→ 不算钉住，下一帧再试。
  const short = scrollHostFor(0, 400, 600)
  assert.equal(applyScrollState(anchorRootFor([]), short, bottomScrollState()), false)
  const tall = scrollHostFor(0, 4000, 600)
  assert.equal(applyScrollState(anchorRootFor([]), tall, bottomScrollState()), true)
  assert.equal(tall.scrollTop, 4000)

  const state = { atBottom: true, top: 1234, key: 'n7', offset: 12 }
  assert.deepEqual(decodeScrollState(encodeScrollState(state)), state)
  // 旧版本存的就是一个数字（`String(scroller.scrollTop)`）：升级后不能把老记录读没了。
  assert.deepEqual(decodeScrollState('1234'), { atBottom: false, top: 1234, key: null, offset: 0 })
  assert.deepEqual(decodeScrollState('{"atBottom":true}'), { atBottom: true, top: 0, key: null, offset: 0 })
  assert.equal(decodeScrollState('{坏 JSON'), null)
  assert.equal(decodeScrollState(''), null)
  assert.equal(decodeScrollState(null), null)
  assert.equal(encodeScrollState(null), null)

  // 没有 `document`（node 侧渲染）时按「可见」处理，不能因为读不到状态就抛。
  assert.equal(isDocumentVisible(), true)
})

test('删除会话时清掉本插件留下的全部会话级数据（且不误伤前缀相同的会话）', () => {
  const { purgeSessionData, SESSION_KEY_PREFIXES } = client.__internals
  assert.deepEqual(SESSION_KEY_PREFIXES, [
    'dsh-chat-flow.collapse',
    'dsh-chat-flow.scroll',
    'dsh-chat-flow.ended-away',
  ])

  const local = createStorage()
  const session = createStorage()
  local.setItem('dsh-chat-flow.collapse.s1', '{"a":true}')
  local.setItem('dsh-chat-flow.collapse.s2', '{}')
  local.setItem('别的插件.key', 'x')
  session.setItem('dsh-chat-flow.scroll.s1', '120')
  session.setItem('dsh-chat-flow.ended-away.s1', '1')
  session.setItem('dsh-chat-flow.scroll.s2', '40')

  assert.equal(purgeSessionData('s1', { localStorage: local, sessionStorage: session }), 3, '删掉 3 个键')
  assert.deepEqual([...local.raw.keys()].sort(), ['dsh-chat-flow.collapse.s2', '别的插件.key'])
  assert.deepEqual([...session.raw.keys()], ['dsh-chat-flow.scroll.s2'])

  // 键名是**精确相等**匹配，不是前缀匹配：会话 id 之间有前缀关系（s / s1 / s2），
  // 按前缀删会把别人的数据一起删掉。
  assert.equal(purgeSessionData('s', { localStorage: local, sessionStorage: session }), 0, '不误伤 s2')
  assert.deepEqual([...local.raw.keys()].sort(), ['dsh-chat-flow.collapse.s2', '别的插件.key'])

  // 存储不可用时静默降级：不能因为隐私模式或配额满就把「删会话」这条链路带崩。
  const broken = {
    length: 1,
    key() {
      throw new Error('storage disabled')
    },
    removeItem() {
      throw new Error('storage disabled')
    },
  }
  assert.equal(purgeSessionData('s1', { localStorage: broken, sessionStorage: broken }), 0, '存储抛错时返回 0')
  assert.doesNotThrow(() => purgeSessionData('s1', { localStorage: null, sessionStorage: undefined }))
  assert.equal(purgeSessionData('', { localStorage: local }), 0, '空 sessionId 不动手')
  assert.equal(purgeSessionData(undefined, { localStorage: local }), 0, '没有 sessionId 不动手')
})

/**
 * 删除会话的清理必须挂在**插件级**，而不是只挂在任务视图里。
 *
 * 用户完全可能在原生「对话」视图里删掉一个会话（甚至这一页从没打开过任务视图），
 * 那时视图级的 effect 根本没跑，`localStorage` 折叠表与 `sessionStorage` 滚动记录
 * 就会一直留着。这里按「会话列表快照」这条唯一信号验：不挂任何视图，只 `apply(ctx)`。
 */
test('删除会话：会话列表一变就清残留（不依赖任务视图挂着）', async () => {
  const local = createStorage()
  const session = createStorage()
  const module1 = await loadBundle({ storage: local })
  module1.window.sessionStorage = session
  const { collapseEntry } = module1.exports.__internals
  const { ctx } = stubCtx()
  let alive = { ids: ['s1', 's19'], byId: {} }
  const listeners = new Set()
  ctx.sessions.list = {
    getSnapshot: () => alive,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  local.setItem('dsh-chat-flow.collapse.s1', '{"plate:seg:1:u1:0":false}')
  local.setItem('dsh-chat-flow.collapse.s19', '{"plate:seg:1:u1:0":false}')
  session.setItem('dsh-chat-flow.scroll.s1', '{"top":10}')
  session.setItem('dsh-chat-flow.ended-away.s1', '1')
  session.setItem('别的插件.key', 'x')

  module1.exports.apply(ctx)
  assert.equal(listeners.size, 1, 'apply 时就订阅会话列表，不需要挂任何视图')
  assert.deepEqual(
    [...local.raw.keys()].sort(),
    ['dsh-chat-flow.collapse.s1', 'dsh-chat-flow.collapse.s19'],
    '两个会话都还活着：一根汗毛都不动',
  )
  // 先把 s1 的折叠表读进进程内缓存，一会儿验它也被丢掉。
  const cached = collapseEntry('s1')

  alive = { ids: ['s19'], byId: {} }
  for (const listener of listeners) listener()
  assert.deepEqual([...local.raw.keys()], ['dsh-chat-flow.collapse.s19'], 's1 的折叠表随会话一起走')
  assert.deepEqual([...session.raw.keys()], ['别的插件.key'], 's1 的滚动记录与离开记号也要走，别的插件不碰')
  assert.notEqual(collapseEntry('s1'), cached, '进程内那张永不淘汰的折叠表也要丢')

  // 列表为空 = 重连重拉造成的短暂空表，不是「全都被删了」：一律不动手。
  alive = { ids: [], byId: {} }
  for (const listener of listeners) listener()
  assert.deepEqual([...local.raw.keys()], ['dsh-chat-flow.collapse.s19'], '空列表不清')

  // 快照读不出来时也不抛（宿主这一轮没给 ids）。
  alive = undefined
  assert.doesNotThrow(() => {
    for (const listener of listeners) listener()
  })
  // 宿主没装 sessions.list 时，清理 effect 只是退化成空实现。
  const bare = stubCtx()
  assert.doesNotThrow(() => module1.exports.apply(bare.ctx))
})

test('会话被删掉之后，它留下的键才被清掉（会话列表就是唯一信号）', () => {
  const { staleSessionIds, purgeSessionData } = client.__internals
  const local = createStorage()
  const session = createStorage()
  local.setItem('dsh-chat-flow.collapse.s1', '{}')
  local.setItem('dsh-chat-flow.collapse.s19', '{}')
  session.setItem('dsh-chat-flow.scroll.s1', '10')
  session.setItem('别的插件.key', 'x')
  const env = { localStorage: local, sessionStorage: session }

  // 两个会话都还活着：什么都不该清（s1 与 s19 有前缀关系，不能互相误伤）。
  assert.deepEqual(staleSessionIds(env, new Set(['s1', 's19'])), [])
  // s1 被删了（列表里只剩 s19）：只找出 s1，且只报一次（两个存储里都有它的键）。
  assert.deepEqual(staleSessionIds(env, new Set(['s19'])), ['s1'])
  for (const stale of staleSessionIds(env, new Set(['s19']))) purgeSessionData(stale, env)
  assert.deepEqual([...local.raw.keys()], ['dsh-chat-flow.collapse.s19'], 's19 的数据要留着')
  assert.deepEqual([...session.raw.keys()], ['别的插件.key'], '别的插件的键不碰')

  // 列表为空 = 重连重拉造成的短暂空表，不是「全都被删了」：一律不动手。
  assert.deepEqual(staleSessionIds(env, new Set()), [])
  assert.deepEqual(staleSessionIds(env, undefined), [])
  // 存储不可用时不抛错，只是这一轮清不了。
  assert.deepEqual(staleSessionIds({ localStorage: { length: 1, key: () => { throw new Error('x') } } }, new Set(['a'])), [])
})

/**
 * 「总结命令」（用户 m00831）：host 注册工具、client 认标记，两半在两个包里各持一份字面量，
 * 所以必须有一条接线测试把它们钉在一起——只改一边就会「模型调了工具但界面不认」。
 */
test('总结命令：host 与 client 两半的工具名必须一致', () => {
  const { SUMMARY_TOOL_NAME: clientName, isSummaryMarkTool, summaryMarkIndexOf } = client.__internals
  assert.equal(clientName, SUMMARY_TOOL_NAME, '客户端那份字面量必须与 host 的 protocol.js 一致')
  assert.equal(isSummaryMarkTool(SUMMARY_TOOL_NAME), true)
  assert.equal(isSummaryMarkTool('todo_write'), false, '别的工具名不能被当成标记')
  const mark = toolNode('m1', 1, 1, SUMMARY_TOOL_NAME, {}, { content: '已标记总结分界' })
  assert.equal(summaryMarkIndexOf([userNode('u1', 1, '干活'), mark]), 1)
})

test('总结命令：声明过分界时，总结整段在「任务过程」之外，且只有一份', () => {
  const { view, t } = bootView()
  const mark = toolNode('m1', 1, 3, SUMMARY_TOOL_NAME, {}, { content: '已标记总结分界：此后的输出视为本轮总结。' })
  const nodes = [
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
    pwshNode('t1', 1, 2, 'echo a', 'a'),
    mark,
    // 标记之后的总结可能不止一段文字：中间还可能插一次工具调用（例如落盘、验证）。
    // 「整段都在外面」是这条用例的关键——只把最后一个 inline run 拿出去会把它截成两半。
    assistantNode('a2', 1, 4, [{ kind: 'text', text: '先交代一句' }]),
    pwshNode('t2', 1, 5, 'echo b', 'b'),
    assistantNode('a3', 1, 6, [{ kind: 'text', text: '这是总结正文' }]),
    turnTailNode('tt1', 1, 7),
  ]
  const props = {
    sessionId: 'session-summary-mark',
    t,
    useChat: (selector) => selector(makeSnapshot(nodes)),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: false }),
  }
  const tree = view.component(props)
  const turn = findElement(tree, (element) => element.props?.className === 'dcf-turn')
  assert.ok(turn !== undefined, '应渲染出回合容器')

  const isSummaryLeaf = (element) =>
    String(element.props?.className ?? '').includes('dcf-leaf') &&
    /先交代一句|这是总结正文/.test(collectText(element))
  // 这一条是本功能的**全部意义**：总结正文不在「任务过程」折叠体里，而且不能里外各画一份。
  assert.deepEqual(foldDepthsOf(turn, isSummaryLeaf), [0, 0], '标记之后的每一段都在最外层，各渲染一次')
  assert.match(collectText(turn), /任务过程/, '过程那一半照旧是折叠体')

  // 标记调用自己是一次协议声明，不是一次操作：它的结果文本与卡片都不该出现。
  assert.equal(
    collectText(tree).includes('已标记总结分界'),
    false,
    '标记调用的结果不渲染（否则用户会在总结上方看到一张莫名其妙的卡）',
  )
})

test('总结命令：跑动中也要立刻把总结拿出来，不等回合结束', () => {
  const { view, t } = bootView()
  const mark = toolNode('m1', 1, 3, SUMMARY_TOOL_NAME, {})
  const props = {
    sessionId: 'session-summary-live',
    t,
    useChat: (selector) =>
      selector(
        makeSnapshot([
          userNode('u1', 1, '干活'),
          todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
          pwshNode('t1', 1, 2, 'echo a', 'a'),
          mark,
          assistantNode('a2', 1, 4, [{ kind: 'text', text: '这是总结正文' }]),
        ]),
      ),
    useSession: () => ({ hasMore: false, loadingOlder: false, running: true }),
  }
  const tree = view.component(props)
  const turn = findElement(tree, (element) => element.props?.className === 'dcf-turn')
  assert.ok(turn !== undefined)
  const isSummaryLeaf = (element) =>
    String(element.props?.className ?? '').includes('dcf-leaf') &&
    collectText(element).includes('这是总结正文')
  assert.deepEqual(
    foldDepthsOf(turn, isSummaryLeaf),
    [0],
    '模型刚声明分界、总结还在流式时就要显示在最外层（不然正文会消失几秒再出现）',
  )
  // 过程那一半照旧折着：分界只把**标记之后**的东西拿出去，不能顺手把过程也漏出来。
  const processFold = findElement(
    turn,
    (element) => element.props?.className === 'dcf-fold' && collectText(element).includes('echo a'),
  )
  assert.ok(processFold !== undefined, '过程内容仍应折在折叠体里（跑动中默认展开）')
  assert.equal(
    collectText(processFold).includes('这是总结正文'),
    false,
    '同一个折叠体里不能出现总结正文（里外各画一份是明令禁止的）',
  )
})