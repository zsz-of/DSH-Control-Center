/**
 * 工具层测试：Agent 能自己做什么、什么必须审批。
 *
 * 这是「权限分级」这条需求的回归防线：
 * - 配置类工具（MCP / 技能 / 记忆 / 导入 / 设置 / 备份）必须**不需要**审批；
 * - 只有规则写入（`control_center_rule_write` / `_delete`）必须**要求**审批。
 *
 * 用桩 `ctx.tools` 把工具注册下来后直接调 `execute`——这里验的是工具本体的行为，
 * 审批闸门单独用 `tools/pre-execute` 的处理器验证。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEER_LINK = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh-tools')

let ready = false
let tools
let store
let paths
let home

before(async () => {
  if (!existsSync(PEER_LINK)) return
  home = await mkdtemp(join(tmpdir(), 'dcc-tools-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dcc-tools-harness-'))
  paths = await import('../lib/paths.js')
  store = await import('../lib/store.js')
  tools = await import('../lib/tools.js')
  ready = true
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

/** 注册全部工具，返回按名字索引的定义与审批处理器。 */
function mount() {
  const registered = new Map()
  let gate
  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => {}
      },
    },
    on(event, handler) {
      if (event === 'tools/pre-execute') gate = handler
    },
  }
  const state = { revision: 0 }
  const runtime = {
    mcp: { sync: async () => {} },
    invalidateSkills: () => {},
    bumpRevision: () => {
      state.revision += 1
    },
  }
  const dispose = tools.registerTools(ctx, runtime)
  return { registered, gate, dispose, state }
}

/** 跑一次工具的 execute。 */
async function run(registered, name, args = {}) {
  const definition = registered.get(name)
  assert.ok(definition !== undefined, `工具 ${name} 未注册`)
  return definition.execute(args, { signal: undefined })
}

test('工具：注册齐了配置类工具，且只有规则写入要求审批', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  const names = [...registered.keys()].sort()
  assert.deepEqual(names, [
    'control_center_backup',
    'control_center_import',
    'control_center_mcp',
    'control_center_memory',
    'control_center_overview',
    'control_center_rule_delete',
    'control_center_rule_list',
    'control_center_rule_write',
    'control_center_settings',
    'control_center_skill',
  ])
  assert.deepEqual(tools.APPROVAL_REQUIRED, ['control_center_rule_write', 'control_center_rule_delete'])
  // 规则工具是写规则的那两个，其余都是配置类。
  for (const name of names) {
    assert.equal(typeof registered.get(name).execute, 'function', `${name} 缺少 execute`)
    assert.equal(typeof registered.get(name).description, 'string')
  }
})

test('工具：配置类不需要审批，规则写入必须 ask', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { gate } = mount()
  assert.equal(typeof gate, 'function', '必须注册 tools/pre-execute 闸门')
  const next = () => 'allow'
  for (const name of ['control_center_mcp', 'control_center_import', 'control_center_memory', 'control_center_settings', 'control_center_backup', 'control_center_skill', 'control_center_rule_list']) {
    assert.equal(gate({ name }, next), 'allow', `${name} 不该要求审批`)
  }
  for (const name of tools.APPROVAL_REQUIRED) {
    const decision = gate({ name }, next)
    assert.equal(decision.kind, 'ask', `${name} 必须要求审批`)
    assert.match(decision.reason, /规则/)
  }
})

test('工具：规则写入只在用户审批通过后才落盘（默认全局，也可写项目）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  const text = await run(registered, 'control_center_rule_write', {
    name: '工具写的规则',
    mode: 'always',
    body: '正文甲',
    description: '来自工具',
  })
  assert.match(text, /已保存全局规则/)
  const saved = await store.listRules()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].body, '正文甲')

  const workspace = await mkdtemp(join(tmpdir(), 'dcc-tools-ws-'))
  try {
    const projectText = await run(registered, 'control_center_rule_write', {
      scope: 'project',
      workspace,
      name: '项目规则',
      mode: 'ondemand',
      body: '项目正文',
    })
    assert.match(projectText, /已保存项目规则/)
    assert.match(await readFile(join(workspace, '.dsh', 'rules', '项目规则.md'), 'utf8'), /项目正文/)
    // 规则列表要按作用域分开看。
    const globalList = await run(registered, 'control_center_rule_list', {})
    assert.match(globalList, /工具写的规则/)
    assert.ok(!globalList.includes('项目正文'), '全局列表里不该出现项目规则')
    const projectList = await run(registered, 'control_center_rule_list', { scope: 'project', workspace, includeBody: true })
    assert.match(projectList, /项目正文/)
    // 删除也要带作用域。
    await run(registered, 'control_center_rule_delete', { scope: 'project', workspace, file: '项目规则.md' })
    assert.equal((await store.listRules({ scope: 'project', workspace })).length, 0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('工具：MCP 增删启停走真实注册表，非法输入报可读错误', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  await run(registered, 'control_center_mcp', { action: 'add', name: 'demo', transport: 'stdio', command: 'node', args: ['server.js'], env: 'A=1\nB=2' })
  const listed = await run(registered, 'control_center_mcp', { action: 'list' })
  assert.match(listed, /demo/)
  assert.match(listed, /node server\.js/)
  const written = await store.readMcp()
  assert.deepEqual(written.servers[0].env, { A: '1', B: '2' })

  await run(registered, 'control_center_mcp', { action: 'disable', name: 'demo' })
  assert.equal((await store.readMcp()).servers[0].enabled, false)
  await assert.rejects(() => run(registered, 'control_center_mcp', { action: 'enable', name: '不存在' }), /不存在/)
  await assert.rejects(() => run(registered, 'control_center_mcp', { action: 'add', name: 'bad name' }), /服务器名/)
  await run(registered, 'control_center_mcp', { action: 'remove', name: 'demo' })
  assert.deepEqual((await store.readMcp()).servers, [])
})

test('工具：记忆与技能可直接增删', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  await run(registered, 'control_center_memory', { action: 'save', name: '偏好', description: 'd', body: '用中文' })
  const listed = await run(registered, 'control_center_memory', { action: 'list' })
  assert.match(listed, /偏好/)
  await run(registered, 'control_center_memory', { action: 'pin', file: '偏好.md' })
  assert.equal((await (await import('../lib/memory.js')).listMemories())[0].pinned, true)
  await run(registered, 'control_center_memory', { action: 'remove', file: '偏好.md' })
  assert.deepEqual(await (await import('../lib/memory.js')).listMemories(), [])

  await run(registered, 'control_center_skill', { action: 'save', id: 'demo-skill', description: '技能描述', body: '技能正文' })
  assert.match(await run(registered, 'control_center_skill', { action: 'list' }), /demo-skill/)
  await run(registered, 'control_center_skill', { action: 'remove', id: 'demo-skill' })
  assert.deepEqual(await store.listSkills(), [])
})

test('工具：设置读写与备份三件套可用', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  await run(registered, 'control_center_settings', { action: 'update', json: '{"memory":{"inject":false}}' })
  const settings = JSON.parse(await run(registered, 'control_center_settings', { action: 'get' }))
  assert.equal(settings.memory.inject, false)
  await assert.rejects(() => run(registered, 'control_center_settings', { action: 'update', json: '{坏' }), /不是合法 JSON/)

  await run(registered, 'control_center_rule_write', { name: '备份用', mode: 'always', body: 'x' })
  const created = await run(registered, 'control_center_backup', { action: 'create', sections: ['rules'] })
  assert.match(created, /已备份/)
  const list = await run(registered, 'control_center_backup', { action: 'list' })
  assert.match(list, /dsh-backup-/)
  const sections = await run(registered, 'control_center_backup', { action: 'sections' })
  assert.match(sections, /rules/)
  assert.match(sections, /credentials/)
})

test('工具：概览会同时报全局与项目规则', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  const workspace = await mkdtemp(join(tmpdir(), 'dcc-tools-ov-'))
  try {
    await run(registered, 'control_center_rule_write', { scope: 'project', workspace, name: '项目甲', mode: 'always', body: 'b' })
    const text = await run(registered, 'control_center_overview', { workspace })
    assert.match(text, /全局规则/)
    assert.match(text, /项目规则目录/)
    assert.match(text, /项目甲/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('工具：导入扫描在空 home 下也能给出结论', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  const text = await run(registered, 'control_center_import', { action: 'scan' })
  assert.match(text, /没找到|合计/)
})

test('工具：参数在 execute 之前被 schema 校验（非法参数进不到我们的逻辑里）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered } = mount()
  const backup = registered.get('control_center_backup')
  // action 是必填的 enum：缺参数与非法取值都必须在进 execute 之前被拒。
  await assert.rejects(() => backup.execute({}, { signal: undefined }), /action|Invalid|invalid|required|参数/)
  await assert.rejects(() => backup.execute({ action: '不存在的动作' }, { signal: undefined }), /action|Invalid|invalid|enum|参数/)
  // 合法取值能过。
  assert.match(await backup.execute({ action: 'sections' }, { signal: undefined }), /rules/)
})

test('工具：写操作 bump 版本号、读操作不 bump（供前端轮询刷新）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { registered, state } = mount()
  // 读操作不动版本号。
  await run(registered, 'control_center_overview', {})
  await run(registered, 'control_center_mcp', { action: 'list' })
  await run(registered, 'control_center_import', { action: 'scan' })
  assert.equal(state.revision, 0, '读操作不该 bump')

  // 写操作 +1。
  await run(registered, 'control_center_mcp', { action: 'add', name: 'demo', transport: 'stdio', command: 'node' })
  assert.equal(state.revision, 1, 'MCP add 应 bump')
  await run(registered, 'control_center_memory', { action: 'save', name: 'm', description: 'd', body: 'b' })
  assert.equal(state.revision, 2, 'memory save 应 bump')
  await run(registered, 'control_center_rule_write', { name: 'r', mode: 'always', body: 'b' })
  assert.equal(state.revision, 3, 'rule_write 应 bump')
  await run(registered, 'control_center_settings', { action: 'update', json: '{"memory":{"inject":false}}' })
  assert.equal(state.revision, 4, 'settings update 应 bump')
  await run(registered, 'control_center_backup', { action: 'create', sections: ['rules'] })
  assert.equal(state.revision, 5, 'backup create 应 bump')
  // 只读 backup 动作不动版本号。
  await run(registered, 'control_center_backup', { action: 'sections' })
  assert.equal(state.revision, 5)
})

test('工具：dispose 会摘掉注册与闸门', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  const { dispose } = mount()
  assert.equal(typeof dispose, 'function')
  dispose()
  // 清理必须幂等且不抛（卸载期调用）。
  dispose()
})

test('工具：项目规则目录随工作区走，且不写在插件数据根里', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools 链接')
  assert.equal(paths.projectRulesDir('D:\\Code\\X'), join('D:\\Code\\X', '.dsh', 'rules'))
  const workspace = await mkdtemp(join(tmpdir(), 'dcc-tools-path-'))
  try {
    await mkdir(join(workspace, '.dsh', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.dsh', 'rules', 'x.md'), '---\nname: x\nmode: always\n---\n\nb\n', 'utf8')
    const rules = await store.listRules({ scope: 'project', workspace })
    assert.equal(rules.length, 1)
    assert.equal(rules[0].scope, 'project')
    await assert.rejects(() => store.listRules({ scope: 'project', workspace: '' }), /工作区目录/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
