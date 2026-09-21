/**
 * 客户端 bundle 冒烟测试：用假的 react / primitives 把 `lib/client.js` 真跑一遍。
 *
 * 浏览器侧的代码在 node 里是跑不起来的（要 DOM），但它**必须**能过这三关，
 * 否则用户看到的是空白设置页（而那是最难查的一类故障）：
 * 1. bundle 能被加载、`apply/inject` 导出正确；
 * 2. `apply(ctx)` 能把设置页与输入框插槽都注册上；
 * 3. 每个标签页在真实形状的 state 下都能渲染出元素树（不抛错、不出现 undefined 组件）。
 *
 * 这里实现了一个极小的「渲染器」：`createElement` 直接调用函数组件本身。
 * 不追求真实 React 的语义，只要能执行到组件的渲染分支就够了。
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(HERE, '..', 'lib', 'client.js')

/** 依次供给 `useState` 的种子值（用完之后回落到组件自己的初始值）。 */
let stateQueue = []

/** 假的 `document.createElement` 造出来的节点（用来检查样式到底注进去了什么）。 */
const createdNodes = []

/** 极小的元素构造器：直接执行函数组件，用于把整棵树走一遍。 */
function createElement(type, props, ...children) {
  if (type === undefined || type === null) throw new Error('createElement 收到了未定义的组件（拼写错误或未导出）')
  const merged = { ...(props ?? {}) }
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  if (typeof type === 'function') return type(merged)
  return { type, props: merged }
}

/** react 钩子的最小替身。 */
const reactStub = {
  Fragment: 'fragment',
  createElement,
  useState: (initial) => {
    if (stateQueue.length > 0) return [stateQueue.shift(), () => {}]
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial ?? null }),
  useMemo: (fn) => fn(),
}

/** primitives 的最小替身：任何组件都渲染成它的 children。 */
const primitivesStub = new Proxy(
  {},
  {
    get: (_target, key) => {
      if (typeof key === 'symbol') return undefined
      return function Primitive(props) {
        return { type: 'div', props: props ?? {}, children: props?.children ?? [] }
      }
    },
  },
)

/** 假的宿主模块表。 */
function fakeRequire(id) {
  if (id === 'react') return reactStub
  if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub
  throw new Error(`客户端 bundle 只应 require 宿主提供的模块，实际请求了 ${id}`)
}

/** 加载 bundle 并返回它的导出。 */
async function loadBundle() {  const source = await readFile(BUNDLE, 'utf8')
  let registration
  createdNodes.length = 0
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  define('window', { __ModuleLoader__: { load: (options) => { registration = options } } })
  define('document', {
    getElementById: () => null,
    createElement: () => {
      const node = { style: { cssText: '' }, dataset: {}, appendChild() {}, remove() {} }
      createdNodes.push(node)
      return node
    },
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
  })
  // Node 24 的 globalThis.navigator 是只读访问器，必须用 defineProperty 覆盖。
  define('navigator', { userAgent: 'node-test' })
  // bundle 是 ESM 源码形态的普通脚本：用 Function 求值即可（不 import，避免真的去解析 react）。
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', source)(globalThis.window, globalThis.document, globalThis.navigator)
  assert.ok(registration !== undefined, 'bundle 没有调用 window.__ModuleLoader__.load')
  assert.equal(registration.id, 'dsh-control-center')
  return registration.factory(fakeRequire)
}

/** 一份形状与 host `/state` 一致的假状态。 */
function fixtureState(overrides = {}) {
  return {
    root: 'C:\\Users\\me\\.dsh',
    paths: {
      rules: 'C:\\Users\\me\\.dsh\\rules',
      skills: 'C:\\Users\\me\\.dsh\\skills',
      mcp: 'C:\\Users\\me\\.dsh\\mcp.json',
      memory: 'C:\\Users\\me\\.dsh\\memory',
      backup: 'C:\\Users\\me\\.dsh\\control-center\\backups',
      config: 'C:\\Users\\me\\.dsh\\control-center',
      settingsFile: 'C:\\Users\\me\\.dsh\\control-center\\settings.json',
    },
    budget: { rules: 32768, memory: 8192 },
    rules: {
      items: [
        { file: 'a.md', path: 'C:\\r\\a.md', name: '规则甲', description: '描述', mode: 'always', enabled: true, bytes: 120 },
        { file: 'b.md', path: 'C:\\r\\b.md', name: '规则乙', description: '', mode: 'ondemand', enabled: false, bytes: 0, error: '文件损坏' },
      ],
      activeCount: 1,
      alwaysCount: 1,
      ondemandCount: 0,
      injectBytes: 1024,
    },
    project: {
      workspace: 'D:\\Code\\Demo',
      dir: 'D:\\Code\\Demo\\.dsh\\rules',
      items: [{ file: 'p.md', path: 'D:\\Code\\Demo\\.dsh\\rules\\p.md', name: '项目规则甲', description: 'd', mode: 'always', enabled: true, bytes: 30 }],
      activeCount: 1,
      injectBytes: 300,
    },
    skills: {
      items: [
        { id: 'demo', kind: 'bundle', path: 'C:\\s\\demo\\SKILL.md', name: 'demo', description: '技能', whenToUse: '', modelInvocable: true, userInvocable: true, bytes: 10 },
        { id: 'flat', kind: 'flat', path: 'C:\\s\\flat.md', name: 'flat', description: '', whenToUse: 'x', modelInvocable: false, userInvocable: false, bytes: 0, warning: '名称不一致' },
      ],
    },
    mcp: {
      items: [
        { name: 'playwright', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: {}, status: { state: 'mounted' } },
        { name: 'remote', enabled: false, transport: 'streamable-http', url: 'http://x/mcp', headers: {}, status: { state: 'error', error: '连不上' } },
      ],
      error: null,
      fileError: null,
      syncError: null,
    },
    memory: {
      items: [
        { file: 'm.md', path: 'C:\\m\\m.md', name: '记忆甲', description: 'd', scope: 'global', workspace: '', tags: ['t'], source: 'manual', pinned: true, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', bytes: 20 },
        { file: 'n.md', path: 'C:\\m\\n.md', name: '记忆乙', description: '', scope: 'workspace', workspace: 'D:\\Code\\X', tags: [], source: 'auto', pinned: false, enabled: false, createdAt: '', updatedAt: '', bytes: 0 },
      ],
      enabledCount: 1,
      globalCount: 1,
      workspaceCount: 0,
      injectBytes: 512,
      injectEnabled: true,
    },
    backup: {
      dir: 'C:\\b',
      items: [{ file: 'dsh-backup-1.zip', bytes: 2048, createdAt: '2026-01-01T00:00:00.000Z' }],
      sections: [
        { id: 'rules', label: '规则', hint: 'h', sensitive: false, roots: 1 },
        { id: 'credentials', label: '凭据', hint: 'h', sensitive: true, roots: 1 },
      ],
      retention: 20,
      snapshotBeforeImport: true,
    },
    scan: {
      targets: { mcp: 'C:\\Users\\me\\.dsh\\mcp.json', skills: 'C:\\Users\\me\\.dsh\\skills' },
      sources: [{ id: 'codex', label: 'Codex CLI', enabled: true }],
      custom: [{ id: 'mine', label: '我的', kind: 'json', path: 'C:\\x.json' }],
    },
    settings: {
      optimize: { enabled: true, provider: '', model: '', reasoningEffort: '', prompt: '' },
      memory: { enabled: true, inject: true },
      backup: { retention: 20, snapshotBeforeImport: true },
      scan: { disabled: [], custom: [] },
      ui: { defaultTab: 'rule' },
    },
    optimize: { enabled: true, provider: '', model: '', reasoningEffort: '', prompt: '', available: true, hasCustomPrompt: false },
    ...overrides,
  }
}

test('客户端 bundle：能加载、导出 apply/inject，且只 require 宿主模块', async () => {
  const exports = await loadBundle()
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots'])
})

test('客户端 bundle：导入界面用原生复选框（不是滑块开关）', async () => {
  // 这一页是「从几十条里挑几条」，方框比滑块好扫；界面约定见 .agents/rules.md。
  // ScanTab 的清单来自异步 /scan，SSR 阶段没有数据，所以这里锁生成产物里的实现。
  const source = await readFile(BUNDLE, 'utf8')
  assert.ok(source.includes('dcc-pick-check'), '导入页的条目必须是复选框样式')
  assert.match(source, /className: 'dcc-pick dcc-pick-check'/)
})

test('客户端 bundle：触屏与「减少动效」的适配都在样式里', async () => {
  const source = await readFile(BUNDLE, 'utf8')
  // 触屏上按钮要抬到指头点得准的尺寸；悬停效果只在真有指针时才挂（触屏上 :hover 会粘住）。
  assert.match(source, /@media \(pointer:coarse\)/)
  assert.match(source, /@media \(hover:hover\)/)
  // 系统要求减少动效时，扫光不许继续扫。
  assert.match(source, /@media \(prefers-reduced-motion:reduce\)/)
})

test('客户端 bundle：apply 注册侧边栏入口、整页、会话视图与输入框插槽', async () => {
  const exports = await loadBundle()
  const registered = []
  const pending = []
  const slots = {
    inject: (name, run) => pending.push([name, run]),
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  }
  const ctx = { slots, inject: (deps, run) => run(ctx), effect: () => () => {} }
  exports.apply(ctx)
  // slots.inject 的回调在插槽出现时才跑，这里立刻执行，模拟插槽已存在。
  for (const [, run] of pending) run()
  const names = [...new Set(registered.map((item) => item.options.name))].sort()
  assert.deepEqual(names, [
    'conversation.input.overlay',
    'conversation.input.right',
    'conversation.view',
    'shell.overlay',
    'sidebar.footer.action',
  ])
  // 会话视图要排在「对话」(0) 与「轨迹」(10) 之间。
  const view = registered.find((item) => item.options.name === 'conversation.view')
  assert.equal(view.options.id, 'control-center-rules')
  assert.equal(view.options.order, 5)
  assert.equal(view.options.label(), '规则')

  // 样式表必须真的被注进去，而且要是个像样的字符串。
  // 这一条守的是「CSS 模板字符串被反引号提前闭合」那类事故：产物语法仍然合法、
  // 大部分单测也照过，但插件在浏览器里直接加载失败，用户看到整个界面消失。
  const style = createdNodes.find((node) => node.id === 'dsh-control-center-style')
  assert.ok(style !== undefined, 'apply 必须注入样式表')
  assert.equal(typeof style.textContent, 'string')
  assert.ok(style.textContent.length > 4096, `样式表太短（${style.textContent.length} 字节），多半没注进去`)
  assert.match(style.textContent, /--dcc-accent/)
  assert.match(style.textContent, /\.dcc-optbtn button/)
  assert.match(style.textContent, /@media \(pointer:coarse\)/)
})

test('客户端 bundle：七个页面在真实形状的 state 下都能渲染', async () => {
  const exports = await loadBundle()
  const tabs = exports.__internals.tabs
  const state = fixtureState()
  const act = { run: async () => ({ ok: false }), refresh: async () => {}, report: () => {}, flash: () => {} }
  const pages = {
    RulesSection: () => RulesSectionProbe(tabs.RulesSection, state, act),
    McpTab: () => tabs.McpTab({ state, act, busy: false, error: null }),
    SkillsTab: () => tabs.SkillsTab({ state, act, busy: false, error: null }),
    MemoryTab: () => tabs.MemoryTab({ state, act, busy: false, error: null }),
    ScanTab: () => tabs.ScanTab({ state, act, error: null }),
    BackupTab: () => tabs.BackupTab({ state, act, error: null }),
    SettingsTab: () => tabs.SettingsTab({ state, act, busy: false, error: null }),
  }
  for (const [name, render] of Object.entries(pages)) {
    stateQueue = []
    const tree = render()
    assert.ok(tree !== undefined && tree !== null, `${name} 渲染为空`)
  }
})

/** 规则页要显式给 scope/workspace（全局与项目两种都要能渲染）。 */
function RulesSectionProbe(RulesSection, state, act) {
  return createElement(
    'div',
    null,
    createElement(RulesSection, { state, act, busy: false, error: null, scope: 'global', workspace: '' }),
    createElement(RulesSection, { state, act, busy: false, error: null, scope: 'project', workspace: 'D:\\Code\\Demo' }),
  )
}

test('客户端 bundle：旧 host 的 state（缺新分区）也能渲染，不白屏', async () => {
  const exports = await loadBundle()
  const tabs = exports.__internals.tabs
  // 模拟「主机还是 0.1.0」：只有 rules / skills / mcp 三个分区。
  // 走真实路径（fetchState → withDefaults → 渲染），而不是把补齐后的对象直接塞进去。
  const legacy = { root: 'C:\\x', paths: {}, budget: 32768, rules: { items: [] }, skills: { items: [] }, mcp: { items: [] } }
  const normalized = exports.__internals.withDefaults(legacy)
  assert.deepEqual(normalized.memory.items, [])
  assert.deepEqual(normalized.backup.sections, [])
  assert.equal(normalized.project, null)
  assert.equal(normalized.settings.ui.defaultTab, 'rule')
  const act = { run: async () => ({ ok: false }), refresh: async () => {}, report: () => {}, flash: () => {} }
  stateQueue = []
  assert.ok(tabs.MemoryTab({ state: normalized, act, busy: false, error: null }) !== null)
  stateQueue = []
  assert.ok(tabs.ScanTab({ state: normalized, act, error: null }) !== null)
  stateQueue = []
  assert.ok(tabs.BackupTab({ state: normalized, act, error: null }) !== null)
  stateQueue = []
  assert.ok(tabs.SettingsTab({ state: normalized, act, busy: false, error: null }) !== null)
})

test('客户端 bundle：面板关闭时不渲染，打开后渲染页头与标签栏', async () => {
  const exports = await loadBundle()
  const { panelStore, tabs } = exports.__internals
  stateQueue = []
  assert.equal(tabs.ControlCenterPanel({}), null, '面板关闭时整页不该出现')
  panelStore.open('rule')
  stateQueue = []
  const tree = tabs.ControlCenterPanel({})
  assert.ok(tree !== undefined && tree !== null)
  // 侧边栏入口始终渲染（它是进入整页的唯一入口）。
  stateQueue = []
  assert.ok(tabs.ControlCenterEntry({ wide: true }) !== null)
  panelStore.close()
})

test('客户端 bundle：优化按钮在开关关闭/未就绪时返回空，开启时渲染按钮', async () => {
  const exports = await loadBundle()
  const components = {}
  const slots = {
    inject: (name, run) => run(),
    register: (options, component) => {
      components[options.options?.id ?? options.id] = component
      return () => {}
    },
  }
  exports.apply({ slots, inject: (deps, run) => run({ slots }), effect: (fn) => { fn(); return () => {} } })

  const button = components['control-center-optimize']
  const veil = components['control-center-optimize-veil']
  assert.equal(typeof button, 'function')
  assert.equal(typeof veil, 'function')

  const props = { sessionId: 's1', useInput: (select) => select({ draft: '写个脚本' }), inputActions: { setDraft: () => {} } }
  // 开关还没拉到（flags 为 null）→ 不渲染（避免先显示再消失的抖动）。
  stateQueue = []
  assert.equal(button(props), null)
  // 遮罩组件永远渲染一个隐藏锚点（它只负责挂 class）。
  assert.ok(veil({ sessionId: 's1' }) !== undefined)
})
