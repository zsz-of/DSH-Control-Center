/**
 * 设置层测试：默认值合并、写坏的类型退回默认、DSH 默认模型的读取。
 *
 * 在临时 home + 临时 `$DSH_HOME` 下跑（`paths.js` 在导入时求值 `homedir()`）。
 */

import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

let settings
let paths
let home
let harness

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-settings-home-'))
  harness = await mkdtemp(join(tmpdir(), 'dcc-settings-harness-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = harness
  paths = await import('../lib/paths.js')
  settings = await import('../lib/settings.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(harness, { recursive: true, force: true })
})

test('设置：文件不存在时返回默认值', async () => {
  const current = await settings.readSettings()
  assert.equal(current.optimize.enabled, true)
  assert.equal(current.optimize.provider, '')
  assert.equal(current.memory.inject, true)
  assert.equal(current.rules.approval, 'ask', '默认与平台自带行为一致：每次询问')
  assert.deepEqual(current.rules.allowedWorkspaces, [], '默认没有任何工作区豁免')
  assert.equal(current.ui.defaultTab, 'rule')
  assert.deepEqual(current.scan.custom, [])
})

test('设置：损坏的 JSON 不抛错，退回默认值', async () => {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(paths.CONFIG_DIR, { recursive: true })
  await writeFile(paths.SETTINGS_FILE, '{ 这不是 json', 'utf8')
  const current = await settings.readSettings()
  assert.equal(current.optimize.enabled, true)
})

test('设置：写坏的类型逐字段退回默认值，坏的自定义源被丢掉', () => {
  const normalized = settings.normalizeSettings({
    optimize: { enabled: 'yes', provider: 42, model: 'x', reasoningEffort: null, prompt: undefined },
    memory: { enabled: false, inject: 'nope' },
    backup: { retention: -5, snapshotBeforeImport: true },
    scan: {
      disabled: ['codex', 7],
      custom: [
        { id: 'ok', label: 'L', kind: 'json', path: 'C:\\x.json' },
        { id: 'bad-kind', kind: 'nonsense', path: 'C:\\y.json' },
        { id: '', path: 'C:\\z.json' },
        'not-an-object',
      ],
    },
    ui: { defaultTab: 'nope' },
  })
  assert.equal(normalized.optimize.enabled, true, '非布尔退回默认')
  assert.equal(normalized.optimize.provider, '', '非字符串退回空')
  assert.equal(normalized.optimize.model, 'x')
  assert.equal(normalized.memory.enabled, false)
  assert.equal(normalized.memory.inject, true, '非布尔退回默认')
  assert.equal(normalized.backup.retention, 20, '负数退回默认')
  assert.deepEqual(normalized.scan.disabled, ['codex'], '非字符串项被丢掉')
  assert.deepEqual(normalized.scan.custom.map((item) => item.id), ['ok', 'bad-kind'], '空 id 与非对象被丢掉')
  assert.equal(normalized.scan.custom[1].kind, 'json', '非法 kind 退回 json')
  assert.equal(normalized.ui.defaultTab, 'rule', '非法标签页退回默认')
})

test('设置：保存是深合并，不会把没传的分区清空', async () => {
  await settings.writeSettings({ optimize: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
  const saved = await settings.readSettings()
  assert.equal(saved.optimize.provider, 'deepseek-official')
  assert.equal(saved.optimize.enabled, true, '没传的字段保持原值')
  assert.equal(saved.memory.inject, true)

  await settings.writeSettings({ memory: { inject: false } })
  const again = await settings.readSettings()
  assert.equal(again.optimize.provider, 'deepseek-official', '另一次保存不影响优化路由')
  assert.equal(again.memory.inject, false)

  const raw = JSON.parse(await readFile(paths.SETTINGS_FILE, 'utf8'))
  assert.equal(raw.memory.inject, false)
})

test('设置：审批档位只认三档，写坏了退回「每次询问」，别的分区保存不会把它抹掉', async () => {
  assert.deepEqual(settings.RULE_APPROVALS, ['ask', 'allow', 'deny-always'])
  assert.equal(settings.normalizeSettings({ rules: { approval: 'always-allow' } }).rules.approval, 'ask', '没见过的档位不能透传到闸门')
  assert.equal(
    settings.normalizeSettings({ rules: { approval: 'deny-once' } }).rules.approval,
    'ask',
    '「禁止一次」是老版本的档位，现在只是弹框上的按钮',
  )
  assert.equal(settings.normalizeSettings({ rules: null }).rules.approval, 'ask', '整组写坏也要退回默认')

  await settings.writeSettings({ rules: { approval: 'deny-always' } })
  assert.equal((await settings.readSettings()).rules.approval, 'deny-always')
  await settings.writeSettings({ memory: { inject: true } })
  assert.equal((await settings.readSettings()).rules.approval, 'deny-always', 'writeSettings 的合并列表里必须有 rules')
  await settings.writeSettings({ rules: { approval: 'ask' } })
})

test('设置：工作区豁免是去重后的路径清单，写坏的类型丢掉，切档位不会把它抹掉', async () => {
  const normalized = settings.normalizeSettings({
    rules: { allowedWorkspaces: ['D:\\a', 'D:\\a', '  D:\\b  ', '', 42, null] },
  })
  assert.deepEqual(normalized.rules.allowedWorkspaces, ['D:\\a', 'D:\\b'], '去重 + 去空白 + 丢掉非字符串')
  assert.deepEqual(settings.normalizeSettings({ rules: { allowedWorkspaces: 'D:\\a' } }).rules.allowedWorkspaces, [], '不是数组就当没豁免')

  await settings.writeSettings({ rules: { allowedWorkspaces: ['D:\\a'] } })
  await settings.writeSettings({ rules: { approval: 'allow' } })
  assert.deepEqual((await settings.readSettings()).rules.allowedWorkspaces, ['D:\\a'], '切档位不该丢掉豁免名单')
  await settings.writeSettings({ rules: { allowedWorkspaces: [] } })
})

test('设置：DSH 默认模型优先取服务，服务缺席/形状不合法时退回 settings.yaml', async () => {
  // 服务就绪时只认服务读到的值（`lib/index.js` 用 `ctx.inject(['agentDefaultModel'])` 接成
  // `runtime.readDefaultModel`，这里直接传同形状的取值函数）。
  assert.deepEqual(await settings.dshDefaultModel(() => ({ provider: 'shusheng', model: 'glm-4.6', reasoningEffort: 'high' })), {
    provider: 'shusheng',
    model: 'glm-4.6',
    reasoningEffort: 'high',
  })
  assert.equal(await settings.dshDefaultModel(() => ({ model: 'glm-4.6' })), undefined, '缺 provider 不算数')
  assert.equal(await settings.dshDefaultModel(), undefined, '没有服务、也没有文件 → undefined')
  await writeFile(
    join(harness, 'settings.yaml'),
    ['ui-theme:', '  preference: system', 'agent-default-model:', '  provider: deepseek-official', '  model: deepseek-v4-flash', '  reasoningEffort: max', ''].join('\n'),
    'utf8',
  )
  assert.deepEqual(await settings.dshDefaultModel(), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  assert.deepEqual(
    await settings.dshDefaultModel(() => ({})),
    { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    '服务给的形状不合法时要继续走文件兜底',
  )
})

test('设置：模型等级只认 1-3，屏蔽项与提供方层级去重；写入必须真的落盘', async () => {
  const normalized = settings.normalizeSettings({
    models: {
      autoSwitch: 'yes',
      tiers: { 'p1/m1': 1, 'p1/m2': '2', 'p1/m3': 4, 'p1/m4': 'x', '': 1, '  ': 2 },
      blocked: ['a/b', 'a/b', '  ', 42],
      providerOrder: ['p1', 'p2', 'p1', ''],
    },
  })
  assert.equal(normalized.models.autoSwitch, true, '不是布尔就退回默认（开）')
  assert.deepEqual(normalized.models.tiers, { 'p1/m1': 1, 'p1/m2': 2 }, '等级只认 1|2|3，其余丢弃')
  assert.deepEqual(normalized.models.blocked, ['a/b'], '屏蔽项去重、丢掉非字符串')
  assert.deepEqual(normalized.models.providerOrder, ['p1', 'p2'], '提供方层级去重、丢掉空串')

  // 写盘往返：`writeSettings` 必须把 models 合并进去（漏了它时页面「保存」等于什么都没发生）。
  await settings.writeSettings({ models: { autoSwitch: false, tiers: { 'p1/m1': 3 } } })
  const after = await settings.readSettings()
  assert.equal(after.models.autoSwitch, false)
  assert.deepEqual(after.models.tiers, { 'p1/m1': 3 })
  await settings.writeSettings({ models: { autoSwitch: true, tiers: {} } })
})
