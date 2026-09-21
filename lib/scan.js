/**
 * 从别的 AI 客户端扫描并导入 MCP 服务器与技能。
 *
 * **为什么要自己扫**：用户机器上往往已经装过 Codex / Claude Code / Cursor / Trae / Kimi 等一二十个
 * 客户端，每个都在自己家的目录里存着一份 MCP 与技能配置。手工一个个搬是纯体力活，而且极容易漏。
 *
 * 三类解析：
 * - **JSON**（绝大多数客户端）：直接找 `mcpServers` / `mcp_servers` / `mcp` 三种键名；
 * - **TOML**（Codex、Kimi）：`[mcp_servers.<name>]` 段，本模块自带一个覆盖实际用法的极小子集解析器；
 * - **YAML-ish**（OpenClaw、Hermes）：只认标准的两层 `mcpServers:` 映射。
 *
 * 扫描是**只读**的：任何情况下都不修改别的客户端的文件。导入才写入本插件管的
 * `~/.dsh/mcp.json` 与 `~/.dsh/skills`，并且默认不覆盖同名项。
 *
 * @module dsh-control-center/scan
 */

import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { SKILLS_DIR, MCP_FILE } from './paths.js'
import { readMcp, writeMcp, normalizeServer } from './store.js'

/** 用户主目录（扫描目标全在它下面）。 */
const HOME = homedir()

/** 通用源表：一个客户端 = 若干候选配置文件 + 若干技能目录（相对 `$HOME`）。 */
const GENERIC_SOURCES = [
  { id: 'qoder', label: 'Qoder', config: ['.qoder/mcp.json', '.qoder-cn/mcp.json', '.qoderwork/mcp.json', '.qoderworkcn/mcp.json'], skills: ['.qoder/skills', '.qoder-cn/skills', '.qoderwork/skills'] },
  { id: 'workbuddy', label: 'WorkBuddy', config: ['.workbuddy/.mcp.json', '.workbuddy/mcp.json', '.workbuddy/settings.json'], skills: ['.workbuddy/skills'] },
  { id: 'zcode', label: 'ZCode', config: ['.zcode/config.json', '.zcode/setting.json', '.zcode/mcp.json'], skills: ['.zcode/skills'] },
  { id: 'lingma', label: '通义灵码', config: ['.lingma/mcp.json', '.lingma/config.json'], skills: ['.lingma/skills'] },
  { id: 'codemoss', label: 'CodeMoss', config: ['.codemoss/config.json', '.codemoss/mcp.json'], skills: ['.codemoss/skills'] },
  { id: 'copilot', label: 'GitHub Copilot', config: ['.copilot/mcp.json', '.copilot/config.json'], skills: ['.copilot/skills'] },
  { id: 'cursor', label: 'Cursor', config: ['.cursor/mcp.json'], skills: ['.cursor/skills'] },
  { id: 'windsurf', label: 'Windsurf', config: ['.codeium/windsurf/mcp_config.json', '.codeium/windsurf/settings.json'], skills: ['.codeium/windsurf/skills'] },
  { id: 'cline', label: 'Cline', config: ['.cline/mcp_settings.json', '.cline/mcp.json'], skills: ['.cline/skills'] },
  { id: 'roo', label: 'Roo Code', config: ['.roo/mcp_settings.json', '.roo/mcp.json'], skills: ['.roo/skills'] },
  { id: 'qwen', label: 'Qwen Code', config: ['.codeqwen/mcp.json', '.codeqwen/config.json'], skills: ['.codeqwen/skills'] },
]

/** 全部内置源 id（UI 的开关列表按这个顺序渲染）。 */
export const SOURCE_IDS = [
  'codex',
  'claude',
  'ccswitch',
  'hermes',
  'opencode',
  'gemini',
  'grok',
  'kimi',
  'codebuddy',
  'trae',
  'openclaw',
  ...GENERIC_SOURCES.map((source) => source.id),
]

/** 内置源的显示名。 */
export const SOURCE_LABELS = Object.fromEntries([
  ['codex', 'Codex CLI'],
  ['claude', 'Claude Code'],
  ['ccswitch', 'CC Switch'],
  ['hermes', 'Hermes'],
  ['opencode', 'OpenCode'],
  ['gemini', 'Gemini CLI'],
  ['grok', 'Grok CLI'],
  ['kimi', 'Kimi CLI'],
  ['codebuddy', 'CodeBuddy'],
  ['trae', 'Trae'],
  ['openclaw', 'OpenClaw'],
  ...GENERIC_SOURCES.map((source) => [source.id, source.label]),
])

/* ────────────────────────────── 文本解析 ────────────────────────────── */

/** 读文本；不存在或读不动返回 `undefined`。 */
async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 剥掉 TOML 行尾注释（尊重引号内的 `#`）。 */
function stripComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote !== null) {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '#') return line.slice(0, index)
  }
  return line
}

/** 找到不在引号/括号里的第一个 `=`。 */
function topLevelEquals(line) {
  let quote = null
  let depth = 0
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote !== null) {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth -= 1
    else if (char === '=' && depth === 0) return index
  }
  return -1
}

/** 按顶层逗号切分（尊重引号与嵌套括号）。 */
function splitTopLevel(text) {
  const parts = []
  let quote = null
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== null) {
      if (char === '\\' && quote === '"') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 去引号。 */
function unquote(text) {
  const value = String(text).trim()
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    const inner = value.slice(1, -1)
    return value.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\') : inner
  }
  return value
}

/** 解析一个 TOML 值（子集：字符串 / 数字 / 布尔 / 数组 / 内联表）。 */
function parseTomlValue(text) {
  const value = text.trim()
  if (value === '') return undefined
  if (value.startsWith('"') || value.startsWith("'")) return unquote(value)
  if (value.startsWith('[')) {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '')
    return splitTopLevel(inner)
      .map((part) => parseTomlValue(part))
      .filter((item) => item !== undefined)
  }
  if (value.startsWith('{')) {
    const inner = value.replace(/^\{/, '').replace(/\}$/, '')
    const table = {}
    for (const part of splitTopLevel(inner)) {
      const eq = topLevelEquals(part)
      if (eq <= 0) continue
      table[unquote(part.slice(0, eq))] = parseTomlValue(part.slice(eq + 1))
    }
    return table
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

/**
 * 解析 TOML 的实用子集：`[a.b]` 段 + `key = value`，并支持跨行数组/内联表。
 *
 * @param text - TOML 全文。
 * @returns 解析出的对象树。
 */
export function parseToml(text) {
  const root = {}
  let current = root
  const lines = String(text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    let line = stripComment(lines[index]).trim()
    if (line === '') continue
    if (line.startsWith('[[')) continue
    if (line.startsWith('[')) {
      const path = line.slice(1, line.lastIndexOf(']')).split('.').map((part) => unquote(part))
      current = root
      for (const key of path) {
        if (current[key] === undefined || typeof current[key] !== 'object') current[key] = {}
        current = current[key]
      }
      continue
    }
    const eq = topLevelEquals(line)
    if (eq <= 0) continue
    const key = unquote(line.slice(0, eq))
    let raw = line.slice(eq + 1).trim()
    // 跨行的数组 / 内联表：括号没配平就把后面的行接上。
    let depth = 0
    let quote = null
    for (const char of raw) {
      if (quote !== null) {
        if (char === quote) quote = null
        continue
      }
      if (char === '"' || char === "'") quote = char
      else if (char === '[' || char === '{') depth += 1
      else if (char === ']' || char === '}') depth -= 1
    }
    while (depth > 0 && index + 1 < lines.length) {
      index += 1
      const next = stripComment(lines[index])
      raw += ` ${next.trim()}`
      for (const char of next) {
        if (char === '[' || char === '{') depth += 1
        else if (char === ']' || char === '}') depth -= 1
      }
    }
    const value = parseTomlValue(raw)
    if (value !== undefined) current[key] = value
  }
  return root
}

/** 从 JSON/YAML-ish 文本里抽出 mcpServers 映射。 */
export function extractMcpServers(text) {
  if (typeof text !== 'string' || text.trim() === '') return {}
  try {
    const parsed = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of ['mcpServers', 'mcp_servers', 'mcp']) {
        const candidate = parsed[key]
        if (candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)) {
          const servers = key === 'mcp' && candidate.servers !== undefined ? candidate.servers : candidate
          if (servers !== null && typeof servers === 'object' && !Array.isArray(servers)) return servers
        }
      }
      if (parsed.command !== undefined || parsed.url !== undefined) return parsed
    }
    return {}
  } catch {
    return parseYamlMcp(text)
  }
}

/**
 * 极简 YAML 抽取：只认标准的两层 `mcpServers:` 映射。
 *
 * @param text - YAML 文本。
 * @returns servers 映射。
 */
export function parseYamlMcp(text) {
  const servers = {}
  let inSection = false
  let current = null
  let field = null
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ')
    const indent = /^ */.exec(line)[0].length
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (indent === 0) {
      inSection = /^(mcpServers|mcp_servers|mcp):/.test(trimmed)
      current = null
      field = null
      continue
    }
    if (!inSection) continue
    if (indent <= 2) {
      const match = /^([A-Za-z0-9_.-]+):\s*$/.exec(trimmed)
      if (match !== null) {
        current = match[1]
        servers[current] = {}
        field = null
        continue
      }
    }
    if (current === null) continue
    // 列表项（`args:` 下面的 `- value`）没有冒号，必须在「找冒号」之前处理，
    // 否则参数会被当成不认识的行直接丢掉。
    if (field === 'args' && trimmed.startsWith('- ')) {
      servers[current].args = [...(servers[current].args ?? []), unquote(trimmed.slice(2).trim())]
      continue
    }
    const eq = trimmed.indexOf(':')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = unquote(trimmed.slice(eq + 1).trim())
    if (indent > 2 && ['command', 'url', 'type', 'cwd', 'serverUrl'].includes(key)) {
      servers[current][key === 'serverUrl' ? 'url' : key] = value
      field = null
      continue
    }
    if (indent > 2 && ['args', 'env', 'headers'].includes(key)) {
      if (value.startsWith('[')) {
        // 行内数组写法：args: ["-y", "pkg"]
        servers[current][key] = splitTopLevel(value.replace(/^\[/, '').replace(/\]$/, ''))
          .map((part) => unquote(part))
          .filter((part) => part !== '')
        field = null
      } else field = key
      continue
    }
    if ((field === 'env' || field === 'headers') && indent > 4) {
      servers[current][field] = { ...(servers[current][field] ?? {}), [key]: value }
      continue
    }
    if (field !== null && indent <= 4) field = null
  }
  return servers
}

/**
 * 把一个外部客户端的 MCP 条目翻译成本插件的服务器形状。
 *
 * @param name - 服务器名。
 * @param raw - 外部条目。
 * @returns `{ server }` 或 `{ error }`。
 */
export function toServer(name, raw) {
  if (raw === null || typeof raw !== 'object') return { error: '条目不是对象' }
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  const url = raw.url ?? raw.serverUrl ?? raw.httpUrl
  if (type === 'sse') return { error: 'SSE 传输 DSH 不支持（只支持 stdio 与 streamable-http）' }
  if (typeof url === 'string' && url.trim() !== '' && raw.command === undefined) {
    const headers = {}
    for (const [key, value] of Object.entries(raw.headers ?? {})) headers[key] = String(value)
    return {
      server: {
        name,
        enabled: true,
        transport: 'streamable-http',
        url: String(url),
        headers,
      },
    }
  }
  if (typeof raw.command !== 'string' || raw.command.trim() === '') {
    return { error: '既没有 command 也没有 url，无法翻译' }
  }
  const env = {}
  for (const [key, value] of Object.entries(raw.env ?? {})) env[key] = String(value)
  const args = Array.isArray(raw.args) ? raw.args.map((value) => String(value)) : []
  return {
    server: {
      name,
      enabled: raw.disabled === true ? false : true,
      transport: 'stdio',
      command: raw.command.trim(),
      args,
      env,
      ...(typeof raw.cwd === 'string' && raw.cwd.trim() !== '' ? { cwd: raw.cwd.trim() } : {}),
      ...(Number.isFinite(Number(raw.startup_timeout_sec)) ? { toolCallTimeoutMs: Number(raw.startup_timeout_sec) * 1000 } : {}),
    },
  }
}

/* ────────────────────────────── 技能扫描 ────────────────────────────── */

/**
 * 扫一个技能目录（只读 frontmatter 的 name / description）。
 *
 * @param dir - 技能根目录。
 * @param source - 来源 id。
 * @returns 技能条目数组。
 */
async function scanSkillsDir(dir, source) {
  const found = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const file = join(path, 'SKILL.md')
      const text = await readText(file)
      if (text === undefined) continue
      const meta = readFrontmatter(text)
      found.push({ name: entry.name, ...meta, kind: 'bundle', path, file, source })
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const text = await readText(path)
      if (text === undefined) continue
      const meta = readFrontmatter(text)
      found.push({ name: entry.name.replace(/\.md$/i, ''), ...meta, kind: 'flat', path, file: path, source })
    }
  }
  return found
}

/** 从技能文件里读 name / description（不引入 YAML 依赖，只要两行）。 */
function readFrontmatter(text) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?---/.exec(text.replace(/^\uFEFF/, ''))
  const head = match === null ? '' : match[1]
  const pick = (key) => {
    const line = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(head)
    return line === null ? '' : line[1].trim().replace(/^["']|["']$/g, '')
  }
  return { declaredName: pick('name'), description: pick('description') }
}

/* ────────────────────────────── 各源扫描 ────────────────────────────── */

/** 收尾：把一项扫描结果规整成 UI 需要的形状。 */
function finish(id, label, mcp, skills, error) {
  const items = mcp.map((item) => {
    const converted = toServer(item.name, item.raw)
    return {
      name: item.name,
      source: id,
      ...(converted.server === undefined ? {} : { server: converted.server }),
      ...(converted.error === undefined ? {} : { error: converted.error }),
      ...(item.enabled === false ? { disabled: true } : {}),
    }
  })
  return {
    id,
    label,
    present: items.length > 0 || skills.length > 0,
    mcp: items,
    skills,
    ...(error === undefined ? {} : { error }),
  }
}

/** 扫描 Codex CLI（TOML）。 */
async function scanCodex() {
  const mcp = []
  const text = await readText(join(HOME, '.codex', 'config.toml'))
  if (text !== undefined) {
    const parsed = parseToml(text)
    const servers = parsed.mcp_servers ?? {}
    for (const [name, raw] of Object.entries(servers)) mcp.push({ name, raw })
  }
  return finish('codex', SOURCE_LABELS.codex, mcp, await scanSkillsDir(join(HOME, '.codex', 'skills'), 'codex'))
}

/** 扫描 Claude Code（.claude.json + settings.json + 插件目录里的技能）。 */
async function scanClaude() {
  const mcp = []
  const seen = new Set()
  for (const candidate of [join(HOME, '.claude.json'), join(HOME, '.claude', 'settings.json')]) {
    const text = await readText(candidate)
    if (text === undefined) continue
    for (const [name, raw] of Object.entries(extractMcpServers(text))) {
      if (seen.has(name)) continue
      seen.add(name)
      mcp.push({ name, raw })
    }
  }
  const skills = await scanSkillsDir(join(HOME, '.claude', 'skills'), 'claude')
  const pluginsRoot = join(HOME, '.claude', 'plugins')
  for (const sub of ['marketplaces', '']) {
    const base = sub === '' ? pluginsRoot : join(pluginsRoot, sub)
    let entries = []
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      skills.push(...(await scanSkillsDir(join(base, entry.name, 'skills'), 'claude')))
    }
  }
  return finish('claude', SOURCE_LABELS.claude, mcp, skills)
}

/** 扫描 CC Switch（SQLite；Node 缺 node:sqlite 时明确报告而不是静默空结果）。 */
async function scanCcswitch() {
  const dbPath = join(HOME, '.cc-switch', 'cc-switch.db')
  const info = await statPath(dbPath)
  if (info === undefined) return finish('ccswitch', SOURCE_LABELS.ccswitch, [], [])
  const skills = await scanSkillsDir(join(HOME, '.cc-switch', 'skills'), 'ccswitch')
  let DatabaseSync
  try {
    ;({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return finish('ccswitch', SOURCE_LABELS.ccswitch, [], skills, '当前 Node 不支持 node:sqlite，无法读取 CC Switch 数据库')
  }
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db
      .prepare('SELECT name, server_config FROM mcp_servers')
      .all()
    const mcp = []
    for (const row of rows) {
      let raw = {}
      try {
        raw = JSON.parse(row.server_config ?? '{}')
      } catch {
        raw = {}
      }
      mcp.push({ name: String(row.name ?? ''), raw })
    }
    return finish('ccswitch', SOURCE_LABELS.ccswitch, mcp, skills)
  } catch (error) {
    return finish('ccswitch', SOURCE_LABELS.ccswitch, [], skills, error?.message ?? String(error))
  } finally {
    db.close()
  }
}

/** 按候选文件列表扫描一个通用源。 */
async function scanGeneric(id, label, configs, skillDirs, parser) {
  const mcp = []
  let error
  for (const rel of configs) {
    const text = await readText(join(HOME, rel))
    if (text === undefined) continue
    try {
      for (const [name, raw] of Object.entries(parser(text))) mcp.push({ name, raw })
    } catch (failure) {
      error = failure?.message ?? String(failure)
    }
  }
  const skills = []
  for (const rel of skillDirs) skills.push(...(await scanSkillsDir(join(HOME, rel), id)))
  return finish(id, label, mcp, skills, error)
}

/** 扫描 OpenClaw / Clawdbot。 */
async function scanOpenclaw() {
  const mcp = []
  const skills = []
  for (const base of ['.openclaw', '.clawdbot']) {
    for (const file of ['config.yaml', 'config.yml', 'config.json']) {
      const text = await readText(join(HOME, base, file))
      if (text === undefined) continue
      for (const [name, raw] of Object.entries(extractMcpServers(text))) mcp.push({ name, raw })
      break
    }
    skills.push(...(await scanSkillsDir(join(HOME, base, 'skills'), 'openclaw')))
  }
  return finish('openclaw', SOURCE_LABELS.openclaw, mcp, skills)
}

/** 扫描用户自定义源。 */
async function scanCustom(source) {
  const label = source.label === '' ? source.id : source.label
  if (source.kind === 'dir') {
    return finish(source.id, label, [], await scanSkillsDir(source.path, source.id))
  }
  const text = await readText(source.path)
  if (text === undefined) return finish(source.id, label, [], [], `文件不存在：${source.path}`)
  let mcp = []
  let error
  try {
    if (source.kind === 'toml') {
      const parsed = parseToml(text)
      const section = source.section ?? 'mcp_servers'
      const servers = section.split('.').reduce((node, key) => (node ?? {})[key], parsed) ?? {}
      for (const [name, raw] of Object.entries(servers)) mcp.push({ name, raw })
    } else {
      const parsed = JSON.parse(text)
      const key = source.mcpKey ?? 'mcpServers'
      const servers = parsed?.[key] ?? {}
      for (const [name, raw] of Object.entries(servers)) mcp.push({ name, raw })
    }
  } catch (failure) {
    error = failure?.message ?? String(failure)
  }
  return finish(source.id, label, mcp, [], error)
}

/** 取 stat，失败返回 `undefined`。 */
async function statPath(path) {
  try {
    return await stat(path)
  } catch {
    return undefined
  }
}

/**
 * 扫描全部启用的源。
 *
 * @param settings - 插件设置（读 `scan.disabled` 与 `scan.custom`）。
 * @returns `{ sources, totals }`。
 */
export async function scanAll(settings) {
  const disabled = new Set(settings?.scan?.disabled ?? [])
  const custom = settings?.scan?.custom ?? []
  const jobs = []
  const dispatch = {
    codex: scanCodex,
    claude: scanClaude,
    ccswitch: scanCcswitch,
    hermes: () => scanGeneric('hermes', SOURCE_LABELS.hermes, ['.hermes/config.yaml', '.hermes/config.yml', '.hermes/config.json'], ['.hermes/skills'], extractMcpServers),
    opencode: () => scanGeneric('opencode', SOURCE_LABELS.opencode, ['.config/opencode/opencode.json', '.config/opencode/config.json'], ['.config/opencode/skills'], extractMcpServers),
    gemini: () => scanGeneric('gemini', SOURCE_LABELS.gemini, ['.gemini/settings.json'], ['.gemini/skills'], extractMcpServers),
    grok: () => scanGeneric('grok', SOURCE_LABELS.grok, ['.grok/config.json', '.grok/settings.json', '.grok/mcp.json', '.grok/config.yaml'], ['.grok/skills'], extractMcpServers),
    kimi: async () => {
      const text = await readText(join(HOME, '.kimi', 'config.toml'))
      const mcp = []
      if (text !== undefined) {
        const parsed = parseToml(text)
        for (const [name, raw] of Object.entries(parsed.mcp_servers ?? {})) mcp.push({ name, raw })
      }
      return finish('kimi', SOURCE_LABELS.kimi, mcp, await scanSkillsDir(join(HOME, '.kimi', 'skills'), 'kimi'))
    },
    codebuddy: () => scanGeneric('codebuddy', SOURCE_LABELS.codebuddy, ['.codebuddy/mcp.json'], ['.codebuddy/skills'], extractMcpServers),
    trae: () => scanGeneric('trae', SOURCE_LABELS.trae, ['.trae-cn/mcp.json', '.trae/mcp.json'], ['.trae-cn/skills', '.trae/skills'], extractMcpServers),
    openclaw: scanOpenclaw,
  }
  for (const id of SOURCE_IDS) {
    if (disabled.has(id)) continue
    const run = dispatch[id]
    if (run !== undefined) jobs.push(run())
  }
  for (const source of custom) {
    if (disabled.has(source.id)) continue
    jobs.push(scanCustom(source))
  }
  const sources = await Promise.all(jobs)
  for (const generic of GENERIC_SOURCES) {
    if (disabled.has(generic.id)) continue
    sources.push(await scanGeneric(generic.id, generic.label, generic.config, generic.skills, extractMcpServers))
  }
  return {
    sources: sources.sort((a, b) => a.id.localeCompare(b.id)),
    totals: {
      mcp: sources.reduce((sum, source) => sum + source.mcp.length, 0),
      skills: sources.reduce((sum, source) => sum + source.skills.length, 0),
      present: sources.filter((source) => source.present).length,
    },
  }
}

/* ────────────────────────────── 导入 ────────────────────────────── */

/** 递归复制目录。 */
async function copyDirectory(from, to) {
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) await copyDirectory(source, target)
    else if (entry.isFile()) await copyFile(source, target)
  }
}

/**
 * 一次性导入选中的 MCP 服务器与技能。
 *
 * @param input - `{ servers: [{ source, name }], skills: [{ source, name }], overwrite? }`。
 * @param settings - 插件设置（用于重扫选中项的原始配置）。
 * @returns 导入摘要 `{ mcp: {...}, skills: {...} }`。
 */
export async function importItems(input, settings) {
  const scan = await scanAll(settings)
  const overwrite = input?.overwrite === true
  const wantedServers = Array.isArray(input?.servers) ? input.servers : []
  const wantedSkills = Array.isArray(input?.skills) ? input.skills : []

  const mcpResult = { imported: [], skipped: [], failed: [] }
  if (wantedServers.length > 0) {
    const current = await readMcp()
    if (current.error !== undefined) throw new Error(`当前 mcp.json 无法解析，先修好它再导入：${current.error}`)
    const byName = new Map(current.servers.map((server) => [server.name, server]))
    for (const wanted of wantedServers) {
      const source = scan.sources.find((item) => item.id === wanted.source)
      const item = source?.mcp.find((candidate) => candidate.name === wanted.name)
      if (item === undefined) {
        mcpResult.failed.push({ name: `${wanted.source}/${wanted.name}`, error: '源里已经找不到这一项（配置可能被改过）' })
        continue
      }
      if (item.error !== undefined || item.server === undefined) {
        mcpResult.failed.push({ name: `${wanted.source}/${wanted.name}`, error: item.error ?? '无法翻译成本插件的配置' })
        continue
      }
      if (byName.has(wanted.name) && !overwrite) {
        mcpResult.skipped.push({ name: wanted.name, reason: 'DSH 里已有同名服务器（可在导入时勾选覆盖）' })
        continue
      }
      let normalized
      try {
        normalized = normalizeServer(item.server)
      } catch (error) {
        mcpResult.failed.push({ name: wanted.name, error: error?.message ?? String(error) })
        continue
      }
      byName.set(wanted.name, normalized)
      mcpResult.imported.push({ name: wanted.name, from: wanted.source })
    }
    if (mcpResult.imported.length > 0) {
      await writeMcp([...byName.values()])
    }
  }

  const skillResult = { imported: [], skipped: [], failed: [] }
  for (const wanted of wantedSkills) {
    const source = scan.sources.find((item) => item.id === wanted.source)
    const item = source?.skills.find((candidate) => candidate.name === wanted.name)
    if (item === undefined) {
      skillResult.failed.push({ name: `${wanted.source}/${wanted.name}`, error: '源里已经找不到这个技能' })
      continue
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(item.name)) {
      skillResult.failed.push({ name: item.name, error: '技能名不是 kebab-case，DSH 会忽略它（请先在源客户端改名）' })
      continue
    }
    const target = item.kind === 'bundle' ? join(SKILLS_DIR, item.name, 'SKILL.md') : join(SKILLS_DIR, `${item.name}.md`)
    if ((await statPath(target)) !== undefined && !overwrite) {
      skillResult.skipped.push({ name: item.name, reason: 'DSH 里已有同名技能（可勾选覆盖）' })
      continue
    }
    try {
      if (item.kind === 'bundle') {
        await mkdir(join(SKILLS_DIR, item.name), { recursive: true })
        await copyDirectory(item.path, join(SKILLS_DIR, item.name))
      } else {
        await mkdir(SKILLS_DIR, { recursive: true })
        await copyFile(item.path, target)
      }
      skillResult.imported.push({ name: item.name, from: wanted.source })
    } catch (error) {
      skillResult.failed.push({ name: item.name, error: error?.message ?? String(error) })
    }
  }

  return { mcp: mcpResult, skills: skillResult }
}

/** 给 UI 用的导入目标路径（把「导入到哪里」说清楚）。 */
export const IMPORT_PATHS = { mcp: MCP_FILE, skills: SKILLS_DIR, mcpFileName: basename(MCP_FILE) }
