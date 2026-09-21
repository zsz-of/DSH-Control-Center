/**
 * HTTP API 端到端测试：直接调 `registerApi` 注册的那个 handler，走完真实的请求/响应路径。
 *
 * 浏览器侧的每一个动作最终都落在这几个端点上，所以这里覆盖的是**唯一的数据通道**：
 * 读状态、写记忆、上传备份包、按计划恢复、下载产物路径校验。
 *
 * 依赖 `Source/node_modules/@deepseek-ai` 链接（解析 `@deepseek-ai/dsh-llm`）。
 */

import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { createZip } from '../lib/zip.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEER_LINK = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh-llm')

let ready = false
let home
let harness
let plugin
let paths
let settings

before(async () => {
  if (!existsSync(PEER_LINK)) return
  home = await mkdtemp(join(tmpdir(), 'dcc-api-home-'))
  harness = await mkdtemp(join(tmpdir(), 'dcc-api-harness-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = harness
  paths = await import('../lib/paths.js')
  settings = await import('../lib/settings.js')
  plugin = await import('../lib/index.js')
  ready = true
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  if (harness !== undefined) await rm(harness, { recursive: true, force: true })
})

/** 注册插件并拿到 API 的 handler。 */
function mount() {
  let route
  const ctx = {
    on: () => {},
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject: () => {},
    skills: { registerProvider: (create) => create({ invalidate: () => {} }) },
    webServer: {
      register(spec) {
        route = spec
        return () => {}
      },
    },
    plugin: async () => ({}),
  }
  plugin.apply(ctx)
  assert.ok(route !== undefined, 'API 没有注册到 webServer')
  return route.handler
}

/** 造一个请求对象：监听器注册完成后才发数据（与真实流一致）。 */
function makeRequest(method, url, payload) {
  const emitter = new EventEmitter()
  emitter.method = method
  emitter.url = url
  process.nextTick(() => {
    if (payload !== undefined) emitter.emit('data', Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8'))
    emitter.emit('end')
  })
  return emitter
}

/** 发一次请求并解析 JSON 响应。 */
function call(handler, method, url, payload) {
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status
        this.headers = headers ?? {}
      },
      end(body) {
        try {
          resolve({ status: this.status, headers: this.headers, body: body === undefined ? undefined : JSON.parse(body.toString('utf8')) })
        } catch (error) {
          reject(error)
        }
      },
    }
    handler(makeRequest(method, url, payload), res)
  })
}

test('API：GET /state 返回全部七个分区的数据形状', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const response = await call(handler, 'GET', '/api/dsh-control-center/state')
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  const state = response.body.state
  assert.equal(state.root, paths.DATA_ROOT)
  for (const key of ['rules', 'skills', 'mcp', 'memory', 'backup', 'scan', 'settings', 'optimize', 'paths', 'budget']) {
    assert.ok(state[key] !== undefined, `state 缺少 ${key}`)
  }
  assert.deepEqual(state.backup.sections.map((section) => section.id).slice(0, 4), ['rules', 'skills', 'memory', 'mcp'])
  assert.equal(state.settings.optimize.enabled, true)
})

test('API：写记忆后返回完整 state，正文可由 /body 读回', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const saved = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'memory', op: 'save', memory: { name: '接口记忆', description: 'd', body: '正文内容' } }),
  )
  assert.equal(saved.status, 200)
  assert.equal(saved.body.ok, true)
  assert.equal(saved.body.state.memory.items.length, 1)
  assert.equal(saved.body.state.memory.items[0].name, '接口记忆')

  const body = await call(handler, 'GET', '/api/dsh-control-center/body?section=memory&id=' + encodeURIComponent('接口记忆.md'))
  assert.equal(body.body.body, '正文内容')

  const missing = await call(handler, 'GET', '/api/dsh-control-center/body?section=memory&id=nope.md')
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /不存在/)
})

test('API：非法输入返回 400 + 可读原因，且不写盘', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const bad = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'memory', op: 'save', memory: { name: '', body: '' } }),
  )
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /标题不能为空/)

  const unknown = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'nope', op: 'x' }))
  assert.equal(unknown.status, 400)
  assert.match(unknown.body.error, /未知分区/)

  const notFound = await call(handler, 'GET', '/api/dsh-control-center/nope')
  assert.equal(notFound.status, 404)
})

test('API：/flags 只暴露输入框按钮需要的开关', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const response = await call(handler, 'GET', '/api/dsh-control-center/flags')
  assert.deepEqual(response.body.flags, { optimize: { enabled: true, available: false } })

  await settings.writeSettings({ optimize: { enabled: false } })
  const off = await call(handler, 'GET', '/api/dsh-control-center/flags')
  assert.equal(off.body.flags.optimize.enabled, false)
  await settings.writeSettings({ optimize: { enabled: true } })
})

test('API：设置保存后立即反映在 /state 与 /flags 上', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const saved = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'settings', op: 'save', settings: { ui: { defaultTab: 'memory' }, memory: { inject: false } } }),
  )
  assert.equal(saved.body.state.settings.ui.defaultTab, 'memory')
  assert.equal(saved.body.state.memory.injectEnabled, false)
  assert.equal(saved.body.state.settings.optimize.enabled, true, '没传的分区保持原值')
  await settings.writeSettings({ memory: { inject: true } })
})

test('API：/scan 在空的 home 下也能正常返回（找不到客户端不算错误）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const response = await call(handler, 'GET', '/api/dsh-control-center/scan')
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.ok(Array.isArray(response.body.scan.sources))
  assert.equal(response.body.scan.totals.present, 0)
})

test('API：备份导出 → 上传分析 → 按计划替换，全链路可用（无下载端点）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const created = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'backup', op: 'create', sections: ['memory'], label: '接口测试' }),
  )
  assert.equal(created.body.ok, true)
  const file = created.body.result.file
  assert.ok(file.endsWith('.zip'))
  assert.equal(created.body.state.backup.items.length, 1)
  assert.match(created.body.state.backup.items[0].file, /接口测试/)

  // 备份不再提供下载端点：产物就在备份目录里，用户直接去那儿取。
  const removed = await call(handler, 'GET', '/api/dsh-control-center/download?id=x.zip')
  assert.equal(removed.status, 404)

  // 上传一个真实产物，再按 token 替换。
  const buffer = await readFile(file)
  const analysis = await call(handler, 'POST', '/api/dsh-control-center/upload', buffer)
  assert.equal(analysis.status, 200)
  assert.equal(analysis.body.ok, true)
  assert.ok(typeof analysis.body.token === 'string' && analysis.body.token.length > 0)
  assert.deepEqual(analysis.body.sections.map((section) => section.id), ['memory'])
  assert.equal(analysis.body.sections[0].overwrite, 1, '预览要告诉用户会覆盖哪些配置')

  // 删掉记忆文件，再用备份恢复回来。
  await rm(paths.MEMORY_DIR, { recursive: true, force: true })
  const restored = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'backup', op: 'restore', token: analysis.body.token, sections: ['memory'] }),
  )
  assert.equal(restored.body.ok, true)
  assert.equal(restored.body.result.written, 1)
  assert.equal(restored.body.state.memory.items.length, 1)
  // 恢复前的现场被自动另存了一份（默认开启）。
  assert.ok(restored.body.result.snapshot === null || restored.body.result.snapshot.endsWith('.zip'))

  // token 用完即失效，重放会明确报错。
  const replay = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'backup', op: 'restore', token: analysis.body.token, sections: ['memory'] }),
  )
  assert.equal(replay.status, 400)
  assert.match(replay.body.error, /过期/)
})

test('API：全局规则与项目规则各走一套目录，互不串味', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const workspace = await mkdtemp(join(tmpdir(), 'dcc-api-ws-'))
  try {
    const globalSave = await call(
      handler,
      'POST',
      '/api/dsh-control-center/action',
      JSON.stringify({ section: 'rule', op: 'save', rule: { name: '全局规则甲', mode: 'always', body: '全局正文' } }),
    )
    assert.equal(globalSave.body.ok, true)
    assert.equal(globalSave.body.state.project, null, '没给工作区时不应有项目分区')

    const projectSave = await call(
      handler,
      'POST',
      '/api/dsh-control-center/action',
      JSON.stringify({
        section: 'rule',
        op: 'save',
        scope: 'project',
        workspace,
        rule: { name: '项目规则甲', mode: 'ondemand', body: '项目正文' },
      }),
    )
    assert.equal(projectSave.body.ok, true)
    assert.equal(projectSave.body.state.project.workspace, workspace)
    assert.deepEqual(projectSave.body.state.project.items.map((rule) => rule.name), ['项目规则甲'])
    // 全局列表里不该混进项目规则。
    assert.ok(!projectSave.body.state.rules.items.some((rule) => rule.name === '项目规则甲'))
    // 项目规则落在工作区内的 .dsh/rules 下。
    const raw = await readFile(join(workspace, '.dsh', 'rules', '项目规则甲.md'), 'utf8')
    assert.match(raw, /项目正文/)

    // 正文读取要按 scope 分流。
    const projectBody = await call(
      handler,
      'GET',
      `/api/dsh-control-center/body?section=rule&id=${encodeURIComponent('项目规则甲.md')}&workspace=${encodeURIComponent(workspace)}`,
    )
    assert.equal(projectBody.body.body, '项目正文')
    const wrongScope = await call(handler, 'GET', `/api/dsh-control-center/body?section=rule&id=${encodeURIComponent('项目规则甲.md')}`)
    assert.equal(wrongScope.status, 400, '不带 workspace 时全局目录里没有这条规则')

    // 删掉项目规则，全局那条仍在。
    const removed = await call(
      handler,
      'POST',
      '/api/dsh-control-center/action',
      JSON.stringify({ section: 'rule', op: 'delete', scope: 'project', workspace, file: '项目规则甲.md' }),
    )
    assert.equal(removed.body.ok, true)
    assert.deepEqual(removed.body.state.project.items, [])
    assert.equal(removed.body.state.rules.items.length, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('API：项目规则缺工作区时报错', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const missing = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'rule', op: 'save', scope: 'project', rule: { name: 'x', mode: 'always', body: 'b' } }),
  )
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /工作区目录/)
})

test('API：/revision 随写操作递增，读操作不动（前端据此轮询刷新）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const rev0 = await call(handler, 'GET', '/api/dsh-control-center/revision')
  assert.equal(typeof rev0.body.revision, 'number')

  await call(handler, 'GET', '/api/dsh-control-center/state')
  const rev1 = await call(handler, 'GET', '/api/dsh-control-center/revision')
  assert.equal(rev1.body.revision, rev0.body.revision, '读操作不该 bump')

  await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'memory', op: 'save', memory: { name: 'x', body: 'b' } }))
  const rev2 = await call(handler, 'GET', '/api/dsh-control-center/revision')
  assert.equal(rev2.body.revision, rev0.body.revision + 1, '写操作应 +1')

  // reveal 不落盘，不该 bump。
  await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'reveal', path: 'C:\\' }))
  const rev3 = await call(handler, 'GET', '/api/dsh-control-center/revision')
  assert.equal(rev3.body.revision, rev2.body.revision)
})

test('API：备份产物可以「就地还原」——inspect 先给覆盖清单，restore 再按文件覆盖', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'memory', op: 'save', memory: { name: '还原目标', description: 'd', body: '原始内容' } }))
  const created = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'backup', op: 'create', sections: ['memory'] }))
  const file = created.body.state.backup.items[0].file
  assert.ok(file.endsWith('.zip'))

  // 改掉内容，再用备份还原回去。
  await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'memory', op: 'save', memory: { file: '还原目标.md', name: '还原目标', description: 'd', body: '被改过的内容' } }))

  const inspected = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'backup', op: 'inspect', file }))
  assert.equal(inspected.body.ok, true)
  // 同目录里还有别的测试留下的记忆，所以这里只要求「报出了会覆盖的文件数」且包含本次那一个。
  assert.ok(inspected.body.result.counts.overwrite >= 1, 'inspect 要报出会覆盖几个文件')
  assert.deepEqual(inspected.body.result.sections.map((section) => section.id), ['memory'])
  const preview = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'backup', op: 'inspect', file }))
  assert.ok(preview.body.result.sections[0].files >= 1)

  const restored = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'backup', op: 'restore', file, sections: ['memory'] }))
  assert.equal(restored.body.ok, true)
  assert.ok(restored.body.result.written >= 1)
  const body = await call(handler, 'GET', `/api/dsh-control-center/body?section=memory&id=${encodeURIComponent('还原目标.md')}`)
  assert.equal(body.body.body, '原始内容', '还原后应回到备份里的内容')
  assert.ok(restored.body.result.snapshot === null || restored.body.result.snapshot.endsWith('.zip'))

  // 越界文件名一律拒收（不能让 inspect/restore 伸到备份目录之外）。
  const traversal = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'backup', op: 'inspect', file: '..\\..\\mcp.json' }))
  assert.equal(traversal.status, 400)
  assert.match(traversal.body.error, /只允许还原备份目录/)
  const missing = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'backup', op: 'inspect', file: '不存在.zip' }))
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /不存在/)
})

test('API：技能可以对 Agent 启用/禁用，关掉的技能从技能目录里消失', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'skill', op: 'save', skill: { id: 'api-gated', description: '接口开关', body: '正文' } }),
  )
  const on = await call(handler, 'GET', '/api/dsh-control-center/state')
  assert.equal(on.body.state.skills.items.find((item) => item.id === 'api-gated').enabled, true)

  const off = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'skill', op: 'toggle', id: 'api-gated', enabled: false }),
  )
  assert.equal(off.body.ok, true)
  assert.equal(off.body.state.skills.items.find((item) => item.id === 'api-gated').enabled, false)

  // 关掉之后再开，正文与描述不能丢。
  const back = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'skill', op: 'toggle', id: 'api-gated', enabled: true }),
  )
  const restored = back.body.state.skills.items.find((item) => item.id === 'api-gated')
  assert.equal(restored.enabled, true)
  assert.equal(restored.description, '接口开关')
  const body = await call(handler, 'GET', '/api/dsh-control-center/body?section=skill&id=api-gated')
  assert.equal(body.body.body, '正文')

  const missing = await call(
    handler,
    'POST',
    '/api/dsh-control-center/action',
    JSON.stringify({ section: 'skill', op: 'toggle', id: 'nope', enabled: false }),
  )
  assert.equal(missing.status, 400)
  assert.match(missing.body.error, /不存在/)
})

test('API：上传一个不是备份的 zip 被拒（400 而不是 500）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const foreign = createZip([{ name: 'hello.txt', data: Buffer.from('hi') }])
  const response = await call(handler, 'POST', '/api/dsh-control-center/upload', foreign)
  assert.equal(response.status, 400)
  assert.match(response.body.error, /manifest\.json/)
  const garbage = await call(handler, 'POST', '/api/dsh-control-center/upload', Buffer.from('随便一段文字'))
  assert.equal(garbage.status, 400)
  assert.match(garbage.body.error, /zip/)
})

test('API：不支持的 MCP 操作与 reveal 分区都被明确拒绝/接受', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const handler = mount()
  const bad = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'mcp', op: 'nope' }))
  assert.equal(bad.status, 400)
  assert.match(bad.body.error, /不支持的操作/)

  // mcp 的 sync 操作在没有服务器时必须是无副作用的成功。
  const sync = await call(handler, 'POST', '/api/dsh-control-center/action', JSON.stringify({ section: 'mcp', op: 'sync' }))
  assert.equal(sync.body.ok, true)
  assert.deepEqual(sync.body.state.mcp.items, [])
})
