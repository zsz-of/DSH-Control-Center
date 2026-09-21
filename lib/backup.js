/**
 * 备份与恢复：把「插件 + 规则 + 技能 + MCP + 记忆 + 设置」打成一个可单独勾选的 zip 快照。
 *
 * 设计要点：
 * - **分区可选**：每个分区独立收集/恢复，用户想只备份规则就只备份规则；
 * - **产物是普通 zip**：含 `manifest.json`（格式版本、来源、分区统计）与 `payload/<分区>/…`，
 *   用资源管理器就能打开，不依赖本插件也能看懂内容；
 * - **恢复前先给计划**：`planRestore` 只读地算「会新建哪些、会覆盖哪些」，UI 先展示再执行；
 * - **解压包是不可信输入**：每条路径都过 {@link isSafeEntryName}，越界条目直接拒收。
 *
 * 「已安装插件」分区存的是**清单**（profile 的 `package.json` / `cordis.patch.yml` / `cordis.yml` /
 * `pnpm-lock.yaml`），不是 `node_modules` 里的几十万个文件：插件本体可以从 npm 重新装，
 * 而版本与依赖声明才是不可再生的部分。
 *
 * @module dsh-control-center/backup
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import {
  BACKUP_DIR,
  DATA_ROOT,
  MAX_BACKUP_BYTES,
  MCP_FILE,
  MEMORY_DIR,
  RULES_DIR,
  SKILLS_DIR,
  harnessRoot,
  profileDir,
  resolveProfileName,
} from './paths.js'
import { createZip, isSafeEntryName, readZip } from './zip.js'

/** 备份格式标识（恢复时校验，避免把别的 zip 当备份导入）。 */
export const BACKUP_FORMAT = 'dsh-control-center-backup'
/** 备份格式版本。 */
export const BACKUP_VERSION = 1

/** `$DSH_HOME` 下不作为「插件数据」收集的目录（平台自身的大件或工作产物）。 */
const HARNESS_DENY = new Set([
  'profiles',
  'sessions',
  'attachments',
  'storages',
  'rewind-snapshots',
  '.desktop-bin',
  'node_modules',
  'agent-sync-logs',
])

/** 单文件收集上限：超过的文件跳过并记录原因（备份不该被一个日志文件撑爆）。 */
const MAX_FILE_BYTES = 32 * 1024 * 1024

/**
 * 分区描述。
 *
 * 每个 root 的形状统一为 `{ abs, to, base }`：`to` 是**相对 `base`** 的路径，
 * 导出时写进 `payload/<分区>/<to>`，恢复时再解回 `join(base, to)`。
 * 这样目录型（`to` 是目录名）与文件型（`to` 是文件名）两种情况共用一套映射。
 *
 * @returns 分区数组。
 */
export async function listSections() {
  const harness = harnessRoot()
  const profile = resolveProfileName()
  const profilePath = profileDir(profile)
  const sections = [
    {
      id: 'rules',
      label: '规则',
      hint: 'AI 的行为约束',
      roots: [{ abs: RULES_DIR, to: 'rules', base: DATA_ROOT }],
    },
    {
      id: 'skills',
      label: '技能',
      hint: 'SKILL.md 技能包与平铺技能文件',
      roots: [{ abs: SKILLS_DIR, to: 'skills', base: DATA_ROOT }],
    },
    {
      id: 'memory',
      label: '记忆',
      hint: '跨会话保留的用户偏好与项目经验',
      roots: [{ abs: MEMORY_DIR, to: 'memory', base: DATA_ROOT }],
    },
    {
      id: 'mcp',
      label: 'MCP 服务器',
      hint: '服务器注册信息',
      sensitive: true,
      roots: [{ abs: MCP_FILE, to: 'mcp.json', base: DATA_ROOT }],
    },
    {
      id: 'plugins',
      label: '已安装插件清单',
      hint: 'profile 的依赖与挂载名单',
      roots: [
        { abs: join(profilePath, 'package.json'), to: 'package.json', base: profilePath },
        { abs: join(profilePath, 'cordis.patch.yml'), to: 'cordis.patch.yml', base: profilePath },
        { abs: join(profilePath, 'cordis.yml'), to: 'cordis.yml', base: profilePath },
        { abs: join(profilePath, 'pnpm-lock.yaml'), to: 'pnpm-lock.yaml', base: profilePath },
      ],
    },
    {
      id: 'settings',
      label: '平台设置',
      hint: '默认模型、界面、权限预设',
      roots: [{ abs: join(harness, 'settings.yaml'), to: 'settings.yaml', base: harness }],
    },
    {
      id: 'instructions',
      label: '全局指令',
      hint: '$DSH_HOME/AGENTS.md',
      roots: [{ abs: join(harness, 'AGENTS.md'), to: 'AGENTS.md', base: harness }],
    },
    {
      id: 'pluginData',
      label: '插件数据目录',
      hint: '各插件在 $DSH_HOME 下自建的数据目录',
      roots: (await listPluginDataRoots(harness)).map((name) => ({
        abs: join(harness, name),
        to: name,
        base: harness,
      })),
    },
    {
      id: 'credentials',
      label: '凭据',
      hint: 'API Key 等，含明文密钥',
      sensitive: true,
      roots: [{ abs: join(harness, '.credentials.yaml'), to: '.credentials.yaml', base: harness }],
    },
  ]
  return sections.filter((section) => section.roots.length > 0)
}

/** 收集 `$DSH_HOME` 下属于「插件数据」的目录名。 */
async function listPluginDataRoots(harness) {
  try {
    const entries = await readdir(harness, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !HARNESS_DENY.has(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** 递归收集一个目录下的全部文件（相对路径 + 绝对路径）。 */
async function walk(abs, skip) {
  const found = []
  let entries
  try {
    entries = await readdir(abs, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return found
    throw error
  }
  for (const entry of entries) {
    const child = join(abs, entry.name)
    if (entry.isDirectory()) {
      if (skip(child)) continue
      found.push(...(await walk(child, skip)))
      continue
    }
    if (entry.isFile()) found.push(child)
  }
  return found
}

/**
 * 按分区收集要打进 zip 的条目。
 *
 * @param sections - 分区数组（{@link listSections} 的子集）。
 * @returns `{ files, stats }`；`files` 是 zip 条目数组，`stats` 是每分区的文件数与字节数。
 */
export async function collectEntries(sections) {
  const files = []
  const stats = []
  let total = 0

  for (const section of sections) {
    const skipped = []
    let bytes = 0
    let count = 0
    for (const root of section.roots) {
      const info = await statPath(root.abs)
      if (info === undefined) continue
      const candidates = info.isDirectory() ? await walk(root.abs, () => false) : [root.abs]
      for (const file of candidates) {
        const size = await sizeOf(file)
        if (size === undefined) continue
        // 目录型 root 取相对子路径；文件型 root 本身就是那一个文件，没有「内部路径」。
        const inside = info.isDirectory() ? relative(root.abs, file).replace(/\\/g, '/') : ''
        const rel = inside === '' ? root.to : `${root.to}/${inside}`
        if (size > MAX_FILE_BYTES) {
          skipped.push(`${rel}（${(size / 1024 / 1024).toFixed(1)} MB 超过单文件上限）`)
          continue
        }
        if (total + size > MAX_BACKUP_BYTES) {
          skipped.push(`${rel}（已达单次备份总量上限）`)
          continue
        }
        if (!isSafeEntryName(rel)) {
          skipped.push(`${rel}（路径不合法）`)
          continue
        }
        files.push({
          name: `payload/${section.id}/${rel}`,
          data: await readFile(file),
          mtime: (await statPath(file))?.mtime,
        })
        bytes += size
        count += 1
        total += size
      }
    }
    stats.push({ id: section.id, label: section.label, files: count, bytes, skipped })
  }
  return { files, stats }
}

/** 取 stat，文件不存在返回 `undefined`。 */
async function statPath(path) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/** 取文件大小，失败返回 `undefined`。 */
async function sizeOf(path) {
  const info = await statPath(path)
  return info?.isFile() ? info.size : undefined
}

/**
 * 打包备份。
 *
 * @param sectionIds - 要包含的分区 id（空数组视为全部）。
 * @param options - `{ label, now }`。
 * @returns `{ file, bytes, manifest, stats }`（`file` 是产物绝对路径）。
 */
export async function createBackup(sectionIds, options = {}) {
  const all = await listSections()
  // 备份**必须显式勾选**：不接受「空数组 = 备份全部」这种默认——
  // 「凭据」分区默认就在里面，任何一次手滑都不该把密钥打进去。
  if (!Array.isArray(sectionIds) || sectionIds.length === 0) throw new Error('没有选中任何要备份的分区')
  const wanted = new Set(sectionIds)
  // 先挑出不认识的分区 id：写错分区名必须直接报错，而不是被「空选择」掩盖过去。
  const unknown = [...wanted].filter((id) => !all.some((section) => section.id === id))
  if (unknown.length > 0) throw new Error(`未知的备份分区：${unknown.join('、')}`)
  const selected = all.filter((section) => wanted.has(section.id))

  const now = options.now instanceof Date ? options.now : new Date()
  const { files, stats } = await collectEntries(selected)
  if (files.length === 0) throw new Error('选中的分区里没有任何文件可备份')

  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    label: typeof options.label === 'string' ? options.label.trim() : '',
    source: { harness: harnessRoot(), profile: resolveProfileName(), dataRoot: DATA_ROOT },
    sections: stats,
  }
  const zip = createZip(
    [
      { name: 'manifest.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), mtime: now },
      ...files,
    ],
    { mtime: now },
  )
  if (zip.length > MAX_BACKUP_BYTES) throw new Error('备份超过总量上限，请减少勾选的分区')

  await mkdir(BACKUP_DIR, { recursive: true })
  // 时间戳精确到毫秒：秒级精度下同一秒连点两次会撞名，而「保留最近 N 份」的清理
  // 依赖「文件名顺序 = 时间顺序」，撞名和同秒并列都会让清理变得不可预测。
  const stamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 17)
  const suffix = manifest.label === '' ? '' : `-${manifest.label.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 24)}`
  // 同一毫秒内仍然可能撞名：撞了就加序号，绝不覆盖已有产物。
  let file = join(BACKUP_DIR, `dsh-backup-${stamp}${suffix}.zip`)
  for (let index = 2; existsSync(file) && index < 100; index += 1) {
    file = join(BACKUP_DIR, `dsh-backup-${stamp}${suffix}-${index}.zip`)
  }
  await writeFile(file, zip)
  await pruneBackups(options.retention)
  return { file, bytes: zip.length, manifest, stats }
}

/**
 * 清理历史产物，只保留最近 `retention` 个。
 *
 * @param retention - 保留数量；0 或非数字表示不清理。
 * @returns 被删除的文件名数组。
 */
export async function pruneBackups(retention) {
  if (!Number.isInteger(retention) || retention <= 0) return []
  const items = await listBackups()
  const extra = items.slice(retention)
  for (const item of extra) await rm(item.path, { force: true })
  return extra.map((item) => item.file)
}

/**
 * 列出备份产物。
 *
 * @returns `[{ file, path, bytes, createdAt }]`（新的在前）。
 */
export async function listBackups() {
  let entries
  try {
    entries = await readdir(BACKUP_DIR, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const items = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.zip')) continue
    const path = join(BACKUP_DIR, entry.name)
    const info = await statPath(path)
    if (info === undefined) continue
    items.push({ file: entry.name, path, bytes: info.size, createdAt: info.mtime.toISOString() })
  }
  // 时间相同（同毫秒写入）时用文件名兜底排序——文件名里就带着毫秒时间戳与序号，
  // 保证「保留最近 N 份」永远有确定的答案。
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.file.localeCompare(a.file))
}

/** 删除一个备份产物（只接受备份目录里的普通文件名，路径一律拒收）。 */
export async function deleteBackup(file) {
  const name = String(file ?? '')
  if (name === '' || name !== basename(name) || !name.toLowerCase().endsWith('.zip')) {
    throw new Error('只允许删除备份目录里的 .zip 产物')
  }
  const target = join(BACKUP_DIR, name)
  if (!existsSync(target)) throw new Error(`备份 ${name} 不存在`)
  await rm(target, { force: true })
}

/**
 * 解析一个备份包，返回清单与分区统计（不做任何写入）。
 *
 * @param buffer - zip 字节。
 * @returns `{ manifest, sections, entries }`。
 */
export function analyzeBackup(buffer) {
  const entries = readZip(buffer)
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json')
  if (manifestEntry === undefined) throw new Error('这不是本插件导出的备份（缺少 manifest.json）')
  let manifest
  try {
    manifest = JSON.parse(manifestEntry.data.toString('utf8'))
  } catch (error) {
    throw new Error(`备份清单无法解析：${error?.message ?? String(error)}`)
  }
  if (manifest?.format !== BACKUP_FORMAT) throw new Error('备份格式不匹配（format 字段不是本插件的备份）')
  if (manifest.version > BACKUP_VERSION) throw new Error(`备份版本 ${manifest.version} 高于当前插件支持的 ${BACKUP_VERSION}`)

  const payload = entries.filter(
    (entry) =>
      !entry.directory &&
      entry.name.startsWith('payload/') &&
      // 越界条目在这里就被剔掉：后面所有环节（统计、计划、恢复）都只看这份干净的清单。
      isSafeEntryName(entry.name.slice('payload/'.length)),
  )
  const byId = new Map()
  for (const entry of payload) {
    const rest = entry.name.slice('payload/'.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) continue
    const id = rest.slice(0, slash)
    const bucket = byId.get(id) ?? { files: 0, bytes: 0 }
    bucket.files += 1
    bucket.bytes += entry.data.length
    byId.set(id, bucket)
  }
  const known = manifest.sections ?? []
  const sections = [...byId.entries()].map(([id, bucket]) => {
    const declared = known.find((section) => section.id === id)
    return { id, label: declared?.label ?? id, files: bucket.files, bytes: bucket.bytes }
  })
  return { manifest, sections, entries: payload }
}

/**
 * 计算恢复计划（只读）。
 *
 * @param analysis - {@link analyzeBackup} 的结果。
 * @param sectionIds - 要恢复的分区 id（空数组视为全部）。
 * @returns `{ items, counts }`，`items` 每项含 `target` 与 `action`。
 */
export async function planRestore(analysis, sectionIds) {
  const all = await listSections()
  const rootsById = new Map(all.map((section) => [section.id, section.roots]))
  const wanted = new Set(Array.isArray(sectionIds) && sectionIds.length > 0 ? sectionIds : analysis.sections.map((s) => s.id))
  const items = []
  for (const entry of analysis.entries) {
    const rest = entry.name.slice('payload/'.length)
    const slash = rest.indexOf('/')
    if (slash <= 0) continue
    const id = rest.slice(0, slash)
    if (!wanted.has(id)) continue
    const roots = rootsById.get(id)
    if (roots === undefined) continue
    const inside = rest.slice(slash + 1)
    const root = roots.find((candidate) => inside === candidate.to || inside.startsWith(`${candidate.to}/`))
    if (root === undefined) continue
    const tail = inside === root.to ? '' : inside.slice(root.to.length + 1)
    const target = tail === '' ? root.abs : join(root.abs, tail)
    if (!isSafeEntryName(relative(root.base, target).replace(/\\/g, '/'))) continue
    items.push({
      section: id,
      name: inside,
      target,
      action: existsSync(target) ? 'overwrite' : 'create',
      bytes: entry.data.length,
      data: entry.data,
    })
  }
  const counts = { create: 0, overwrite: 0, files: items.length, bytes: 0 }
  for (const item of items) {
    counts[item.action] += 1
    counts.bytes += item.bytes
  }
  return { items, counts }
}

/**
 * 执行恢复计划。
 *
 * 逐条写入并记录失败：一条写不进去（权限、占用）不应该让整包回滚——用户需要知道
 * 「哪几个文件没写成功」，而不是拿到一个「全失败」。
 *
 * @param plan - {@link planRestore} 的结果。
 * @param options - `{ sectionIds }` 之外的执行开关（当前保留给未来使用）。
 * @returns `{ written, failed }`。
 */
export async function applyRestore(plan, options = {}) {
  const written = []
  const failed = []
  const dryRun = options.dryRun === true
  for (const item of plan.items) {
    try {
      if (dryRun) {
        written.push(item.target)
        continue
      }
      await mkdir(dirname(item.target), { recursive: true })
      await writeFile(item.target, item.data)
      written.push(item.target)
    } catch (error) {
      failed.push({ target: item.target, error: error?.message ?? String(error) })
    }
  }
  return { written, failed }
}
