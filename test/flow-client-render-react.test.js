/**
 * 用**真实 React + react-dom/server** 渲染任务视图。
 *
 * 手写渲染器（`client-bundle.test.js`）能抓「组件是 undefined」，但抓不到真实 React 的语义错误：
 * 例如把一个 React 元素当数组展开、给 DOM 元素传了非法 prop、children 类型不合法——
 * 这类问题在真机上的表现是整块界面白屏，代价很高，所以在 node 里先用 SSR 挡一道。
 *
 * React 从 profile 的 `node_modules` 取（那里才有桌面壳实际用的版本），取不到就整组跳过，
 * 而不是假装通过。
 */

import { strict as assert } from 'node:assert'
import { createRequire, register } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { before, test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'

/**
 * 让 Node 能导入 primitives 的真实 ESM 产物：它内部 `import ... from './X.module.css'`，
 * 而 Node 不认识 `.css`（`Unknown file extension ".css"`）。这里注册一个模块钩子，
 * 把所有 `.css` 换成一个「取任何键都得类名」的假模块——样式对断言无意义，
 * 但**真实组件本体**（`TerminalBlock` / `MarkdownText` / `JsonBlock`）必须是真的。
 *
 * `register` 是进程级的，而 `node --test` 每个测试文件一个进程，因此不会污染别的文件。
 */
register(
  `data:text/javascript,${encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Proxy({}, { get: (_t, key) => "css-" + String(key) })',
    }
  }
  return nextLoad(url, context)
}
`)}`,
)
import {
  assistantNode,
  makeSnapshot,
  pwshNode,
  subagentCallNode,
  todoNode,
  toolNode,
  turnTailNode,
  userNode,
  writeNode,
} from './helpers/flow-fixtures.mjs'
import { SUMMARY_TOOL_NAME } from '../lib/flow/protocol.js'

/** profile 的 `node_modules`：桌面壳实际使用的依赖版本都在这里。 */
function profileNodeModules() {
  if (process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '') {
    return join(process.env.DSH_HOME, 'profiles', 'node_modules')
  }
  if (process.platform === 'win32' && process.env.APPDATA !== undefined) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles', 'node_modules')
  }
  return undefined
}

let renderToString
let ReactRef
let internals
let ready = false
/** 装载 `internals` 那份 bundle 时用的假存储：预置折叠状态要写进**同一份**。 */
let ssrStorage
/** 真实 primitives 的装载结果：只有它能验证「展开态真的能渲染」。 */
let realInternals
let realReady = false
/** 每次渲染换一个会话 id：折叠状态按会话持久化，共用一个 id 会让用例互相污染。 */
let ssrCounter = 0

before(async () => {
  const base = profileNodeModules()
  if (base === undefined) return
  try {
    const require = createRequire(`${base.replace(/[\\/]+$/, '')}/`)
    const React = require('react')
    ReactRef = React
    renderToString = require('react-dom/server').renderToString
    /** primitives 替身用真实 React 元素：既保留 children 语义，又不依赖主题与 CSS 模块。 */
    const primitives = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (typeof key === 'symbol') return undefined
          return function Primitive(props) {
            const given = props ?? {}
            return React.createElement(
              'div',
              { 'data-primitive': String(key) },
              given.children ?? (typeof given.text === 'string' ? given.text : null),
            )
          }
        },
      },
    )
    const loaded = await loadBundle({ react: React, primitives })
    internals = loaded.exports.__internals
    ssrStorage = loaded.storage
    ready = true

    /**
     * 第二遍装载：primitives 换成**真实模块**。
     *
     * 这一步专门验证展开态——`TerminalBlock` 之类的原子组件对入参有硬要求
     * （例如 `command` 必须是字符串，内部直接 `.endsWith`），替身挡不住这类错误，
     * 而真机上它会让整行工具明细渲染崩溃。真实模块同样从 profile 取，**单独 try** 以便
     * 只有这一条用例跳过，而不是把整组拖下水。
     */
    try {
      const primitivesUrl = pathToFileURL(
        join(base, '@deepseek-ai', 'dsh-client-ui-primitives', 'lib', 'index.js'),
      ).href
      const realPrimitives = await import(primitivesUrl)
      const realLoaded = await loadBundle({ react: React, primitives: realPrimitives })
      realInternals = realLoaded.exports.__internals
      realReady = true
    } catch {
      realReady = false
    }
  } catch {
    ready = false
  }
})

/**
 * 渲染主视图并拿到 HTML。
 *
 * `options.renderSlot` 传进来就模拟「核心装配齐全」：节点会走原生座位；
 * 不传（默认）就是本插件的**回退路径**——这也是插件在没有 ui-chat 的装配里的真实形态。
 *
 * @param snapshot - `useChat` 快照。
 * @param options - `sessionId`、`session`（`useSession` 的返回值）、`outline`、`renderSlot`、`useSessions`、
 *   `agentSeat`（子代理席位，见 `lib/client/58-subagent.js`）。
 */
function render(snapshot, options = {}) {
  const local = options.local ?? internals
  const t = (key, params) => {
    const template = local.ZH[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  return renderToString(
    local.views.TaskFlowView({
      sessionId: options.sessionId ?? `ssr-${ssrCounter += 1}`,
      t,
      useChat: (selector) => selector(snapshot),
      useSession: () => ({ hasMore: false, loadingOlder: false, running: false, ...(options.session ?? {}) }),
      useProjection: () => options.outline,
      loadOlder: () => {},
      renderSlot: options.renderSlot,
      useSessions: options.useSessions,
      openFile: options.openFile,
      openView: options.openView,
      agentSeat: options.agentSeat,
    }),
  )
}

/** React 在属性值里转义过的字符还原回来（折叠键里有 `:`，正常；这里只防 `&` 之类的意外）。 */
function unescapeAttribute(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * 点开所有思考块之后的那棵树（懒加载：思考块收起时正文**根本不在 DOM 里**）。
 *
 * 为什么要渲染两次：折叠键只有渲染出来才知道（思考块折叠头上的 `data-fold-key`），
 * 而折叠状态在某个会话**第一次**被读到时就缓存进内存（见 `30-collapse.js` 的 `collapseStore`），
 * 事后再写存储已经晚了。所以先用一个探针会话渲染一次取出键，把键写成「展开」存进存储，
 * 再用**新的会话 id** 正式渲染——键里不含会话 id，跨会话通用。
 *
 * @param renderOnce - `(sessionId) => html`：用给定会话 id 渲染一次。
 * @param storage - 装载这份 bundle 时用的假存储（折叠状态就写它）。
 */
function withThinkingOpen(renderOnce, storage = ssrStorage) {
  const probe = renderOnce(`ssr-probe-${(ssrCounter += 1)}`)
  const sessionId = `ssr-open-${(ssrCounter += 1)}`
  const state = {}
  for (const match of probe.matchAll(/data-fold-key="([^"]+)"/g)) state[unescapeAttribute(match[1])] = true
  storage.setItem(`dsh-chat-flow.collapse.${sessionId}`, JSON.stringify(state))
  return renderOnce(sessionId)
}

test('SSR：任务视图在真实 React 下渲染出任务过程 / 任务 / 状态', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom（先跑一次 install.mjs）')
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '把 A 和 B 都做掉'),
      assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划一下。' }]),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'node --test', '3 tests passed'),
    ]),
  )
  assert.match(html, /data-chat-flow-owner="dsh-chat-flow"/)
  assert.match(html, /dcf-root/)
  assert.match(html, /把 A 和 B 都做掉/)
  assert.match(html, /任务过程/)
  assert.match(html, /任务列表/)
  assert.match(html, /任务A/)
  assert.match(html, /进行中/)
  assert.match(html, /data-status="in_progress"/)
  // 「规划过程」作为独立折叠体已移除（用户要求「移除掉规划过程，全部算任务过程里面」）。
  assert.equal(/规划过程/.test(html), false, '界面上不该再出现「规划过程」')
})

test('SSR：任务状态与「正在处理」统计随节点数据变化', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'echo a', 'a'),
    writeNode('t2', 1, 3, 'a.js'),
    toolNode('t3', 1, 4, 'mcp__github__create_issue', { title: 'x' }, { content: 'ok' }),
    todoNode('p2', 1, 5, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'completed' },
    ]),
  ])
  const html = render(snapshot)
  assert.match(html, /data-status="completed"/)
  assert.match(html, /2 项 · 2 已完成/)
  // 第一个分段（任务A）的明细条数 = pwsh + write + mcp = 3。
  assert.match(html, /3 个操作/)
  // 任务已完成 → 行与「正在处理」都**默认自动折叠**。
  assert.match(html, /<div class="dcf-fold" data-open="false">/)
  // 思考块是**唯一**懒加载的折叠体：收起时明细根本不在 DOM 里（不是靠 CSS 藏起来）。
  assert.equal(html.includes('echo a'), false, '收起即不渲染：思考块正文不在 DOM 里')
  // 点开折叠头之后才有明细——这正是用户点开时看到的东西。
  assert.match(
    withThinkingOpen((sessionId) => render(snapshot, { sessionId })),
    /echo a/,
    '展开态那三条明细按需加载出来',
  )
})

test('SSR：任务列表默认展开；任务过程与思考块默认收起', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const running = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'echo a', 'a'),
  ])
  // 会话正在跑：任务行与任务列表展开；「任务过程」与思考块收起（用户要求）。
  const live = render(running, { sessionId: 'ssr-live-open', session: { running: true } })
  assert.match(live, /data-status="in_progress"/)
  assert.match(live, /aria-expanded="true"/, '进行中的任务行应展开')
  assert.match(live, /<div class="dcf-fold" data-open="true">/, '任务列表应默认展开')
  assert.match(live, /思考中/, '还在写的那一块显示「思考中」')
  assert.match(live, /dcf-thinking"[^>]*>[\s\S]{0,400}?aria-expanded="false"/, '思考块默认收起')

  // 回合结束（有收尾节点）但任务仍未完成：那一项「进行中」的子任务保持展开；
  // 「任务过程」本身仍然是收起的，折叠头上只写**中性**提示（清单陈旧 ≠ 被打断）。
  const settledButUnfinished = render(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      turnTailNode('tt1', 1, 3),
    ]),
    { sessionId: 'ssr-live-settled', session: { running: false } },
  )
  assert.match(settledButUnfinished, /data-status="in_progress"/)
  assert.match(settledButUnfinished, /aria-expanded="true"/)
  assert.match(
    settledButUnfinished,
    /data-tone="muted">清单未走完</,
    '清单没收尾只是中性提示（muted），不报警',
  )
  assert.equal(
    settledButUnfinished.includes('被打断'),
    false,
    '没有真实中断证据就写「被打断」＝用户报的误报（对话完成了却显示被打断）',
  )

  // 全部完成后：任务行与「正在处理」都自动收起。
  const done = render(
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
    { sessionId: 'ssr-live-done', session: { running: false } },
  )
  assert.match(done, /data-status="completed"/)
  // 全部完成的回合：任务行与思考块都不再展开（「完成后自动折叠」）。
  assert.equal((done.match(/class="dcf-taskrow" data-status="in_progress" aria-expanded="true"/g) ?? []).length, 0)
  assert.equal(
    (done.match(/class="dcf-row dcf-thinkinghead" aria-expanded="true"/g) ?? []).length,
    0,
    '已完成的回合里不应有展开的思考块',
  )
  // 任务列表：两块都默认收起——旧块**被后续列表接管**（用户要求「老的任务列表就应该自动折叠」），
  // 最新那一块**整表都已完成**（用户要求「当任务列表更新为『全部已完成』状态时，不需要展开」）。
  assert.equal(
    (done.match(/class="dcf-platehead" aria-expanded="true"/g) ?? []).length,
    0,
    '没有哪一块该默认展开',
  )
  assert.equal(
    (done.match(/class="dcf-platehead" aria-expanded="false"/g) ?? []).length,
    2,
    '旧块与「全部已完成」的那块都默认收起',
  )
  // 旧块里被接管的「进行中」显示成「已停止」，而不是继续转的进度圈。
  assert.match(done, /data-status="stopped"/)
  assert.match(done, /已停止/)
})

test('SSR：每个回合都带跳转锚点，多于一个回合时渲染右侧导轨', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const oneTurn = render(makeSnapshot([userNode('u1', 1, '第一件事')]))
  assert.match(oneTurn, /data-turn-anchor="1"/)
  // 只有一个回合时导轨没有意义，不渲染。
  assert.doesNotMatch(oneTurn, /dcf-rail/)

  const twoTurns = render(
    makeSnapshot([userNode('u1', 1, '第一件事'), pwshNode('t1', 1, 1, 'echo 1'), userNode('u2', 2, '第二件事')]),
  )
  assert.match(twoTurns, /data-turn-anchor="1"/)
  assert.match(twoTurns, /data-turn-anchor="2"/)
  assert.match(twoTurns, /class="dcf-rail"/)
  assert.equal((twoTurns.match(/class="dcf-mark"/g) ?? []).length, 2, '每个回合一个刻度')
  assert.match(twoTurns, /aria-label="跳到第 1 轮"/)
  assert.match(twoTurns, /aria-label="跳到第 2 轮"/)
})

test('SSR：内容按文本转义，不把模型输出当 HTML 注入', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '<img src=x onerror=alert(1)>'),
      assistantNode('a1', 1, 1, [{ kind: 'text', text: '<script>alert(1)</script>' }]),
    ]),
  )
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.doesNotMatch(html, /<img src=x onerror/)
  assert.match(html, /&lt;script&gt;/)
})

test('SSR：空会话给出空态而不是空白', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const html = render(makeSnapshot([]))
  assert.match(html, /dcf-empty/)
})

test('SSR：展开态用真实 primitives 渲染出工具明细（不崩、看到命令与结果）', async (t) => {
  if (!realReady) return t.skip('缺少 profile 里的 @deepseek-ai/dsh-client-ui-primitives')
  const loaded = await loadBundle({
    react: createRequire(`${profileNodeModules().replace(/[\\/]+$/, '')}/`)('react'),
    primitives: await import(
      pathToFileURL(join(profileNodeModules(), '@deepseek-ai', 'dsh-client-ui-primitives', 'lib', 'index.js')).href
    ),
  })
  const local = loaded.exports.__internals
  const snapshot = makeSnapshot([
    userNode('u1', 1, '跑测试'),
    todoNode('p1', 1, 1, [{ content: '跑测试', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'node --test', 'ok 30 - all green'),
  ])
  // 展开态才算「看得到明细」：思考块懒加载，收起时那三条命令明细根本不在树里。
  const html = withThinkingOpen(
    (sessionId) => render(snapshot, { sessionId, local }),
    loaded.storage,
  )
  assert.match(html, /data-terminal/, '命令明细应该由真实的 TerminalBlock 渲染')
  assert.match(html, /node --test/)
  assert.match(html, /all green/)
  // 回合已结束 → 这一块不再显示「思考中」，而是「思考已完成」（用户要求）。
  assert.match(html, /思考已完成/)
  assert.equal(html.includes('思考中<'), false, '结束的块不该再显示「思考中」')
})

test('SSR：turnOutline 里的未加载回合也画刻度，并标出「加载并跳转」', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  // 已加载第 3 轮，outline 里有第 1–3 轮：第 1、2 轮是未加载刻度。
  const html = render(makeSnapshot([userNode('u3', 3, '第三件事')]), {
    outline: [
      { turn: 1, seq: 10, prompt: '第一件事', response: '' },
      { turn: 2, seq: 20, prompt: '第二件事', response: '' },
      { turn: 3, seq: 30, prompt: '第三件事', response: '' },
    ],
  })
  assert.match(html, /class="dcf-rail"/)
  assert.equal((html.match(/data-loaded="false"/g) ?? []).length, 2, '两个未加载刻度')
  assert.equal((html.match(/data-loaded="true"/g) ?? []).length, 1, '一个已加载刻度')
  assert.match(html, /aria-label="加载并跳到第 1 轮"/)
  assert.match(html, /aria-label="跳到第 3 轮"/)
})

/* ──────────────────────────── 原生座位（真实 React） ──────────────────────────── */

test('SSR：原生座位在真实 React 下渲染，展开态与锚点属性都在', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const seen = []
  const snapshot = makeSnapshot([
    userNode('u1', 1, '跑测试'),
    todoNode('p1', 1, 1, [{ content: '跑测试', status: 'in_progress' }]),
    pwshNode('t1', 1, 2, 'node --test', 'ok'),
  ])
  const options = {
    session: { running: true },
    renderSlot: (slot, owner, seatOptions) => {
      seen.push({ slot, kind: owner.node.kind, entryKey: seatOptions.entryKey })
      // 替身座位：只证明「这一行交给了插槽」，并渲染出可断言的内容。
      return ReactRef.createElement(
        'div',
        { 'data-native-seat': seatOptions.entryKey },
        ReactRef.createElement('span', null, `native:${owner.node.kind}`),
      )
    },
  }
  // 工具行在懒加载的思考块正文里：收起态它不进树，自然也没有座位调用。
  const html = withThinkingOpen((sessionId) => render(snapshot, { ...options, sessionId }))

  assert.equal(seen.length > 0, true, '至少有一次座位调用')
  assert.equal(seen.every((call) => call.entryKey === call.kind), true, 'entryKey 必须等于节点 kind')
  assert.match(html, /data-native-seat="user"/)
  assert.match(html, /native:tool-call/)
  // 座位接手的行不再画本插件的卡片。
  assert.equal(html.includes('dcf-card'), false)
  // 核心同款的锚点属性仍在（别人的插件靠它们挂载，例如回退按钮）。
  assert.match(html, /data-chat-flow-kind="user"[^>]*data-chat-anchor-key="u1"/)
  assert.match(html, /data-chat-flow-kind="tool-call"[^>]*data-chat-anchor-key="t1"/)
  assert.match(html, /data-chat-turn="1"/)
})

/* ─────────────────────────── 「总结命令」划出的分界（真实 React） ─────────────────────────── */

test('SSR：任务结束时总结正文渲染在「任务过程」折叠体之外，标记调用自己不渲染', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const mark = toolNode('m1', 1, 3, SUMMARY_TOOL_NAME, {}, { content: '已标记总结分界：此后的输出视为本轮总结。' })
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      mark,
      assistantNode('a2', 1, 4, [{ kind: 'text', text: '这是总结正文' }]),
      turnTailNode('tt1', 1, 5),
    ]),
    { sessionId: 'ssr-summary-mark', session: { running: false } },
  )

  assert.match(html, /任务过程/, '过程那一半照旧是折叠体')
  // 「任务过程」是收起的，折叠体正文根本不在 DOM 里 —— 总结正文仍然出现，说明它在折叠体之外。
  assert.match(html, /这是总结正文/, '总结是给用户看的结论，必须在最外层')
  assert.equal(
    html.includes('已标记总结分界'),
    false,
    '标记调用的结果不渲染（它只是一次协议声明）',
  )
})

test('SSR：跑动中刚声明分界，总结正文就已经在外面（不等回合结束）', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const html = render(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
      toolNode('m1', 1, 2, SUMMARY_TOOL_NAME, {}),
      assistantNode('a2', 1, 3, [{ kind: 'text', text: '这是总结正文' }]),
    ]),
    { sessionId: 'ssr-summary-live', session: { running: true } },
  )
  assert.match(html, /这是总结正文/)
  // 跑动中「任务过程」是展开的（`stageOpen = live === true`）：这一条只保证总结**已经**在树里
  // 且只有一份（「在折叠体之外」由 client-bundle 的层深断言与上面那条收起态用例负责）。
  assert.equal(
    (html.match(/这是总结正文/g) ?? []).length,
    1,
    '总结正文只能渲染一份（里外各画一份是明令禁止的）',
  )
})

/* ─────────────────────────── 子代理过程（真实 React 的上下文传播） ─────────────────────────── */

const CHILD_ID = '11111111-2222-3333-4444-555555555555'

/**
 * 一个「立刻 ready」的子代理席位（SSR 不跑 effect，面板只会停在 idle，接线本身才是这一层要验的）。
 *
 * @param options - `byId`：会话列表快照里的会话摘要表（有子代理时下拉才会出现）。
 */
function ssrSeat(options = {}) {
  const calls = { watched: [], opened: [], refreshed: 0, subscribed: 0 }
  const list = { byId: options.byId ?? {} }
  return {
    calls,
    seat: {
      watch(childId, listener) {
        calls.watched.push(childId)
        listener({ phase: 'loading' })
        return () => {}
      },
      openSubagent(childId) {
        calls.opened.push(childId)
      },
      catalog() {
        return { list, catalog: options.catalog }
      },
      subscribeCatalog() {
        calls.subscribed += 1
        return () => {}
      },
      refreshCatalog() {
        calls.refreshed += 1
      },
    },
  }
}

test('SSR：子代理席位经上下文一路传到深处子代理卡（报告之后内联一块「子代理过程」）', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    subagentCallNode('c1', 1, 2, '去查一下', `started subagent ${CHILD_ID}`),
  ])
  const { seat } = ssrSeat()

  // 展开所有折叠体之后才看得到卡片本体（与其它折叠体一样是懒加载）。
  const html = withThinkingOpen((sessionId) => render(snapshot, { sessionId, agentSeat: seat }), ssrStorage)
  assert.match(html, /data-dcf-subagent="true"/, '席位在 → 过程面板挂上了')
  assert.match(html, /子代理过程/)
  assert.match(html, /data-phase="idle"/)
  assert.match(html, /data-dcf-subagent-open="true"/, '面板自带「打开子会话」入口')
  // 面板挂在报告之后（卡片本体里）。
  const body = html.indexOf('dcf-cardbody')
  const note = html.indexOf('已派出子会话，报告稍后到达')
  const panel = html.indexOf('data-dcf-subagent="true"')
  assert.ok(body >= 0 && note > body && panel > note, '顺序必须是：报告 → 过程面板')
})

test('SSR：没有席位时不画过程面板（宿主缺 ui-session 的装配里不该多一个空壳）', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    subagentCallNode('c1', 1, 2, '去查一下', `started subagent ${CHILD_ID}`),
  ])
  const html = withThinkingOpen((sessionId) => render(snapshot, { sessionId }), ssrStorage)
  assert.match(html, /已派出子会话，报告稍后到达/, '卡片本体照旧')
  assert.equal(html.includes('data-dcf-subagent'), false)
  assert.equal(html.includes('子代理过程'), false)
})

test('SSR：会话有子代理时，任务视图顶部出现「子代理」下拉（默认收起）', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const snapshot = makeSnapshot([userNode('u1', 1, '干活')])
  const { seat } = ssrSeat({
    byId: {
      [CHILD_ID]: { id: CHILD_ID, parentId: 's1', displayTitle: '查目录', running: true },
    },
  })
  const html = render(snapshot, { sessionId: 's1', agentSeat: seat })
  assert.match(html, /data-dcf-agentbar="true"/, '有子代理才长这行工具条')
  assert.match(html, /data-dcf-agenttrigger="true"/)
  assert.match(html, /data-running="true"/)
  assert.match(html, /1 个进行中/, '计数取自会话列表快照的 running')
  // 行内容（标题 / 状态图标）要靠点开菜单，SSR 点不了 —— 那是 `subagent-process.test.js` 的地盘。
  assert.equal(html.includes('data-dcf-agentmenu'), false, '默认收起：菜单不进 DOM')
  // 工具条在正文之前（它是这一页的顶部工具行）。
  assert.ok(html.indexOf('data-dcf-agentbar') < html.indexOf('dcf-main'), '工具条在正文之上')
})

test('SSR：没有子代理时工具条完全不出现（不留空行）', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const snapshot = makeSnapshot([userNode('u1', 1, '干活')])
  const { seat } = ssrSeat()
  const html = render(snapshot, { sessionId: 's1', agentSeat: seat })
  assert.equal(html.includes('data-dcf-agentbar'), false)
  const noSeat = render(snapshot, { sessionId: 's2' })
  assert.equal(noSeat.includes('data-dcf-agentbar'), false, '席位缺席也没有工具条')
})

/* ───────────────────── 「思考中」块里的推理行不交给原生座位（真实 React） ───────────────────── */

test('SSR：带推理的节点自己画，不交给原生座位（核心会把答案步的推理藏起来，展开就是空白）', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react / react-dom')
  const seated = []
  const snapshot = makeSnapshot([
    userNode('u1', 1, '干活'),
    todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
    assistantNode('a1', 1, 2, [{ kind: 'reasoning', text: '先把思路理清楚再动手' }]),
    pwshNode('t1', 1, 3, 'echo a', 'a'),
  ])
  const html = withThinkingOpen((sessionId) =>
    render(snapshot, {
      sessionId,
      renderSlot: (slot, owner, seatOptions) => {
        const blocks = owner.node?.data?.blocks ?? []
        seated.push({
          kind: owner.node.kind,
          reasoning: blocks.some((block) => block.kind === 'reasoning' && block.text !== ''),
        })
        return ReactRef.createElement('div', { 'data-native-seat': seatOptions.entryKey })
      },
    }),
  )
  assert.match(html, /先把思路理清楚再动手/, '推理内容必须自己画出来（真机上座位会把它渲染成空）')
  assert.equal(
    seated.every((call) => call.reasoning === false),
    true,
    '带推理的节点不能走原生座位：核心对答案步的推理会写 hidden="until-found"，用户点开就是空白',
  )
})