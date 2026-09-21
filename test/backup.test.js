/**
 * 备份/恢复的端到端测试：在临时 home + 临时 `$DSH_HOME` 下真实打包、解析、恢复。
 *
 * 覆盖三件最容易出错的事：
 * 1. **分区选择真的生效**（没勾的分区不能进包、也不能被恢复）；
 * 2. **恢复计划如实报告新建/覆盖**（用户是在这一步确认要不要动手的）；
 * 3. **越界条目被拒**（zip 是不可信输入）。
 */

import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { createZip } from '../lib/zip.js'

let backup
let store
let memory
let paths
let home
let harness

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-backup-home-'))
  harness = await mkdtemp(join(tmpdir(), 'dcc-backup-harness-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = harness
  paths = await import('../lib/paths.js')
  backup = await import('../lib/backup.js')
  store = await import('../lib/store.js')
  memory = await import('../lib/memory.js')

  // 造一个最小的安装根：profile 里放上本插件的链接目录名，让 resolveProfileName 认出来。
  await mkdir(join(harness, 'profiles', 'web', 'node_modules', 'dsh-control-center'), { recursive: true })
  await writeFile(
    join(harness, 'profiles', 'web', 'package.json'),
    `${JSON.stringify({ dependencies: { 'dsh-control-center': 'file:x' }, dsh: { profile: { bundles: ['dsh-control-center'] } } }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(join(harness, 'profiles', 'web', 'cordis.patch.yml'), '- insert: []\n', 'utf8')
  await writeFile(join(harness, 'settings.yaml'), 'agent-default-model:\n  provider: deepseek-official\n  model: deepseek-v4-flash\n', 'utf8')
  await writeFile(join(harness, 'AGENTS.md'), '# 全局指令\n', 'utf8')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(harness, { recursive: true, force: true })
})

test('备份：分区清单覆盖插件清单/规则/技能/记忆/MCP/设置，且识别当前 profile', async () => {
  const sections = await backup.listSections()
  const ids = sections.map((section) => section.id)
  for (const id of ['rules', 'skills', 'memory', 'mcp', 'plugins', 'settings', 'instructions', 'credentials']) {
    assert.ok(ids.includes(id), `缺少分区 ${id}`)
  }
  assert.equal(paths.resolveProfileName(), 'web')
  const plugins = sections.find((section) => section.id === 'plugins')
  assert.ok(plugins.roots.some((root) => root.abs.endsWith('package.json')))
})

test('备份：只打包勾选的分区，恢复计划如实报告新建与覆盖', async () => {
  await store.writeRule({ name: '备份用规则', description: 'd', mode: 'always', body: '规则正文' })
  await memory.writeMemory({ name: '备份用记忆', description: 'd', body: '记忆正文' })
  await store.writeMcp([{ name: 'demo', transport: 'stdio', command: 'node' }])

  const created = await backup.createBackup(['rules', 'mcp'])
  assert.ok(created.bytes > 0)
  assert.ok(created.file.endsWith('.zip'))
  const stats = created.stats.map((item) => item.id)
  assert.deepEqual(stats, ['rules', 'mcp'])
  assert.ok(!stats.includes('memory'))

  const analysis = backup.analyzeBackup(await readFile(created.file))
  assert.equal(analysis.manifest.format, backup.BACKUP_FORMAT)
  assert.equal(analysis.manifest.version, backup.BACKUP_VERSION)
  assert.equal(analysis.manifest.source.profile, 'web')
  assert.deepEqual(analysis.sections.map((section) => section.id).sort(), ['mcp', 'rules'])
  assert.ok(!analysis.entries.some((entry) => entry.name.includes('memory')), '没勾的分区不能进包')

  // 第一遍：目标文件已存在 → 全部是「覆盖」。
  const plan = await backup.planRestore(analysis, [])
  assert.equal(plan.counts.create, 0)
  assert.equal(plan.counts.overwrite, 2)
  assert.equal(plan.items.length, 2)
})

test('备份：先删掉再恢复 → 内容逐字节还原', async () => {
  const created = await backup.createBackup(['rules', 'memory'])
  const analysis = backup.analyzeBackup(await readFile(created.file))
  const rulesBefore = await readFile(join(paths.RULES_DIR, '备份用规则.md'), 'utf8')

  await rm(paths.RULES_DIR, { recursive: true, force: true })
  await rm(paths.MEMORY_DIR, { recursive: true, force: true })
  assert.deepEqual(await store.listRules(), [])

  const plan = await backup.planRestore(analysis, ['rules'])
  assert.equal(plan.counts.create, 1, '文件已删除，应报告为新建')
  const applied = await backup.applyRestore(plan)
  assert.equal(applied.failed.length, 0)
  assert.equal(await readFile(join(paths.RULES_DIR, '备份用规则.md'), 'utf8'), rulesBefore)
  // 只恢复 rules，记忆仍然是空的。
  assert.deepEqual(await memory.listMemories(), [])

  const plan2 = await backup.planRestore(analysis, ['memory'])
  await backup.applyRestore(plan2)
  assert.equal((await memory.listMemories()).length, 1)
})

test('备份：dryRun 只报告不落盘', async () => {
  const created = await backup.createBackup(['rules'])
  const analysis = backup.analyzeBackup(await readFile(created.file))
  await rm(paths.RULES_DIR, { recursive: true, force: true })
  const plan = await backup.planRestore(analysis, [])
  const applied = await backup.applyRestore(plan, { dryRun: true })
  assert.equal(applied.written.length, 1)
  assert.deepEqual(await store.listRules(), [], 'dryRun 不能真的写文件')
})

test('备份：保留份数会清理最旧的产物', async () => {
  const first = await backup.createBackup(['mcp'], { retention: 0 })
  const second = await backup.createBackup(['mcp'], { retention: 0 })
  assert.notEqual(first.file, second.file, '同一秒内连做两次备份也不能互相覆盖')
  const kept = await backup.pruneBackups(1)
  assert.ok(kept.length >= 1)
  const rest = await backup.listBackups()
  assert.equal(rest.length, 1)
  assert.equal(rest[0].file, second.file.split(/[\\/]/).pop())
})

test('备份：删除只接受备份目录里的普通文件名', async () => {
  const items = await backup.listBackups()
  await assert.rejects(() => backup.deleteBackup('..\\..\\mcp.json'), /只允许删除备份目录/)
  await assert.rejects(() => backup.deleteBackup('sub/dir.zip'), /只允许删除备份目录/)
  await assert.rejects(() => backup.deleteBackup('notes.txt'), /只允许删除备份目录/)
  assert.ok(items.length >= 1)
})

test('备份：勾选不存在的分区、空选择都明确报错（不接受「空 = 全部」）', async () => {
  await assert.rejects(() => backup.createBackup(['nope']), /未知的备份分区/)
  await assert.rejects(() => backup.createBackup([]), /没有选中任何要备份的分区/)
  await assert.rejects(() => backup.createBackup(undefined), /没有选中任何要备份的分区/)
})

test('备份：包里的越界路径被拒（不能写到备份目录以外）', () => {
  const crafted = createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: backup.BACKUP_FORMAT, version: 1, sections: [] })) },
    { name: 'payload/rules/../../../evil.md', data: Buffer.from('x') },
    { name: 'payload/rules/ok.md', data: Buffer.from('ok') },
  ])
  const analysis = backup.analyzeBackup(crafted)
  assert.deepEqual(analysis.entries.map((entry) => entry.name), ['payload/rules/ok.md'])
})

test('备份：不是本插件导出的 zip 会被明确拒绝', () => {
  const foreign = createZip([{ name: 'readme.txt', data: Buffer.from('hello') }])
  assert.throws(() => backup.analyzeBackup(foreign), /manifest\.json/)
  const wrongFormat = createZip([{ name: 'manifest.json', data: Buffer.from('{"format":"other"}') }])
  assert.throws(() => backup.analyzeBackup(wrongFormat), /格式不匹配/)
  const futureVersion = createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: backup.BACKUP_FORMAT, version: 99 })) },
  ])
  assert.throws(() => backup.analyzeBackup(futureVersion), /高于当前插件支持/)
})
