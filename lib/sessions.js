/**
 * 会话的**彻底删除**：把一次会话在磁盘上的全部痕迹删掉。
 *
 * **平台没有删除会话的 API**：`dsh-session` 的存储服务只有 `create` / `enter` / `announce` /
 * `get` / `list`（外加 `fork` / `flush`），jsonl 持久化库也没有任何 `remove` / `delete` / `purge`。
 * 列表里的行更不是「删掉就完了」——所以这里只做一件事：**按会话 id 精确算出它在磁盘上的所有
 * 落点并删除**，再由浏览器侧调 `ctx.sessions.handleSessionRemoved(id)` 把行从列表里摘掉。
 *
 * 一条 id 在磁盘上的落点（全部按 id 命名，因此不需要工作目录就能找到）：
 *
 * 1. `<root>/sessions/<projectKey(cwd)>/<id>/` —— 会话正文（`session.v4.jsonl.zstd`）；
 *    目录名就是 id 本身（见 jsonl 持久化的 `sessionDir`），所以这里**遍历所有工作区目录**而不是
 *    猜 cwd：id 是唯一键，猜 cwd 猜错就会漏删。
 * 2. `<root>/rewind-snapshots/<id>/` —— 回滚快照。
 * 3. `<root>/storages/session_projcache/sessions/<id>.json` —— 投影缓存。
 * 4. `<tmp>/dsh-spill-XXX/session-<sha256(id) 前 12 位>/` —— 工具输出溢出目录（每进程一个临时根，
 *    启动时会清扫；**尽力而为**，扫得到就删）。
 *
 * 不碰的东西（都是共享的，删了会伤到别的会话）：`~/.dsh/attachments`（内容寻址）、
 * `~/.dsh/cache/attachments`、`~/.dsh/logs`、`~/.dsh/recovery`（崩溃恢复包，名字里没有会话 id）。
 * 搜索索引（sqlite）不需要我们删：它按「磁盘上还剩哪些会话」对账
 * （`dsh-session-query-sqlite` 的 `persistentDeletes`），文件没了它自己会把行清掉。
 *
 * @module dsh-control-center/sessions
 */

import { createHash } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

/**
 * 会话 id 是否可以直接当路径片段用。
 *
 * 会话 id 由平台分配（`session-<uuid>` 或子代理会话的裸 uuid），只含 `[A-Za-z0-9._-]`；
 * 除此之外一律拒绝——**这是防目录穿越的唯一闸门**，即使调用方来自 HTTP 也一样。
 *
 * @param id - 待校验的会话 id。
 * @returns 合法返回 true。
 */
export function isValidSessionId(id) {
  if (typeof id !== 'string') return false
  if (id.length === 0 || id.length > 200) return false
  if (id === '.' || id === '..') return false
  return /^[A-Za-z0-9._-]+$/.test(id)
}

/** 溢出目录名：`session-` + sha256(id) 的前 12 位十六进制（`dsh-spill-local` 的算法）。 */
export function spillDirName(id) {
  return `session-${createHash('sha256').update(id).digest('hex').slice(0, 12)}`
}

/** 目标必须落在给定根之内（防拼出根外的路径）。 */
function contained(path, root) {
  const base = resolve(root)
  const target = resolve(path)
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

/** 只保留根之内的目标；越界的丢掉并回报（正常永远为空）。 */
function push(list, escaped, kind, path, root) {
  if (!contained(path, root)) {
    escaped.push({ kind, path })
    return
  }
  list.push({ kind, path })
}

/** `<root>/sessions` 下的全部工作区目录（不存在时返回空数组）。 */
async function projectDirs(root) {
  const sessionsRoot = join(root, 'sessions')
  try {
    const entries = await readdir(sessionsRoot, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(sessionsRoot, entry.name))
  } catch {
    return []
  }
}

/** `<tmp>` 下的全部溢出根（`dsh-spill-*`）。 */
async function spillRoots(tmpRoot) {
  try {
    const entries = await readdir(tmpRoot, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('dsh-spill-')).map((entry) => join(tmpRoot, entry.name))
  } catch {
    return []
  }
}

/**
 * 算出一次会话在磁盘上的所有落点（不判断存在性）。
 *
 * @param root - DSH 数据根（`~/.dsh`）。
 * @param id - 会话 id。
 * @param options - `tmpRoot` 覆盖临时根（默认 `os.tmpdir()`，测试用）。
 * @returns `{ targets, escaped }`：目标列表与越界目标（正常情况下越界为空）。
 */
export async function sessionTargets(root, id, options = {}) {
  const targets = []
  const escaped = []
  const tmpRoot = options.tmpRoot ?? tmpdir()
  if (!isValidSessionId(id)) return { targets, escaped: [{ kind: 'id', path: String(id) }] }

  for (const project of await projectDirs(root)) push(targets, escaped, 'session', join(project, id), root)
  push(targets, escaped, 'rewind', join(root, 'rewind-snapshots', id), root)
  push(targets, escaped, 'projcache', join(root, 'storages', 'session_projcache', 'sessions', `${id}.json`), root)
  for (const spill of await spillRoots(tmpRoot)) push(targets, escaped, 'spill', join(spill, spillDirName(id)), tmpRoot)
  return { targets, escaped }
}

/** 目标是否存在。 */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 删除一次会话的全部落点，并**复核**没有残留。
 *
 * @param root - DSH 数据根（`~/.dsh`）。
 * @param id - 会话 id。
 * @param options - `tmpRoot`（测试用）。
 * @returns `{ id, removed, remaining, escaped }`：删掉的目标、复核仍存在的目标、越界目标。
 */
export async function deleteSessionFiles(root, id, options = {}) {
  const { targets, escaped } = await sessionTargets(root, id, options)
  const removed = []
  for (const target of targets) {
    if (!(await exists(target.path))) continue
    // force + recursive：目录或文件都能删，且并发下已消失不算错。
    await rm(target.path, { recursive: true, force: true })
    removed.push(target)
  }
  // 复核：删完再算一遍，仍然存在的就是残留（正常情况下为空）。
  // 越界列表用第一遍的结果：它只取决于 id 与根，与删没删无关（复查再收一遍会重复计同一件）。
  const after = await sessionTargets(root, id, options)
  const remaining = []
  for (const target of after.targets) if (await exists(target.path)) remaining.push(target)
  return { id, removed, remaining, escaped }
}

/**
 * 批量删除（去重、逐条复核）。
 *
 * @param root - DSH 数据根（`~/.dsh`）。
 * @param ids - 会话 id 数组。
 * @param options - `tmpRoot`（测试用）。
 * @returns `{ removed, remaining, escaped, results }`。
 */
export async function deleteSessionFilesBatch(root, ids, options = {}) {
  const unique = [...new Set(Array.isArray(ids) ? ids : [])]
  const results = []
  for (const id of unique) results.push(await deleteSessionFiles(root, id, options))
  return {
    removed: results.flatMap((item) => item.removed),
    remaining: results.flatMap((item) => item.remaining),
    escaped: results.flatMap((item) => item.escaped),
    results,
  }
}
