/**
 * 文件 IO 层：把三类数据落到 `~/.dsh` 磁盘上，并集中做校验。
 *
 * **为什么用 `node:fs` 而不是 `ctx.fs`**：DSH 的文件服务刻意只有十三个原语，
 * **不含删除、重命名、复制**。而「规则 / 技能 / MCP」的管理必然要删除条目，
 * 因此管理类插件无法建立在 `ctx.fs` 之上。本模块只操作 `~/.dsh` 数据根，
 * 不触碰用户其他文件，以此控制影响面。
 *
 * 校验前置在这一层：任何非法输入在写盘之前就抛出（UI 能看到具体原因），
 * 不允许把坏数据写进用户目录再由下游插件报错。
 *
 * @module dsh-control-center/store
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MCP_FILE, DATA_ROOT, RULES_DIR, SKILLS_DIR, projectRulesDir } from './paths.js'
import { parseDocument, serializeDocument, slugify } from './profile.js'
import { parseRule, serializeRule } from './rules.js'

/** MCP 服务器名的合法形状（与 `dsh-mcp-client` 的 Config 约束一致）。 */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/
/** 技能名的合法形状（kebab-case，与 `dsh-skill-filesystem` 的发现规则一致）。 */
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/

/** 把底层 errno 错误翻译成可读的消息，避免 UI 显示一长串堆栈。 */
function explain(error, what) {
  const code = error?.code
  if (code === 'ENOENT') return new Error(`${what}：文件或目录不存在`)
  if (code === 'EPERM' || code === 'EACCES') return new Error(`${what}：权限不足`)
  return new Error(`${what}：${error?.message ?? String(error)}`)
}

/** 读目录，目录不存在时返回空数组（首次使用是正常状态，不是错误）。 */
async function listDirOrEmpty(dir) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw explain(error, `读取目录 ${dir}`)
  }
}

/** 确保目录存在。 */
async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    throw explain(error, `创建目录 ${dir}`)
  }
}

/* ──────────────────────────────── 规则 ──────────────────────────────── */

/**
 * 解析一个规则作用域：全局（`~/.dsh/rules`）或某个工作区（`<工作区>/.dsh/rules`）。
 *
 * 两种作用域的规则**格式完全相同**，只是根目录不同，所以下面所有规则函数都经这一层拿目录——
 * UI、校验、注入渲染因此只有一份实现。不传 scope 即全局（既有调用与测试保持不变）。
 *
 * @param scope - `{ scope?: 'global'|'project', workspace?: string }`。
 * @returns `{ dir, scope, workspace }`。
 */
function ruleScope(scope) {
  const isProject = scope?.scope === 'project'
  const workspace = isProject ? String(scope?.workspace ?? '').trim() : ''
  if (isProject && workspace.length === 0) throw new Error('项目规则必须指定工作区目录')
  return { dir: isProject ? projectRulesDir(workspace) : RULES_DIR, scope: isProject ? 'project' : 'global', workspace }
}

/**
 * 列出某个作用域的全部规则。
 *
 * 单个文件解析失败不会拖垮整个列表：失败的条目以 `error` 字段返回，
 * 让 UI 能指名道姓地报告「哪个文件坏了」，而不是整页报错。
 *
 * @param scope - 见 {@link ruleScope}。
 * @returns 规则数组（按文件名排序），每条都带 `scope` / `workspace`。
 */
export async function listRules(scope) {
  const target = ruleScope(scope)
  const entries = await listDirOrEmpty(target.dir)
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  const rules = []
  for (const file of files) {
    const path = join(target.dir, file)
    try {
      const text = await readFile(path, 'utf8')
      rules.push({ ...parseRule(file, text, path), scope: target.scope, workspace: target.workspace })
    } catch (error) {
      rules.push({
        file,
        path,
        name: file.replace(/\.md$/i, ''),
        description: '',
        mode: 'ondemand',
        enabled: false,
        body: '',
        extra: [],
        bytes: 0,
        scope: target.scope,
        workspace: target.workspace,
        error: error?.message ?? String(error),
      })
    }
  }
  return rules
}

/**
 * 读取单条规则；不存在时返回 `undefined`。
 *
 * @param file - 规则文件名。
 * @param scope - 见 {@link ruleScope}。
 * @returns 规则对象或 `undefined`。
 */
export async function readRule(file, scope) {
  const target = ruleScope(scope)
  const path = join(target.dir, file)
  try {
    return { ...parseRule(file, await readFile(path, 'utf8'), path), scope: target.scope, workspace: target.workspace }
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw explain(error, `读取规则 ${file}`)
  }
}

/**
 * 为一条新规则挑选不与现有文件冲突的文件名。
 *
 * @param name - 规则名称。
 * @param existing - 现有文件名集合。
 * @returns 可用的 `<slug>.md`。
 */
function availableRuleFile(name, existing) {
  const base = slugify(name)
  if (!existing.has(`${base}.md`)) return `${base}.md`
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}.md`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error(`无法为「${name}」生成不冲突的文件名`)
}

/**
 * 新建或覆盖一条规则。
 *
 * @param input - `{ file?, name, description?, mode, enabled?, body }`。
 * @param scope - 见 {@link ruleScope}（缺省 = 全局规则）。
 * @returns 落盘后的规则对象。
 */
export async function writeRule(input, scope) {
  const target = ruleScope(scope)
  const name = String(input.name ?? '').trim()
  if (name.length === 0) throw new Error('规则名称不能为空')
  const body = String(input.body ?? '')
  if (body.trim().length === 0) throw new Error('规则正文不能为空')
  const mode = input.mode === 'always' ? 'always' : 'ondemand'

  await ensureDir(target.dir)
  const existing = new Set((await listDirOrEmpty(target.dir)).map((entry) => entry.name))
  const file =
    typeof input.file === 'string' && input.file.length > 0
      ? (() => {
          if (!existing.has(input.file)) throw new Error(`规则 ${input.file} 不存在`)
          return input.file
        })()
      : availableRuleFile(name, existing)

  const current = await readRule(file, target)
  const rule = {
    file,
    path: join(target.dir, file),
    name,
    description: String(input.description ?? '').trim(),
    mode,
    enabled: input.enabled !== false,
    body: body.replace(/^\s*\n/, '').replace(/\s+$/, ''),
    extra: current?.extra ?? [],
  }
  try {
    await writeFile(rule.path, serializeRule(rule), 'utf8')
  } catch (error) {
    throw explain(error, `保存规则 ${file}`)
  }
  return { ...parseRule(file, serializeRule(rule), rule.path), scope: target.scope, workspace: target.workspace }
}

/**
 * 切换一条规则的启用状态。
 *
 * 刻意不复用 {@link writeRule}：那条路径要求调用方回传完整正文与名称，而开关只需要一个布尔；
 * 走这里可以保证「停用」绝不会因为 UI 少传字段而清空正文。
 *
 * @param file - 规则文件名。
 * @param enabled - 目标状态。
 * @param scope - 见 {@link ruleScope}。
 * @returns 落盘后的规则对象。
 */
export async function setRuleEnabled(file, enabled, scope) {
  const target = ruleScope(scope)
  const rule = await readRule(file, target)
  if (rule === undefined) throw new Error(`规则 ${file} 不存在`)
  const text = serializeRule({ ...rule, enabled: enabled !== false })
  try {
    await writeFile(rule.path, text, 'utf8')
  } catch (error) {
    throw explain(error, `切换规则 ${file}`)
  }
  return { ...parseRule(file, text, rule.path), scope: target.scope, workspace: target.workspace }
}

/**
 * 删除一条规则（物理删除，不留备份文件）。
 *
 * @param file - 规则文件名。
 * @param scope - 见 {@link ruleScope}。
 * @returns 无。
 */
export async function deleteRule(file, scope) {
  const target = ruleScope(scope)
  const path = join(target.dir, file)
  try {
    await rm(path)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`规则 ${file} 不存在`)
    throw explain(error, `删除规则 ${file}`)
  }
}

/* ──────────────────────────────── 技能 ──────────────────────────────── */

/** 从 frontmatter 解析技能调用策略。 */
function skillPolicy(data) {
  const model = data['disable-model-invocation']
  const user = data['user-invocable']
  return {
    // `enabled` 是本插件自己的开关（不是平台键）：关掉后技能完全不进 agent 的技能目录，
    // 因此既不注入上下文、也不能被 /名称 手动调用。缺省即启用。
    enabled: data.enabled !== false,
    modelInvocable: model !== true,
    userInvocable: user !== false,
  }
}

/**
 * 列出全部技能。
 *
 * 支持两种形态（与 `dsh-skill-filesystem` 一致）：目录 bundle `<name>/SKILL.md`
 * 与平铺文件 `<name>.md`；**刻意不支持**嵌套在更深处目录里的 `SKILL.md`。
 *
 * @returns 技能数组（按名称排序）。
 */
export async function listSkills() {
  const entries = await listDirOrEmpty(SKILLS_DIR)
  const found = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const path = join(SKILLS_DIR, entry.name, 'SKILL.md')
      try {
        await stat(path)
        found.push({ id: entry.name, kind: 'bundle', path })
      } catch {
        // 目录里没有 SKILL.md：不是技能，忽略（可能只是用户放资源的目录）。
      }
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      found.push({
        id: entry.name.replace(/\.md$/i, ''),
        kind: 'flat',
        path: join(SKILLS_DIR, entry.name),
      })
    }
  }
  const skills = []
  for (const item of found) {
    try {
      const text = await readFile(item.path, 'utf8')
      const { data, body } = parseDocument(text)
      const policy = skillPolicy(data)
      const declaredName = typeof data.name === 'string' ? data.name.trim() : ''
      const description = typeof data.description === 'string' ? data.description.trim() : ''
      // 平台的技能发现要求 frontmatter 同时有 name 与 description，且 name 是 kebab-case；
      // 这里按同一规则判无效，并作为 `error` 交给 UI 显示原因——比静默隐藏对用户有用得多。
      const invalid =
        declaredName.length === 0 || description.length === 0
          ? '缺少 frontmatter 的 name 或 description，平台会忽略这个文件'
          : !SKILL_NAME.test(declaredName)
            ? `name「${declaredName}」不是 kebab-case，平台会忽略这个文件`
            : undefined
      skills.push({
        id: item.id,
        kind: item.kind,
        path: item.path,
        name: declaredName.length > 0 ? declaredName : item.id,
        description,
        whenToUse: typeof data.whenToUse === 'string' ? data.whenToUse.trim() : '',
        enabled: policy.enabled,
        modelInvocable: policy.modelInvocable,
        userInvocable: policy.userInvocable,
        bytes: Buffer.byteLength(body, 'utf8'),
        // 目录名与 frontmatter name 不一致时，平台按本提供方给出的名字（即文件名）注册；
        // 说出来，别让用户对着两份名字猜。
        ...(description.length > 0 && declaredName.length > 0 && declaredName !== item.id
          ? { warning: `frontmatter 的 name 是「${declaredName}」，与文件名不一致；平台按「${item.id}」注册` }
          : {}),
        ...(invalid === undefined ? {} : { error: invalid }),
      })
    } catch (error) {
      skills.push({
        id: item.id,
        kind: item.kind,
        path: item.path,
        name: item.id,
        description: '',
        whenToUse: '',
        enabled: true,
        modelInvocable: false,
        userInvocable: false,
        bytes: 0,
        error: error?.message ?? String(error),
      })
    }
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * 读取一个技能的完整正文。
 *
 * @param id - 技能名。
 * @returns `{ skill, body }`；不存在时 `undefined`。
 */
export async function readSkill(id) {
  const skills = await listSkills()
  const skill = skills.find((item) => item.id === id)
  if (skill === undefined) return undefined
  const { body } = parseDocument(await readFile(skill.path, 'utf8'))
  return { skill, body: body.replace(/^\s*\n/, '').replace(/\s+$/, '') }
}

/**
 * 新建或覆盖一个技能。
 *
 * **技能名不可改名**：DSH 按名称索引技能，改名等于换一个技能。要改名请新建 + 删除。
 * 新建一律落成目录 bundle（`<name>/SKILL.md`），与既有 TRAE 同步过来的技能形态一致；
 * 编辑既有平铺文件则保持平铺，不擅自迁移用户目录结构。
 *
 * @param input - `{ id, description, whenToUse?, body, enabled?, modelInvocable?, userInvocable? }`。
 * @returns 落盘后的技能条目。
 */
export async function writeSkill(input) {
  const id = String(input.id ?? '').trim()
  if (!SKILL_NAME.test(id)) {
    throw new Error('技能名必须是 kebab-case（小写字母、数字、连字符，且以字母或数字开头）')
  }
  const description = String(input.description ?? '').trim()
  if (description.length === 0) throw new Error('技能描述不能为空——模型靠它判断何时加载')
  const body = String(input.body ?? '')
  if (body.trim().length === 0) throw new Error('技能正文不能为空')

  await ensureDir(SKILLS_DIR)
  const existing = (await listSkills()).find((item) => item.id === id)
  const path = existing?.path ?? join(SKILLS_DIR, id, 'SKILL.md')
  if (existing === undefined) await ensureDir(join(SKILLS_DIR, id))

  const raw = existing === undefined ? undefined : await readFile(existing.path, 'utf8')
  const extra = raw === undefined ? [] : parseDocument(raw).extra
  const text = serializeDocument(
    {
      name: id,
      description,
      whenToUse: String(input.whenToUse ?? '').trim() || undefined,
      // `enabled` 只在关掉时写：缺省即启用，这样新建出来的技能文件与平台原生格式一致。
      enabled: input.enabled === false ? false : undefined,
      'disable-model-invocation': input.modelInvocable === false ? true : undefined,
      'user-invocable': input.userInvocable === false ? false : undefined,
    },
    body,
    extra,
  )
  try {
    await writeFile(path, text, 'utf8')
  } catch (error) {
    throw explain(error, `保存技能 ${id}`)
  }
  const written = await readSkill(id)
  return written.skill
}

/**
 * 只改技能的启用开关，正文与其余 frontmatter 原样保留。
 *
 * 走 `writeSkill` 而不是自己拼 frontmatter：校验与「保留既有额外键」只有一份实现。
 *
 * @param id - 技能名。
 * @param enabled - 是否对 agent 启用。
 * @returns 落盘后的技能条目。
 */
export async function setSkillEnabled(id, enabled) {
  const current = await readSkill(id)
  if (current === undefined) throw new Error(`技能 ${id} 不存在`)
  return writeSkill({
    id,
    description: current.skill.description,
    whenToUse: current.skill.whenToUse,
    modelInvocable: current.skill.modelInvocable,
    userInvocable: current.skill.userInvocable,
    body: current.body,
    enabled,
  })
}

/** 删除一个技能（目录 bundle 连目录和其资源一起删）。 */
export async function deleteSkill(id) {
  const skills = await listSkills()
  const skill = skills.find((item) => item.id === id)
  if (skill === undefined) throw new Error(`技能 ${id} 不存在`)
  try {
    if (skill.kind === 'bundle') await rm(join(SKILLS_DIR, id), { recursive: true, force: true })
    else await rm(skill.path)
  } catch (error) {
    throw explain(error, `删除技能 ${id}`)
  }
}

/* ──────────────────────────────── MCP ──────────────────────────────── */

/** 校验并规范化一个 MCP 服务器条目。 */
export function normalizeServer(input) {
  const name = String(input.name ?? '').trim()
  if (!SERVER_NAME.test(name)) {
    throw new Error('MCP 服务器名只能包含字母、数字、下划线、连字符，长度 1–32')
  }
  const transport = input.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
  const server = { name, enabled: input.enabled !== false, transport }
  if (transport === 'stdio') {
    const command = String(input.command ?? '').trim()
    if (command.length === 0) throw new Error('stdio 传输必须填写启动命令')
    server.command = command
    server.args = Array.isArray(input.args)
      ? input.args.map((value) => String(value))
      : String(input.args ?? '')
          .split(/\s+/)
          .filter((value) => value.length > 0)
    const env = input.env
    server.env =
      env !== null && typeof env === 'object' && !Array.isArray(env)
        ? Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]))
        : {}
    if (typeof input.cwd === 'string' && input.cwd.trim().length > 0) server.cwd = input.cwd.trim()
  } else {
    const url = String(input.url ?? '').trim()
    if (!/^https?:\/\//.test(url)) throw new Error('streamable-http 传输必须填写 http(s) URL')
    server.url = url
    const headers = input.headers
    server.headers =
      headers !== null && typeof headers === 'object' && !Array.isArray(headers)
        ? Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]))
        : {}
  }
  const timeout = Number(input.toolCallTimeoutMs)
  if (Number.isFinite(timeout) && timeout > 0) server.toolCallTimeoutMs = Math.floor(timeout)
  if (input.failOnStartupError === true) server.failOnStartupError = true
  return server
}

/**
 * 读取 MCP 注册表。
 *
 * 文件不存在、或内容不是合法 JSON 时**不抛错**，而是返回空表 + `error`，
 * 让设置页能显示「文件坏了」并允许用户直接覆盖重写——否则用户会被锁在门外。
 *
 * @returns `{ servers, error? }`。
 */
export async function readMcp() {
  let raw
  try {
    raw = await readFile(MCP_FILE, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { servers: [] }
    throw explain(error, '读取 MCP 配置')
  }
  try {
    const parsed = JSON.parse(raw)
    const servers = Array.isArray(parsed?.servers) ? parsed.servers.map(normalizeServer) : []
    return { servers }
  } catch (error) {
    return { servers: [], error: `mcp.json 无法解析：${error?.message ?? String(error)}` }
  }
}

/**
 * 覆盖写入 MCP 注册表。
 *
 * @param servers - 服务器数组（本函数会先逐条校验，非法输入不落盘）。
 */
export async function writeMcp(servers) {
  const normalized = servers.map(normalizeServer)
  const seen = new Set()
  for (const server of normalized) {
    if (seen.has(server.name)) throw new Error(`MCP 服务器名重复：${server.name}`)
    seen.add(server.name)
  }
  await ensureDir(DATA_ROOT)
  try {
    await writeFile(MCP_FILE, `${JSON.stringify({ servers: normalized }, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw explain(error, '保存 MCP 配置')
  }
  return normalized
}
