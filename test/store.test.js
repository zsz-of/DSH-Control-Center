/**
 * store 层的集成测试：在**临时 home** 下跑真实文件读写。
 *
 * `paths.js` 在导入时就求值 `homedir()`，所以必须在设置 `USERPROFILE` **之后**再动态导入 store，
 * 否则会写到开发者真实的 `~/.dsh` 里——那正是这个测试要避免的事。
 */

import { strict as assert } from 'node:assert'
import { readFile, rm, stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

let store
let home

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-test-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  store = await import('../lib/store.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

test('规则：空目录返回空列表', async () => {
  assert.deepEqual(await store.listRules(), [])
})

test('规则：新建 → 读回 → 改 → 停用 → 删除', async () => {
  const created = await store.writeRule({
    name: '驾驭工程核心规则',
    description: '总则：上下文治理',
    mode: 'always',
    body: '第一条\n第二条',
  })
  assert.equal(created.file, '驾驭工程核心规则.md')
  assert.equal(created.mode, 'always')
  assert.equal(created.enabled, true)

  const listed = await store.listRules()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].body, '第一条\n第二条')

  const updated = await store.writeRule({
    file: created.file,
    name: '驾驭工程核心规则',
    description: '改过的描述',
    mode: 'ondemand',
    body: '只剩一条',
  })
  assert.equal(updated.mode, 'ondemand')
  assert.equal(updated.description, '改过的描述')

  const disabled = await store.setRuleEnabled(created.file, false)
  assert.equal(disabled.enabled, false)
  // 关键：停用不能清空正文。
  assert.equal(disabled.body, '只剩一条')

  await store.deleteRule(created.file)
  assert.deepEqual(await store.listRules(), [])
  await assert.rejects(() => store.deleteRule(created.file), /不存在/)
})

test('规则：同名不会互相覆盖，自动加序号后缀', async () => {
  const first = await store.writeRule({ name: '同名', mode: 'ondemand', body: 'a' })
  const second = await store.writeRule({ name: '同名', mode: 'ondemand', body: 'b' })
  assert.notEqual(first.file, second.file)
  assert.equal((await store.listRules()).length, 2)
  await store.deleteRule(first.file)
  await store.deleteRule(second.file)
})

test('规则：非法输入在写盘前就报错', async () => {
  await assert.rejects(() => store.writeRule({ name: '  ', mode: 'always', body: 'x' }), /名称不能为空/)
  await assert.rejects(() => store.writeRule({ name: 'a', mode: 'always', body: '   ' }), /正文不能为空/)
  await assert.rejects(() => store.writeRule({ file: '不存在.md', name: 'a', body: 'x' }), /不存在/)
  assert.deepEqual(await store.listRules(), [])
})

test('技能：目录 bundle 往返，且停用没有副作用', async () => {
  const created = await store.writeSkill({
    id: 'my-helper',
    description: '一句话说明',
    whenToUse: '当用户提到 X 时',
    body: '技能正文',
  })
  assert.equal(created.kind, 'bundle')
  assert.equal(created.modelInvocable, true)
  assert.equal(created.userInvocable, true)
  // 落成 <id>/SKILL.md
  await stat(join(home, '.dsh', 'skills', 'my-helper', 'SKILL.md'))

  const read = await store.readSkill('my-helper')
  assert.equal(read.body, '技能正文')
  assert.equal(read.skill.whenToUse, '当用户提到 X 时')

  const restricted = await store.writeSkill({
    id: 'my-helper',
    description: '一句话说明',
    body: '技能正文',
    modelInvocable: false,
  })
  assert.equal(restricted.modelInvocable, false)
  assert.equal(restricted.userInvocable, true)

  const raw = await readFile(join(home, '.dsh', 'skills', 'my-helper', 'SKILL.md'), 'utf8')
  assert.match(raw, /disable-model-invocation: true/)

  await store.deleteSkill('my-helper')
  assert.deepEqual(await store.listSkills(), [])
})

test('技能：非法名字与空描述被拒（模型靠描述判断何时加载）', async () => {
  await assert.rejects(() => store.writeSkill({ id: 'Bad Name', description: 'd', body: 'b' }), /kebab-case/)
  await assert.rejects(() => store.writeSkill({ id: 'ok', description: '  ', body: 'b' }), /描述不能为空/)
  await assert.rejects(() => store.writeSkill({ id: 'ok', description: 'd', body: ' ' }), /正文不能为空/)
})

test('技能：平铺 <name>.md 也能被识别并编辑', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
  await writeFile(
    join(home, '.dsh', 'skills', 'flat-one.md'),
    '---\nname: flat-one\ndescription: 平铺技能\n---\n\n平铺正文\n',
    'utf8',
  )
  const listed = (await store.listSkills()).find((item) => item.id === 'flat-one')
  assert.equal(listed.kind, 'flat')
  const read = await store.readSkill('flat-one')
  assert.equal(read.body, '平铺正文')
  // 编辑平铺技能要保持平铺，不擅自迁移成目录。
  const saved = await store.writeSkill({ id: 'flat-one', description: '平铺技能', body: '改过' })
  assert.equal(saved.kind, 'flat')
  await store.deleteSkill('flat-one')
})

test('MCP：缺文件返回空表；坏 JSON 不抛错而是给出可显示的错误', async () => {
  assert.deepEqual(await store.readMcp(), { servers: [] })
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(home, '.dsh'), { recursive: true })
  await writeFile(join(home, '.dsh', 'mcp.json'), '{ 坏掉的 json', 'utf8')
  const broken = await store.readMcp()
  assert.deepEqual(broken.servers, [])
  assert.match(broken.error, /无法解析/)
})

test('MCP：校验名字、传输必填项与唯一性，并通过写盘往返', async () => {
  const saved = await store.writeMcp([
    { name: 'playwright', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    { name: 'remote', transport: 'streamable-http', url: 'http://localhost:3000/mcp' },
  ])
  assert.equal(saved.length, 2)

  const reloaded = await store.readMcp()
  assert.equal(reloaded.servers.length, 2)
  assert.deepEqual(reloaded.servers[0].args, ['-y', '@playwright/mcp@latest'])
  assert.deepEqual(reloaded.servers[0].env, {})

  await assert.rejects(() => store.writeMcp([{ name: 'bad name!', transport: 'stdio', command: 'x' }]), /服务器名/)
  await assert.rejects(() => store.writeMcp([{ name: 'a', transport: 'stdio' }]), /启动命令/)
  await assert.rejects(() => store.writeMcp([{ name: 'a', transport: 'streamable-http', url: 'ftp://x' }]), /http\(s\)/)
  await assert.rejects(
    () =>
      store.writeMcp([
        { name: 'dup', transport: 'stdio', command: 'a' },
        { name: 'dup', transport: 'stdio', command: 'b' },
      ]),
    /重复/,
  )
})

test('MCP：参数既接受数组，也接受空格分隔的字符串', () => {
  const fromArray = store.normalizeServer({ name: 'a', transport: 'stdio', command: 'x', args: ['-y', 'pkg'] })
  assert.deepEqual(fromArray.args, ['-y', 'pkg'])
  const fromString = store.normalizeServer({ name: 'b', transport: 'stdio', command: 'x', args: '-y  pkg' })
  assert.deepEqual(fromString.args, ['-y', 'pkg'])
})
