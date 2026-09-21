/**
 * 极小的 frontmatter 读写与文本工具。
 *
 * 刻意不引入 `js-yaml`：插件从 profile 的 node_modules 解析依赖，多一个运行时依赖就多一处
 * 解析不确定性与版本漂移。这里只需要支持规则/技能 frontmatter 实际用到的 YAML 子集——
 * 顶层 `key: value`（布尔、数字、引号字符串、裸字符串）——因此自己解析是**更小的**风险面。
 * 不支持的写法不会被丢弃：整行原样保留在 `extra` 里，往返写出后字节不变。
 *
 * 本模块不 import cordis，可用 `node --test` 直接验证。
 *
 * @module dsh-control-center/profile
 */

/** 单个 frontmatter 值按 YAML 子集推断类型。 */
function parseScalar(raw) {
  const value = raw.trim()
  if (value.length === 0) return ''
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
  const doubleQuoted = /^"(.*)"$/.exec(value)
  // 双引号值里 `\\` 与 `\"` 是写入时转义出来的（见 formatScalar），读回必须还原，
  // 否则 Windows 路径 `D:\Code\Demo` 会变成 `D:\\Code\\Demo` 这种双反斜杠。
  if (doubleQuoted !== null) {
    return doubleQuoted[1].replace(/\\(.)/g, (_, char) => (char === 'n' ? '\n' : char === 't' ? '\t' : char))
  }
  const singleQuoted = /^'(.*)'$/.exec(value)
  if (singleQuoted !== null) return singleQuoted[1]
  return value
}

/** 把标量写回 YAML：需要时加引号，保证 `:`、`#`、首尾空格不会破坏解析。 */
function formatScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const text = value === null || value === undefined ? '' : String(value)
  if (text.length === 0) return '""'
  if (/^[\s]|[\s]$|[:#{}[\],&*?|>%@`"']/.test(text) || text !== text.trim()) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return text
}

/**
 * 拆出文档的 frontmatter 与正文。
 *
 * 只认**文件开头**的第一个 `---` 块，正文里的分隔线不受影响；没有 frontmatter 时
 * `data` 为空对象、`body` 为全文（兼容 TRAE 里只有 00 号文件带 frontmatter 的现状）。
 *
 * @param text - 文件全文。
 * @returns frontmatter 键值对（含无法识别的原始行）、正文、以及是否存在 frontmatter。
 */
export function parseDocument(text) {
  const source = text.replace(/^\uFEFF/, '')
  // 结束分隔线必须是独占一行的 `---`；中间的换行可选，这样 `---\n---\n` 这种空 frontmatter 也能解析。
  const match = /^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(source)
  if (match === null) return { data: {}, extra: [], body: source, hasFrontmatter: false }
  const head = match[1]
  const body = source.slice(match[0].length)
  const data = {}
  const extra = []
  for (const line of head.split(/\r?\n/)) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (match === null) {
      extra.push(line)
      continue
    }
    data[match[1]] = parseScalar(match[2])
  }
  return { data, extra, body, hasFrontmatter: true }
}

/**
 * 组装带 frontmatter 的文档。键按给定顺序写入，`extra` 原样附在末尾。
 *
 * @param data - 要写入的键值对（值会按 YAML 子集转义）。
 * @param body - 正文。
 * @param extra - 需要原样保留的原始行。
 * @returns 完整文件文本（以换行结尾）。
 */
export function serializeDocument(data, body, extra = []) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    lines.push(`${key}: ${formatScalar(value)}`)
  }
  lines.push(...extra)
  lines.push('---')
  const normalizedBody = body.replace(/^\r?\n+/, '').replace(/\s+$/, '')
  return `${lines.join('\n')}\n\n${normalizedBody}\n`
}

/** 把任意标题转成安全的文件名（保留中文，仅剔除 Windows 非法字符）。 */
export function slugify(text) {
  const cleaned = String(text)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'untitled'
}

/** UTF-8 字节长度——预算按字节算，不按字符算。 */
export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * 按字节上限截断文本，不切断 UTF-8 码点。
 *
 * @param text - 原文。
 * @param maxBytes - 允许的最大字节数。
 * @returns 截断结果（未截断时原样返回）。
 */
export function truncateBytes(text, maxBytes) {
  if (maxBytes <= 0) return ''
  if (byteLength(text) <= maxBytes) return text
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (byteLength(text.slice(0, mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  return text.slice(0, low)
}
