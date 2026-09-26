/**
 * 客户端 bundle 的「真实 React」渲染测试。
 *
 * `client-bundle.test.js` 用的是手写渲染器（直接调用函数组件），会放过不少真实 React
 * 会抛的错——例如把单个 React 元素当数组展开（`(actions ?? []).filter`）。本测试用
 * **真实的 react + react-dom/server** 把七个标签页各 renderToString 一遍，
 * 任何「Element type is invalid」「xxx is not a function」都在这里现形。
 *
 * 依赖 profile 里的 react / react-dom（装完 `install.mjs` 才有），拿不到时整组跳过。
 */

import { strict as assert } from 'node:assert'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(HERE, '..', 'lib', 'client.js')

let ready = false
let internals
let React
let renderToString

/** 定位 profile 的 node_modules（react / react-dom 都在里面）。 */
function profileNodeModules() {
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, 'profiles', 'node_modules')
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles', 'node_modules')
  }
  return undefined
}

/** 用真实 react + primitives 桩加载 bundle。 */
async function loadBundle(require) {
  const source = await readFile(BUNDLE, 'utf8')
  let registration
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  define('window', { __ModuleLoader__: { load: (options) => { registration = options } } })
  define('document', {
    getElementById: () => null,
    createElement: () => ({ style: { cssText: '' }, dataset: {}, appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
  })
  define('navigator', { userAgent: 'node-test' })

  const primitives = new Proxy({}, {
    get: (_target, key) => {
      if (typeof key === 'symbol') return undefined
      return function Primitive(props) {
        return React.createElement('div', { 'data-primitive': key }, props?.children)
      }
    },
  })
  const fakeRequire = (id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`客户端 bundle 只应 require 宿主提供的模块，实际请求了 ${id}`)
  }
  new Function('window', 'document', 'navigator', source)(globalThis.window, globalThis.document, globalThis.navigator)
  assert.ok(registration !== undefined)
  return registration.factory(fakeRequire)
}

before(async () => {
  const base = profileNodeModules()
  if (base === undefined) return
  try {
    const require = createRequire(`${base.replace(/[\\/]+$/, '')}/`)
    React = require('react')
    ;({ renderToString } = require('react-dom/server'))
    const exports = await loadBundle(require)
    internals = exports.__internals
    ready = true
  } catch {
    ready = false
  }
})

/** 形状与 host `/state` 一致的假状态。 */
function fixtureState() {
  return {
    root: 'C:\\Users\\me\\.dsh',
    paths: {
      rules: 'C:\\Users\\me\\.dsh\\rules', skills: 'C:\\Users\\me\\.dsh\\skills', mcp: 'C:\\Users\\me\\.dsh\\mcp.json',
      memory: 'C:\\Users\\me\\.dsh\\memory', backup: 'C:\\Users\\me\\.dsh\\control-center\\backups',
      config: 'C:\\Users\\me\\.dsh\\control-center', settingsFile: 'C:\\Users\\me\\.dsh\\control-center\\settings.json',
    },
    budget: { rules: 32768, memory: 8192 },
    rules: {
      items: [
        { file: 'a.md', path: 'C:\\r\\a.md', name: '规则甲', description: '描述', mode: 'always', enabled: true, bytes: 120 },
        { file: 'b.md', path: 'C:\\r\\b.md', name: '规则乙', description: '', mode: 'ondemand', enabled: false, bytes: 0, error: '文件损坏' },
      ],
      activeCount: 1, alwaysCount: 1, ondemandCount: 0, injectBytes: 1024,
    },
    project: {
      workspace: 'D:\\Code\\Demo',
      dir: 'D:\\Code\\Demo\\.dsh\\rules',
      items: [{ file: 'p.md', path: 'D:\\Code\\Demo\\.dsh\\rules\\p.md', name: '项目规则甲', description: 'd', mode: 'always', enabled: true, bytes: 30 }],
      activeCount: 1, injectBytes: 300,
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
      error: null, fileError: null, syncError: null,
    },
    memory: {
      items: [
        { file: 'm.md', path: 'C:\\m\\m.md', name: '记忆甲', description: 'd', scope: 'global', workspace: '', tags: ['t'], source: 'manual', pinned: true, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', bytes: 20 },
        { file: 'n.md', path: 'C:\\m\\n.md', name: '记忆乙', description: '', scope: 'workspace', workspace: 'D:\\Code\\X', tags: [], source: 'auto', pinned: false, enabled: false, createdAt: '', updatedAt: '', bytes: 0 },
      ],
      enabledCount: 1, globalCount: 1, workspaceCount: 0, injectBytes: 512, injectEnabled: true,
    },
    backup: {
      dir: 'C:\\b', items: [{ file: 'dsh-backup-1.zip', bytes: 2048, createdAt: '2026-01-01T00:00:00.000Z' }],
      sections: [
        { id: 'rules', label: '规则', hint: 'h', sensitive: false, roots: 1 },
        { id: 'credentials', label: '凭据', hint: 'h', sensitive: true, roots: 1 },
      ],
      retention: 20, snapshotBeforeImport: true,
    },
    scan: {
      targets: { mcp: 'C:\\mcp.json', skills: 'C:\\skills' },
      sources: [{ id: 'codex', label: 'Codex CLI', enabled: true }],
      custom: [{ id: 'mine', label: '我的', kind: 'json', path: 'C:\\x.json' }],
    },
    settings: {
      optimize: { enabled: true, provider: '', model: '', reasoningEffort: '', prompt: '' },
      memory: { enabled: true, inject: true },
      rules: { approval: 'ask', allowedWorkspaces: [] },
      backup: { retention: 20, snapshotBeforeImport: true },
      scan: { disabled: [], custom: [] },
      ui: { defaultTab: 'rule' },
    },
    optimize: { enabled: true, provider: '', model: '', reasoningEffort: '', prompt: '', available: true, hasCustomPrompt: false },
  }
}

const act = { run: async () => ({ ok: false }), refresh: async () => {}, report: () => {}, flash: () => {} }

test('真实 React：所有页面在完整 state 下都能 renderToString', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom（先跑一次 install.mjs）')
  const state = fixtureState()
  const tabs = internals.tabs
  // 规则页按作用域参数化：控制中心是 global，会话「规则」视图是 project。
  const targets = [
    { scope: 'global', workspace: '' },
    { scope: 'project', workspace: 'D:\\Code\\Demo' },
  ]
  for (const target of targets) {
    const html = renderToString(React.createElement(tabs.RulesSection, { state, act, busy: false, error: null, ...target }))
    assert.ok(html.length > 0, `RulesSection(${target.scope}) 渲染为空`)
  }
  // 控制中心只呈现全局规则：不该再出现作用域切换与项目路径条。
  const globalHtml = renderToString(React.createElement(tabs.RulesSection, { state, act, busy: false, error: null, scope: 'global', workspace: '' }))
  assert.doesNotMatch(globalHtml, /项目规则/)
  assert.doesNotMatch(globalHtml, /选择文件夹/)
  const projectHtml = renderToString(React.createElement(tabs.RulesSection, { state, act, busy: false, error: null, scope: 'project', workspace: 'D:\\Code\\Demo' }))
  assert.match(projectHtml, /项目：D:\\Code\\Demo/)
  for (const name of ['McpTab', 'SkillsTab', 'MemoryTab', 'ScanTab', 'BackupTab', 'SettingsTab']) {
    const html = renderToString(React.createElement(tabs[name], { state, act, busy: false, error: null }))
    assert.ok(html.length > 0, `${name} 渲染为空`)
  }
})

test('真实 React：规则页的审批下拉只有三档，两个入口都在', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom（先跑一次 install.mjs）')
  const state = fixtureState()
  // 控制中心的「规则」页与会话里的项目规则视图共用 RulesSection，所以两处都该有这一项。
  for (const target of [{ scope: 'global', workspace: '' }, { scope: 'project', workspace: 'D:\\Code\\Demo' }]) {
    const html = renderToString(React.createElement(internals.tabs.RulesSection, { state, act, busy: false, error: null, ...target }))
    assert.match(html, /AI 改规则时的审批/, '两处入口都要有这一项')
    for (const label of ['每次询问', '始终允许', '禁止且不再询问']) {
      assert.match(html, new RegExp(`>${label}<`), `缺档位：${label}`)
    }
    assert.doesNotMatch(html, /<option value="deny-once"/, '「禁止一次」不再是下拉档位，它只是弹框上的按钮')
    assert.match(html, /<option value="ask" selected="">/, '默认选中「每次询问」')
    assert.match(html, /弹框问你/, '选中那一档要带解释')
  }

  const denied = fixtureState()
  denied.settings.rules.approval = 'deny-always'
  const html = renderToString(React.createElement(internals.tabs.RulesSection, { state: denied, act, busy: false, error: null, scope: 'project', workspace: 'D:\\Code\\Demo' }))
  assert.match(html, /<option value="deny-always" selected="">/, '当前档位要回显')
  assert.doesNotMatch(html, /<option value="ask" selected="">/)
  assert.match(html, /一律拒绝 AI 改规则/, '解释跟着档位走')
})

test('真实 React：豁免过的工作区在规则页列出来，并且能一键清除', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom（先跑一次 install.mjs）')
  const plain = renderToString(React.createElement(internals.tabs.RulesSection, { state: fixtureState(), act, busy: false, error: null, scope: 'global', workspace: '' }))
  assert.doesNotMatch(plain, /已豁免的工作区/, '没有豁免时不显示这一行')

  const exempt = fixtureState()
  exempt.settings.rules.allowedWorkspaces = ['D:\\Code\\Demo', 'D:\\Code\\Other']
  const html = renderToString(React.createElement(internals.tabs.RulesSection, { state: exempt, act, busy: false, error: null, scope: 'global', workspace: '' }))
  assert.match(html, /已豁免的工作区/)
  assert.match(html, /D:\\Code\\Demo/)
  assert.match(html, />清除</)
})

test('真实 React：所有「勾选」都渲染成滑块开关（role=switch），不再是原生方框', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom')
  const state = fixtureState()
  const html = renderToString(React.createElement(internals.tabs.BackupTab, { state, act, busy: false, error: null }))
  // 备份分区是 PickCard：整块可点，右侧一个滑块。
  assert.match(html, /class="dcc-pick"/)
  assert.match(html, /class="dcc-pickswitch"/)
  assert.match(html, /role="switch"/)
  // 有 checkbox 就必然带 role="switch"——不允许出现裸的原生方框。
  const boxes = html.match(/type="checkbox"/g) ?? []
  const switches = html.match(/role="switch"/g) ?? []
  assert.equal(boxes.length, switches.length, '每个 checkbox 都必须是滑块开关')
  assert.ok(switches.length > 0, '备份分区至少要有一个开关')
})

test('真实 React：控制中心整页与侧边栏入口都能渲染', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom')
  const { panelStore } = internals
  // 关着的时候整页返回 null。
  assert.equal(renderToString(React.createElement(internals.tabs.ControlCenterPanel, {})), '')
  panelStore.open('rule')
  try {
    // 打开后：页头 + 标签栏 + 「正在读取…」（effect 在 SSR 下不跑，所以是加载态）。
    const html = renderToString(React.createElement(internals.tabs.ControlCenterPanel, {}))
    assert.match(html, /控制中心/)
    assert.match(html, /MCP 服务器/)
    assert.ok(html.includes('dcc-panel-head'))
  } finally {
    panelStore.close()
  }
  const entry = renderToString(React.createElement(internals.tabs.ControlCenterEntry, { wide: true }))
  assert.match(entry, /控制中心/)
})

test('真实 React：输入框优化按钮在开关关闭时返回 null，遮罩始终有锚点', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom')
  const props = { sessionId: 's1', useInput: (select) => select({ draft: '写个脚本' }), inputActions: { setDraft: () => {} } }
  // 开关没拉到（useFlags 初始 null）→ 不渲染按钮。
  assert.equal(renderToString(React.createElement(internals.composer.OptimizeButton, props)), '')
  const veil = renderToString(React.createElement(internals.composer.ComposerVeil, { sessionId: 's1' }))
  assert.ok(veil.length > 0, '遮罩组件应渲染出隐藏锚点')
})

test('真实 React：优化失败的原因在手机上也读得到（是可点的按钮，不是只有 title 的徽标）', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom')
  const { OptimizeButton, optimizeStore, flagsStore } = internals.composer
  const props = { sessionId: 's-mobile', useInput: (select) => select({ draft: '写个脚本' }), inputActions: { setDraft: () => {} } }
  flagsStore.set({ optimize: { enabled: true, available: true } })
  optimizeStore.set('s-mobile', { kind: 'error', message: '模型返回了空结果' })
  try {
    const html = renderToString(React.createElement(OptimizeButton, props))
    // 「优化失败」必须落在 <button> 上：触屏没有 hover，title 型提示等于不存在。
    assert.match(html, /<button[^>]*data-tone="danger"[^>]*>/, '失败提示得是可点的按钮')
    assert.match(html, /优化失败/)
    // 失败态**占用「优化」的位置**（省宽度，窄屏上才不至于把发送按钮顶出卡片），
    // 所以这时不该同时出现两颗按钮；点开浮层之前也不渲染浮层。
    assert.doesNotMatch(html, />优化</, '失败态下不该还留一颗「优化」按钮')
    assert.equal(html.includes('dcc-toast'), false)

    // 正常态：优化按钮在（失败胶囊不在），完成后旁边多一颗撤销。
    optimizeStore.set('s-mobile', { kind: 'idle' })
    const idle = renderToString(React.createElement(OptimizeButton, props))
    assert.match(idle, />优化</)
    assert.equal(idle.includes('data-tone="danger"'), false)
    optimizeStore.set('s-mobile', { kind: 'done', original: '写个脚本', optimized: '改写后的草稿', route: 'deepseek-official/deepseek-v4' })
    const done = renderToString(React.createElement(OptimizeButton, props))
    assert.match(done, />优化</)
    assert.match(done, /撤销/)
  } finally {
    optimizeStore.set('s-mobile', { kind: 'idle' })
    flagsStore.set(null)
  }
})

test('真实 React：发送后输入框被清空，「撤销」当帧就不该再显示', async (t) => {
  if (!ready) return t.skip('缺少 profile 里的 react/react-dom')
  const { OptimizeButton, optimizeStore, flagsStore, canUndoOptimize } = internals.composer
  const done = { kind: 'done', original: '写个脚本', optimized: '改写后的草稿', route: 'deepseek-official/deepseek-v4' }
  // 纯函数层：草稿被清空（或只剩空白）就没有可撤的对象；没优化过就更不用说。
  assert.equal(canUndoOptimize(done, ''), false, '空草稿不该还给撤销')
  assert.equal(canUndoOptimize(done, '   '), false, '只有空白也算空')
  assert.equal(canUndoOptimize(done, '改写后的草稿'), true)
  assert.equal(canUndoOptimize({ kind: 'idle' }, '改写后的草稿'), false)

  flagsStore.set({ optimize: { enabled: true, available: true } })
  optimizeStore.set('s-sent', done)
  const props = { sessionId: 's-sent', inputActions: { setDraft: () => {} } }
  try {
    const kept = { ...props, useInput: (select) => select({ draft: '改写后的草稿' }) }
    assert.match(renderToString(React.createElement(OptimizeButton, kept)), /撤销/)
    // 宿主在一次成功发送里会清空编辑器（`send-committed` → 效果 `commit-draft`）。
    // 这一刻「撤销」必须消失：留着它就会挂到用户接着写的那一段输入上。
    const sent = { ...props, useInput: (select) => select({ draft: '' }) }
    const html = renderToString(React.createElement(OptimizeButton, sent))
    assert.equal(html.includes('撤销'), false, '发送后不该还留着撤销按钮')
    assert.match(html, />优化</, '撤销收掉之后，「优化」要照样可用')
  } finally {
    optimizeStore.set('s-sent', { kind: 'idle' })
    flagsStore.set(null)
  }
})
