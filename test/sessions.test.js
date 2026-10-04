/**
 * 会话彻底删除的宿主侧测试：**在一棵真的临时目录树上验证文件真的被删了**。
 *
 * 这一组用例守的是「彻底删除」这个承诺的三件事，缺一件用户就会看到删不干净：
 * 1. 落点算全（正文目录 / 回滚快照 / 投影缓存 / 溢出目录）；
 * 2. 只删该删的（别的会话、别的项目目录、共享目录一个字节都不动）；
 * 3. id 校验是防目录穿越的**唯一闸门**（非法 id 一个目标都不给）。
 *
 * 删除是不可逆动作，所以这里宁可把断言写细：删多了比删少了严重得多。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { deleteSessionFiles, deleteSessionFilesBatch, isValidSessionId, sessionTargets, spillDirName } from '../lib/sessions.js'

/** 一棵假数据根（`~/.dsh` 的形状）+ 一个假临时根（放溢出目录）。 */
let root
let tmp
/** 两个会话 id：`doomed` 要被删，`alive` 必须原封不动。 */
const doomed = 'session-11111111-2222-3333-4444-555555555555'
const alive = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** 造一个文件：父目录可能还不存在，`writeFile` 不会替我们建。 */
async function put(filePath, content) {
  await mkdir(join(filePath, '..'), { recursive: true })
  await writeFile(filePath, content)
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dcc-sessions-root-'))
  tmp = await mkdtemp(join(tmpdir(), 'dcc-sessions-tmp-'))

  // 正文：同一个 id 在**两个**工作区目录下都可能有（id 是唯一键，猜 cwd 会漏删）。
  await put(join(root, 'sessions', 'proj-A', doomed, 'session.v4.jsonl.zstd'), 'A')
  await put(join(root, 'sessions', 'proj-B', doomed, 'session.v4.jsonl.zstd'), 'B')
  // 另一个会话、以及一个「前缀相同」的目录（`<id>-suffix`）：都不许被带走。
  await put(join(root, 'sessions', 'proj-A', alive, 'session.v4.jsonl.zstd'), 'alive')
  await put(join(root, 'sessions', 'proj-A', `${doomed}-suffix`, 'session.v4.jsonl.zstd'), 'suffix')
  // 回滚快照与投影缓存。
  await put(join(root, 'rewind-snapshots', doomed, 'snap.json'), '{}')
  await put(join(root, 'storages', 'session_projcache', 'sessions', `${doomed}.json`), '{}')
  // 共享文件：删会话时绝不能碰。
  await put(join(root, 'storages', 'community_market', 'global.json'), '{}')
  // 溢出目录：每进程一个临时根，只有 `dsh-spill-` 开头的才看。
  await put(join(tmp, 'dsh-spill-local', spillDirName(doomed), 'out.txt'), 'x')
  await put(join(tmp, 'dsh-spill-local', spillDirName(alive), 'out.txt'), 'x')
  await put(join(tmp, 'not-a-spill', spillDirName(doomed), 'out.txt'), 'x')
})

after(async () => {
  for (const dir of [root, tmp]) if (dir !== undefined) await rm(dir, { recursive: true, force: true })
})

test('会话 id 校验：只有 `[A-Za-z0-9._-]` 的普通片段能当路径用', () => {
  assert.equal(isValidSessionId(doomed), true)
  assert.equal(isValidSessionId(alive), true)
  assert.equal(isValidSessionId('a.b_c-d'), true)

  assert.equal(isValidSessionId(''), false)
  assert.equal(isValidSessionId('.'), false)
  assert.equal(isValidSessionId('..'), false)
  assert.equal(isValidSessionId('../evil'), false)
  assert.equal(isValidSessionId('a/b'), false)
  assert.equal(isValidSessionId('a\\b'), false)
  assert.equal(isValidSessionId('a b'), false)
  assert.equal(isValidSessionId('会话'), false)
  assert.equal(isValidSessionId(undefined), false)
  assert.equal(isValidSessionId(42), false)
  assert.equal(isValidSessionId('x'.repeat(201)), false)
})

test('溢出目录名：`session-` + sha256 前 12 位（与 dsh-spill-local 同算法）', () => {
  const name = spillDirName(doomed)
  assert.match(name, /^session-[0-9a-f]{12}$/)
  assert.equal(name, spillDirName(doomed), '同一个 id 必须算出同一个名字')
  assert.notEqual(name, spillDirName(alive))
})

test('落点算全：正文（每个工作区目录各一份）/ 回滚快照 / 投影缓存 / 溢出目录', async () => {
  const { targets, escaped } = await sessionTargets(root, doomed, { tmpRoot: tmp })
  assert.deepEqual(escaped, [], '正常 id 不该有越界目标')
  const kinds = targets.map((target) => target.kind).sort()
  assert.deepEqual(kinds, ['projcache', 'rewind', 'session', 'session', 'spill'])
  assert.ok(
    targets.some((target) => target.path === join(root, 'sessions', 'proj-A', doomed)),
    '必须包含 proj-A 下的正文目录',
  )
  assert.ok(
    targets.some((target) => target.path === join(root, 'sessions', 'proj-B', doomed)),
    '必须包含 proj-B 下的正文目录——只猜一个 cwd 会漏删',
  )
})

test('删除：四类落点全清掉，别的会话与共享文件原封不动', async () => {
  const result = await deleteSessionFiles(root, doomed, { tmpRoot: tmp })
  assert.equal(result.id, doomed)
  assert.deepEqual(result.remaining, [], '复核必须没有残留（有残留说明路径算漏了）')
  assert.deepEqual(result.escaped, [])
  assert.deepEqual(result.removed.map((target) => target.kind).sort(), ['projcache', 'rewind', 'session', 'session', 'spill'])

  // 该没的都没了。
  assert.equal(existsSync(join(root, 'sessions', 'proj-A', doomed)), false)
  assert.equal(existsSync(join(root, 'sessions', 'proj-B', doomed)), false)
  assert.equal(existsSync(join(root, 'rewind-snapshots', doomed)), false)
  assert.equal(existsSync(join(root, 'storages', 'session_projcache', 'sessions', `${doomed}.json`)), false)
  assert.equal(existsSync(join(tmp, 'dsh-spill-local', spillDirName(doomed))), false)

  // 不该没的一个都不能少。
  assert.equal(existsSync(join(root, 'sessions', 'proj-A', alive, 'session.v4.jsonl.zstd')), true)
  assert.equal(existsSync(join(root, 'sessions', 'proj-A', `${doomed}-suffix`, 'session.v4.jsonl.zstd')), true, '前缀相同的目录不是它')
  assert.equal(existsSync(join(root, 'storages', 'community_market', 'global.json')), true, '共享存储不能碰')
  assert.equal(existsSync(join(tmp, 'dsh-spill-local', spillDirName(alive))), true)
  assert.equal(existsSync(join(tmp, 'not-a-spill', spillDirName(doomed))), true, '不是 dsh-spill- 开头的目录不看')
})

test('删除不存在的会话：不报错、不删任何东西', async () => {
  const result = await deleteSessionFiles(root, 'session-99999999-0000-0000-0000-000000000000', { tmpRoot: tmp })
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.remaining, [])
  assert.deepEqual(result.escaped, [])
})

test('非法 id：一个目标都不给，只回报越界', async () => {
  const { targets, escaped } = await sessionTargets(root, '../evil', { tmpRoot: tmp })
  assert.deepEqual(targets, [], '非法 id 不允许产生任何删除目标')
  assert.equal(escaped.length, 1)
  assert.equal(escaped[0].kind, 'id')

  const result = await deleteSessionFiles(root, '../evil', { tmpRoot: tmp })
  assert.deepEqual(result.removed, [])
  assert.equal(existsSync(join(root, 'sessions', 'proj-A', alive)), true, '越界尝试不能伤到别的会话')
})

test('批量：去重、逐条复核，非法 id 只回报越界而不删东西', async () => {
  // 再铺一份被删的会话（上一组用例已经把 doomed 删干净了）。
  await mkdir(join(root, 'sessions', 'proj-C', alive), { recursive: true })
  await put(join(root, 'sessions', 'proj-C', alive, 'session.v4.jsonl.zstd'), 'C')
  const batch = await deleteSessionFilesBatch(root, [alive, alive, '../evil'], { tmpRoot: tmp })
  assert.equal(batch.results.length, 2, '去重后两条（alive 与越界的 ../evil）')
  assert.deepEqual(batch.remaining, [])
  assert.deepEqual(batch.escaped.map((target) => target.kind), ['id'], '非法 id 的目标为零，只作为越界回报')
  const two = batch.results.find((item) => item.id === alive)
  // 两份正文（proj-A 的老目录 + proj-C 的新目录）与它的溢出目录，一处不少。
  assert.deepEqual(two.removed.map((target) => target.kind).sort(), ['session', 'session', 'spill'])
  assert.equal(existsSync(join(root, 'sessions', 'proj-A', alive)), false)
  assert.equal(existsSync(join(root, 'sessions', 'proj-C', alive)), false)
  assert.equal(existsSync(join(tmp, 'dsh-spill-local', spillDirName(alive))), false)
  assert.equal(existsSync(join(root, 'sessions', 'proj-A', `${doomed}-suffix`)), true, '越界的那条不能顺手动到别的东西')
})
