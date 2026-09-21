/**
 * 技能提供方的契约测试：候选形状与 `get()` 的返回必须对得上 registry 的期望。
 *
 * 同 `store.test.js`：先改 `USERPROFILE` 再动态导入（`paths.js` 在导入时求值 homedir）。
 */

import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

let provider
let store
let home

/** 造一个只满足契约的最小 control 句柄。 */
function fakeControl() {
  return { invalidate: () => {}, signal: new AbortController().signal }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-skill-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  store = await import('../lib/store.js')
  const { ControlCenterSkillProvider } = await import('../lib/skills.js')
  provider = new ControlCenterSkillProvider(fakeControl())
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

test('provider：空目录返回空候选，且声明了自己的身份', async () => {
  assert.equal(provider.name, 'control-center')
  assert.deepEqual(await provider.list({ cwd: home }), [])
})

test('provider：候选带齐 registry 需要的字段', async () => {
  await store.writeSkill({
    id: 'demo-skill',
    description: '演示技能',
    whenToUse: '当用户提到演示时',
    body: '正文内容',
  })
  const candidates = await provider.list({ cwd: home })
  assert.equal(candidates.length, 1)
  const candidate = candidates[0]
  assert.equal(candidate.name, 'demo-skill')
  assert.equal(candidate.description, '演示技能')
  assert.equal(candidate.whenToUse, '当用户提到演示时')
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(candidate.provider, 'control-center')
  assert.equal(candidate.source, 'custom')
  assert.equal(candidate.rank, 300)
  assert.equal(candidate.locator.directory, join(home, '.dsh', 'skills', 'demo-skill'))
  assert.equal(candidate.locator.path, join(home, '.dsh', 'skills', 'demo-skill', 'SKILL.md'))
  assert.equal(candidate.resourceBase.kind, 'directory')
})

test('provider：get() 返回完整正文与调用策略', async () => {
  const [candidate] = await provider.list({ cwd: home })
  const full = await provider.get(candidate, {})
  assert.equal(full.name, 'demo-skill')
  assert.equal(full.content, '正文内容')
  assert.equal(full.provider, 'control-center')
  assert.equal(full.path, candidate.locator.path)
  assert.deepEqual(full.invocation, { modelInvocable: true, userInvocable: true })
})

test('provider：文件消失时 get() 返回 undefined（而不是抛错）', async () => {
  const [candidate] = await provider.list({ cwd: home })
  await store.deleteSkill('demo-skill')
  assert.equal(await provider.get(candidate, {}), undefined)
})

test('provider：disable-model-invocation 的技能仍要列出（它服务「用户手动调用」入口）', async () => {
  await store.writeSkill({
    id: 'user-only',
    description: '只能手动调用',
    body: 'x',
    modelInvocable: false,
  })
  const candidates = await provider.list({ cwd: home })
  const found = candidates.find((item) => item.name === 'user-only')
  assert.equal(found.invocation.modelInvocable, false)
  assert.equal(found.invocation.userInvocable, true)
  const full = await provider.get(found, {})
  assert.deepEqual(full.invocation, { modelInvocable: false, userInvocable: true })
})

test('provider：平铺文件走 user 级目录作为 resourceBase', async () => {
  await mkdir(join(home, '.dsh', 'skills'), { recursive: true })
  await writeFile(
    join(home, '.dsh', 'skills', 'flat.md'),
    '---\nname: flat\ndescription: 平铺\n---\n\n平铺正文\n',
    'utf8',
  )
  const candidates = await provider.list({ cwd: home })
  const flat = candidates.find((item) => item.name === 'flat')
  assert.equal(flat.locator.path, join(home, '.dsh', 'skills', 'flat.md'))
  assert.equal(flat.locator.directory, join(home, '.dsh', 'skills'))
  const full = await provider.get(flat, {})
  assert.equal(full.content, '平铺正文')
})

test('provider：缺描述的坏文件不进候选（否则模型无法判断何时加载）', async () => {
  await writeFile(join(home, '.dsh', 'skills', 'broken.md'), '没有 frontmatter 的正文\n', 'utf8')
  const candidates = await provider.list({ cwd: home })
  assert.equal(candidates.some((item) => item.name === 'broken'), false)
})

test('provider：在控制中心关掉的技能不进候选，重新启用后回来', async () => {
  await store.writeSkill({ id: 'toggle-me', description: '开关测试', body: '正文' })
  assert.ok((await provider.list({ cwd: home })).some((item) => item.name === 'toggle-me'), '默认应启用')

  const off = await store.setSkillEnabled('toggle-me', false)
  assert.equal(off.enabled, false)
  // 关掉 = 完全不进 agent 的技能目录：既不注入上下文，`/` 菜单里也不会有它。
  assert.equal((await provider.list({ cwd: home })).some((item) => item.name === 'toggle-me'), false)
  // 但控制中心仍旧看得到它（否则没法再打开）。
  assert.equal((await store.listSkills()).find((item) => item.id === 'toggle-me').enabled, false)
  // 落盘形态：正文与其余 frontmatter 原样保留，只多一个 enabled: false。
  const raw = await readFile(join(home, '.dsh', 'skills', 'toggle-me', 'SKILL.md'), 'utf8')
  assert.match(raw, /^enabled: false$/m)
  assert.match(raw, /正文/)

  await store.setSkillEnabled('toggle-me', true)
  assert.ok((await provider.list({ cwd: home })).some((item) => item.name === 'toggle-me'), '重新启用后应回到目录里')
  assert.equal(/^enabled:/m.test(await readFile(join(home, '.dsh', 'skills', 'toggle-me', 'SKILL.md'), 'utf8')), false)
})

test('闸门：调用已关闭的技能被拒且说明原因，其余调用原样放行', async () => {
  const { registerDisabledSkillGate } = await import('../lib/skills.js')
  const handlers = new Map()
  const ctx = { on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name) } }
  const dispose = registerDisabledSkillGate(ctx)
  const gate = handlers.get('tools/pre-execute')
  assert.equal(typeof gate, 'function', '闸门必须挂在 tools/pre-execute 上')

  const next = async () => ({ kind: 'allow' })
  await store.writeSkill({ id: 'gated', description: '被关掉的技能', body: '正文' })
  await store.setSkillEnabled('gated', false)

  const denied = await gate({ name: 'skill', arguments: { name: 'gated' } }, next)
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /已被用户在控制中心关闭/)

  // 没关的技能、别的工具、以及缺少参数，都不该被这个闸门拦下。
  assert.deepEqual(await gate({ name: 'skill', arguments: { name: 'toggle-me' } }, next), { kind: 'allow' })
  assert.deepEqual(await gate({ name: 'read', arguments: { name: 'gated' } }, next), { kind: 'allow' })
  assert.deepEqual(await gate({ name: 'skill', arguments: {} }, next), { kind: 'allow' })

  dispose()
  assert.equal(handlers.has('tools/pre-execute'), false, 'dispose 要摘掉闸门')
})
