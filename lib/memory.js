/**
 * 长期记忆：模型跨会话要记住的偏好与项目约定。
 *
 * 形态与规则刻意保持一致（一条记忆一个 Markdown 文件 + frontmatter），但**用途不同**：
 * - 规则是「你要求 AI 怎么做」的**指令**，注入位置是行为约束；
 * - 记忆是「AI 应该知道的事实」——用户偏好、项目背景、踩过的坑，注入位置是背景知识。
 *
 * 作用域（`scope`）决定注入范围：
 * - `global`：任何会话都注入；
 * - `workspace`：只在 `cwd` 与该记忆登记的目录相同时注入（项目私有的经验不该污染别的项目）。
 *
 * 与规则一样，超预算的条目**降级为索引行**（带绝对路径）而不是静默消失，保证可达。
 *
 * 本模块不 import cordis，可用 `node --test` 直接验证。
 *
 * @module dsh-control-center/memory
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { byteLength, parseDocument, serializeDocument, slugify, truncateBytes } from './profile.js'
import { MEMORY_DIR } from './paths.js'

/** 记忆的作用域取值。 */
export const MEMORY_SCOPES = ['global', 'workspace']

const HEAD = '<system-reminder>\n'
const TAIL = '\n</system-reminder>'
const INLINE_HEAD =
  '\n## 长期记忆（正文）\n以下事实跨会话保留，用于理解用户偏好与项目背景；与当前指令冲突时以当前指令为准。\n'
const INDEX_HEAD =
  '\n## 其余记忆（本轮未展开正文）\n需要时用 read 工具按下列**绝对路径**读取，不要凭标题猜测内容。\n'
const INTRO = '以下是从以往会话中沉淀的长期记忆。'

/** 转义可能提前闭合框架的字面标签。 */
function escapeReminder(text) {
  return text.replace(/<\/system-reminder>/gi, '<\\/system-reminder>')
}

/** 把 tag 文本拆成数组（逗号 / 顿号 / 空格分隔）。 */
function splitTags(value) {
  if (typeof value !== 'string') return []
  return value
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/**
 * 解析一条记忆文件。
 *
 * @param file - 文件名（含 `.md`）。
 * @param text - 文件全文。
 * @param path - 绝对路径。
 * @returns 记忆对象。
 */
export function parseMemory(file, text, path) {
  const { data, extra, body } = parseDocument(text)
  const scope = MEMORY_SCOPES.includes(data.scope) ? data.scope : 'global'
  const trimmed = body.replace(/^\s*\n/, '').replace(/\s+$/, '')
  return {
    file,
    path,
    name:
      typeof data.name === 'string' && data.name.trim().length > 0
        ? data.name.trim()
        : file.replace(/\.md$/i, ''),
    description: typeof data.description === 'string' ? data.description.trim() : '',
    scope,
    workspace: typeof data.workspace === 'string' ? data.workspace.trim() : '',
    tags: splitTags(data.tags),
    source: data.source === 'auto' ? 'auto' : 'manual',
    pinned: data.pinned === true,
    enabled: data.enabled !== false,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    body: trimmed,
    extra,
    bytes: byteLength(trimmed),
  }
}

/**
 * 把记忆对象写回文件文本。
 *
 * @param memory - 记忆对象。
 * @returns 文件全文。
 */
export function serializeMemory(memory) {
  return serializeDocument(
    {
      name: memory.name,
      description: memory.description.length > 0 ? memory.description : undefined,
      scope: memory.scope,
      workspace: memory.scope === 'workspace' && memory.workspace.length > 0 ? memory.workspace : undefined,
      tags: memory.tags.length > 0 ? memory.tags.join(', ') : undefined,
      source: memory.source === 'auto' ? 'auto' : undefined,
      pinned: memory.pinned === true ? true : undefined,
      enabled: memory.enabled === false ? false : undefined,
      createdAt: memory.createdAt.length > 0 ? memory.createdAt : undefined,
      updatedAt: memory.updatedAt.length > 0 ? memory.updatedAt : undefined,
    },
    memory.body,
    memory.extra ?? [],
  )
}

/** 读目录，不存在时返回空数组。 */
async function listFiles() {
  try {
    const entries = await readdir(MEMORY_DIR, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/**
 * 列出全部记忆。
 *
 * 单条解析失败不影响其他条目：坏文件以 `error` 字段返回，UI 能指名道姓地报出来。
 *
 * @returns 记忆数组（置顶优先，其次按更新时间倒序）。
 */
export async function listMemories() {
  const files = (await listFiles()).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  const items = []
  for (const file of files) {
    const path = join(MEMORY_DIR, file)
    try {
      items.push(parseMemory(file, await readFile(path, 'utf8'), path))
    } catch (error) {
      items.push({
        file,
        path,
        name: file.replace(/\.md$/i, ''),
        description: '',
        scope: 'global',
        workspace: '',
        tags: [],
        source: 'manual',
        pinned: false,
        enabled: false,
        createdAt: '',
        updatedAt: '',
        body: '',
        extra: [],
        bytes: 0,
        error: error?.message ?? String(error),
      })
    }
  }
  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.updatedAt || '').localeCompare(a.updatedAt || '')
  })
}

/** 读取单条记忆；不存在时返回 `undefined`。 */
export async function readMemory(file) {
  try {
    const path = join(MEMORY_DIR, file)
    return parseMemory(file, await readFile(path, 'utf8'), path)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

/** 为一条新记忆挑一个不冲突的文件名。 */
function availableFile(name, existing) {
  const base = slugify(name)
  if (!existing.has(`${base}.md`)) return `${base}.md`
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}.md`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error(`无法为「${name}」生成不冲突的文件名`)
}

/**
 * 新建或覆盖一条记忆。
 *
 * @param input - `{ file?, name, description, body, scope, workspace?, tags?, pinned?, enabled? }`。
 * @param now - 当前时间（可注入，便于单测）。
 * @returns 落盘后的记忆对象。
 */
export async function writeMemory(input, now = new Date().toISOString()) {
  const name = String(input.name ?? '').trim()
  if (name.length === 0) throw new Error('记忆标题不能为空')
  const body = String(input.body ?? '').trim()
  if (body.length === 0) throw new Error('记忆内容不能为空')
  const scope = MEMORY_SCOPES.includes(input.scope) ? input.scope : 'global'
  const workspace = String(input.workspace ?? '').trim()
  if (scope === 'workspace' && workspace.length === 0) {
    throw new Error('作用域选「项目」时必须填写项目目录（绝对路径）')
  }

  await mkdir(MEMORY_DIR, { recursive: true })
  const existingFiles = new Set(await listFiles())
  const file =
    typeof input.file === 'string' && input.file.length > 0
      ? (() => {
          if (!existingFiles.has(input.file)) throw new Error(`记忆 ${input.file} 不存在`)
          return input.file
        })()
      : availableFile(name, existingFiles)
  const current = await readMemory(file)
  const memory = {
    file,
    path: join(MEMORY_DIR, file),
    name,
    description: String(input.description ?? '').trim(),
    scope,
    workspace: scope === 'workspace' ? workspace : '',
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag).trim()).filter((tag) => tag !== '') : splitTags(input.tags),
    source: input.source === 'auto' ? 'auto' : 'manual',
    pinned: input.pinned === true,
    enabled: input.enabled !== false,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    body,
    extra: current?.extra ?? [],
  }
  await writeFile(memory.path, serializeMemory(memory), 'utf8')
  return parseMemory(file, serializeMemory(memory), memory.path)
}

/** 删除一条记忆（物理删除）。 */
export async function deleteMemory(file) {
  const path = join(MEMORY_DIR, file)
  try {
    await rm(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`记忆 ${file} 不存在`)
    throw error
  }
}

/** 把路径规范成可比较的形式（Windows 大小写不敏感、分隔符统一）。 */
function normalizePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\//g, '\\')
    .toLowerCase()
}

/**
 * 一条记忆是否适用于当前工作目录。
 *
 * @param memory - 记忆对象。
 * @param cwd - 会话工作目录（可能为空——此时只注入 global 记忆）。
 * @returns 是否适用。
 */
export function appliesTo(memory, cwd) {
  if (memory.scope !== 'workspace') return true
  if (typeof cwd !== 'string' || cwd.trim() === '') return false
  return normalizePath(memory.workspace) === normalizePath(cwd)
}

/** 一条索引行：标题、绝对路径、描述、作用域。 */
function indexLine(memory, reason) {
  const description = memory.description.length > 0 ? ` — ${memory.description}` : ''
  return `- ${memory.name}（\`${memory.path}\`）${description} [${reason}]`
}

/** 正文块。 */
function blockOf(memory) {
  const meta = [
    memory.scope === 'workspace' ? `项目：${memory.workspace}` : '作用域：全局',
    memory.tags.length > 0 ? `标签：${memory.tags.join('、')}` : '',
    memory.pinned ? '置顶' : '',
  ].filter((item) => item !== '')
  const description = memory.description.length > 0 ? `\n${memory.description}` : ''
  return `\n### ${memory.name}${description}\n（${meta.join(' | ')}）\n${escapeReminder(memory.body)}\n`
}

/**
 * 渲染记忆注入文本。
 *
 * 降级阶梯与规则一致（测量驱动，先量再放），关键性质是**任何被降级的记忆都留有索引行**：
 * 正文让位时条目仍以「标题 + 描述 + 绝对路径」出现在索引里，模型需要时能自己读回来；
 * 绝不会出现「既没正文、也没路径」的静默消失。
 *
 * @param memories - 全部记忆（本函数自行过滤启用与作用域）。
 * @param options - `{ cwd, maxBytes }`。
 * @returns 注入文本，或 `undefined`（没有适用的启用记忆时）。
 */
export function renderMemoryInjection(memories, options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 8192
  const active = memories
    .filter((memory) => memory.enabled !== false && memory.error === undefined)
    .filter((memory) => appliesTo(memory, options.cwd))
  if (active.length === 0) return undefined
  const fixedHead = `${HEAD}${INTRO}\n`

  /**
   * 组装一份候选文本。
   *
   * @param inlinedCount - 前 N 条注入正文，其余进索引。
   * @param listed - 进索引的记忆（通常是 inlinedCount 之后的那批，裁剪时会更少）。
   * @param omittedNote - 索引被裁剪时的说明行。
   */
  const assemble = (inlinedCount, listed, omittedNote) =>
    `${fixedHead}${active
      .slice(0, inlinedCount)
      .map(blockOf)
      .join('')}${
      listed.length === 0 && omittedNote.length === 0
        ? ''
        : `${INDEX_HEAD}${listed
            .map((memory) => indexLine(memory, memory.scope === 'workspace' ? '项目' : '全局'))
            .join('\n')}${omittedNote}`
    }${TAIL}`

  // 阶梯 1：尽量多带正文；带不下的那些降级为索引行（路径一定在）。
  for (let count = active.length; count >= 0; count -= 1) {
    const deferred = active.slice(count)
    const text = assemble(count, deferred, '')
    if (byteLength(text) <= maxBytes) return text
  }

  // 阶梯 2：连索引都放不下——索引行从后往前让位，并写明省略了多少条。
  for (let keep = active.length - 1; keep >= 0; keep -= 1) {
    const text = assemble(0, active.slice(0, keep), omittedNoteFor(active.length - keep))
    if (byteLength(text) <= maxBytes) return text
  }

  // 阶梯 3：预算小到只装得下开场说明。
  const minimal = assemble(0, [], omittedNoteFor(active.length))
  return byteLength(minimal) <= maxBytes ? minimal : truncateBytes(fixedHead, maxBytes)
}

/** 「已省略 N 条」的说明行；`omitted` 为 0 时不产生说明。 */
function omittedNoteFor(omitted) {
  return omitted > 0 ? `\n（索引超预算，已省略 ${omitted} 条记忆）` : ''
}
