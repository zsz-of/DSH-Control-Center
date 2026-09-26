/**
 * Host HTTP API：`/api/dsh-control-center` —— 浏览器侧与 host 之间的唯一通道。
 *
 * 设计约定（见 `.agents/rules.md`）：
 * - **写操作一律返回变更后的完整 state**，客户端不做乐观更新，单一真源在 host；
 * - 所有失败都以 `{ ok: false, error }` 返回，HTTP 状态码保持粗粒度，
 *   让客户端用同一套渲染逻辑显示原因；
 * - 二进制**只走专用端点**：备份 zip 用 `/download` 出、用 `/upload` 进，
 *   不让 base64 在 JSON 里膨胀（一个 20 MB 的包 base64 后要 27 MB）。
 *
 * @module dsh-control-center/api
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  BACKUP_DIR,
  CONFIG_DIR,
  DATA_ROOT,
  MAX_INJECT_BYTES,
  MAX_MEMORY_INJECT_BYTES,
  MCP_FILE,
  MEMORY_DIR,
  RULES_DIR,
  SETTINGS_FILE,
  SKILLS_DIR,
  projectRulesDir,
} from './paths.js'
import { byteLength } from './profile.js'
import { renderInjection } from './rules.js'
import {
  deleteMemory,
  listMemories,
  readMemory,
  renderMemoryInjection,
  writeMemory,
} from './memory.js'
import { dshDefaultModel, readSettings, writeSettings } from './settings.js'
import { applyRestore, analyzeBackup, createBackup, deleteBackup, listBackups, listSections, planRestore } from './backup.js'
import { IMPORT_PATHS, SOURCE_IDS, SOURCE_LABELS, importItems, scanAll } from './scan.js'
import {
  deleteRule,
  deleteSkill,
  listRules,
  listSkills,
  readMcp,
  readRule,
  readSkill,
  setRuleEnabled,
  setSkillEnabled,
  writeMcp,
  writeRule,
  writeSkill,
} from './store.js'

/** API 前缀。客户端只允许访问这个前缀。 */
const BASE = '/api/dsh-control-center'

/** 普通 POST body 的字节上限——防止一次误发把内存吃满。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** 上传备份包的大小上限。 */
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024

/** 解析过但还没执行的备份包缓存（token → 记录），10 分钟过期。 */
const UPLOAD_TTL_MS = 10 * 60 * 1000
const uploads = new Map()

/** 清掉过期/超量的上传缓存。 */
function pruneUploads() {
  const now = Date.now()
  for (const [token, record] of uploads) {
    if (now - record.at > UPLOAD_TTL_MS) uploads.delete(token)
  }
  while (uploads.size > 3) {
    const oldest = [...uploads.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    uploads.delete(oldest[0])
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** 读取并解析 POST body。 */
function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error(`请求体过大（超过 ${Math.round(limit / 1024 / 1024)} MB）`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 读取并解析 JSON body。 */
async function readJson(req, limit) {
  const raw = (await readBody(req, limit)).toString('utf8')
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${error?.message ?? String(error)}`)
  }
}

/**
 * 用系统文件管理器打开一个目录，或定位到一个文件。
 *
 * 四个坑都在这里补掉：
 * 1. **字段名要和客户端对得上**：浏览器侧发的是 `path`（打开目录）或 `file`（定位文件）。
 *    历史上客户端发的是 `dir` 而这里只读 `path`，于是每一次「打开目录」都被当成「没给目标」，
 *    静默退回数据根目录 `~/.dsh`——点哪个按钮都开同一个文件夹，看起来就是按钮坏了。
 *    现在两个名字都认（`path` 优先），旧客户端 bundle 也仍能工作。
 * 2. **目标不存在时什么都不发生**：`~/.dsh/memory`、`~/.dsh/mcp.json` 在用户还没建过时并不存在，
 *    而 `explorer.exe` 对不存在的路径既不报错也不开窗——界面看起来就是「按钮坏了」。
 *    这里先把目录建出来（定位文件时建父目录），确保落点真的能打开。
 * 3. **定位一个还不存在的文件**：`explorer.exe /select,<不存在的文件>` 会把**桌面**打开（实测），
 *    所以文件不存在时退回打开它所在的目录，而不是开一个跟目标毫无关系的地方。
 * 4. **失败无处可报**：`spawn` 的 `error` 事件没人监听会变成未捕获异常；现在等 spawn 结果再返回，
 *    界面因此能显示原因，而不是静默什么都不做。
 * 5. **窗口开出来了却是隐藏的**：`spawn(..., { windowsHide: true })` 会让 Windows 给子进程的
 *    `STARTUPINFO` 带上 `SW_HIDE`，而 `explorer.exe` 会把这个显示状态一直传给它新建的窗口——
 *    目录确实被打开了（进程在、窗口在、`Shell.Application.Windows()` 也查得到），但**用户看不见**，
 *    表现就是「点按钮没反应」。实测（同一目标目录，只改这一个开关）：
 *    `windowsHide: true` → 新 explorer.exe 进程的 `MainWindowTitle` 为空（窗口不可见）；
 *    `windowsHide: false` → `MainWindowTitle` 为 `<目录名> - 文件资源管理器`（窗口正常显示）。
 *    `detached` 与显示状态无关（true/false 都一样），所以这里必须显式关掉 `windowsHide`。
 *
 * @param target - `{ path }` 打开目录（也接受旧名 `{ dir }`），或 `{ file }` 定位文件。
 * @param launch - 启动器（默认 `node:child_process.spawn`；测试注入假实现，免得真开窗）。
 * @returns `{ target, kind }`——实际打开的路径与方式（退回父目录时 `kind` 是 `dir`）。
 */
export async function reveal(target, launch = spawn) {
  const file = typeof target?.file === 'string' && target.file !== '' ? target.file : undefined
  const dir = [target?.path, target?.dir].find((value) => typeof value === 'string' && value !== '')
  const wanted = file ?? dir ?? DATA_ROOT

  // 定位文件时目标可能还没被创建（比如还没写过 MCP 的机器上没有 mcp.json）。
  const select = file !== undefined && existsSync(file)
  const path = select ? file : file !== undefined ? dirname(file) : wanted
  const parent = select ? dirname(path) : path
  try {
    await mkdir(parent, { recursive: true })
  } catch (error) {
    throw new Error(`无法创建目录 ${parent}：${error?.message ?? String(error)}`)
  }

  const [command, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [select ? `/select,${path}` : path]]
      : process.platform === 'darwin'
        ? ['open', select ? ['-R', path] : [path]]
        : ['xdg-open', [select ? parent : path]]

  await new Promise((resolve, reject) => {
    let child
    try {
      // windowsHide 必须显式关掉：它会隐藏 explorer.exe 新建的窗口，用户看不见就以为按钮没反应。
      child = launch(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
    } catch (error) {
      reject(new Error(`无法启动 ${command}：${error?.message ?? String(error)}`))
      return
    }
    child.once('error', (error) => reject(new Error(`无法启动 ${command}：${error?.message ?? String(error)}`)))
    child.once('spawn', () => {
      // explorer.exe 把请求转交给已有外壳进程后就立刻退出（退出码还恒为 1），
      // 所以「成功启动」就是成功信号，不等它退出。
      child.unref?.()
      resolve()
    })
  })
  return { target: path, kind: select ? 'file' : 'dir' }
}

/**
 * 读备份目录里的一个产物并算出还原计划（只读，不写任何文件）。
 *
 * 文件名只接受「备份目录里的普通 `.zip`」——带路径（`..`、子目录、绝对路径）一律拒收，
 * 而不是靠 basename 静默改写成一个别的文件。
 *
 * @param file - 备份产物文件名。
 * @returns `{ analysis, plan }`。
 */
async function inspectBackupFile(file) {
  const name = String(file ?? '')
  if (name === '' || name !== basename(name) || !name.toLowerCase().endsWith('.zip')) {
    throw new Error('只允许还原备份目录里的 .zip 产物')
  }
  let buffer
  try {
    buffer = await readFile(join(BACKUP_DIR, name))
  } catch {
    throw new Error(`备份 ${name} 不存在`)
  }
  const analysis = analyzeBackup(buffer)
  return { analysis, plan: await planRestore(analysis, []) }
}

/** 把状态里的条目压到 UI 真正需要的字段。 */
function ruleView(rule) {
  return {
    file: rule.file,
    path: rule.path,
    name: rule.name,
    description: rule.description,
    mode: rule.mode,
    enabled: rule.enabled,
    bytes: rule.bytes,
    error: rule.error,
  }
}

function memoryView(memory) {
  return {
    file: memory.file,
    path: memory.path,
    name: memory.name,
    description: memory.description,
    scope: memory.scope,
    workspace: memory.workspace,
    tags: memory.tags,
    source: memory.source,
    pinned: memory.pinned,
    enabled: memory.enabled,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    bytes: memory.bytes,
    error: memory.error,
  }
}

/**
 * 组装完整状态。这是客户端唯一的数据源。
 *
 * @param runtime - 插件共享运行时。
 * @param workspace - 要看项目规则的工作区目录；空串表示只看全局。
 * @returns 可序列化的状态对象。
 */
async function buildState(runtime, workspace = '') {
  const settings = await readSettings()
  const [rules, skills, mcp, memories, backups, sections, projectRules] = await Promise.all([
    listRules(),
    listSkills(),
    readMcp(),
    listMemories(),
    listBackups(),
    listSections(),
    workspace === '' ? Promise.resolve([]) : listRules({ scope: 'project', workspace }).catch(() => []),
  ])
  const rendered = renderInjection(rules, MAX_INJECT_BYTES)
  const activeRules = rules.filter((rule) => rule.enabled !== false)
  const status = runtime.mcp.snapshot()
  const activeMemories = memories.filter((memory) => memory.enabled !== false && memory.error === undefined)
  const projectRendered = workspace === '' ? undefined : renderInjection(projectRules, MAX_INJECT_BYTES)
  return {
    root: DATA_ROOT,
    paths: { rules: RULES_DIR, skills: SKILLS_DIR, mcp: MCP_FILE, memory: MEMORY_DIR, backup: BACKUP_DIR, config: CONFIG_DIR, settingsFile: SETTINGS_FILE },
    budget: { rules: MAX_INJECT_BYTES, memory: MAX_MEMORY_INJECT_BYTES },
    rules: {
      items: rules.map(ruleView),
      activeCount: activeRules.length,
      alwaysCount: activeRules.filter((rule) => rule.mode === 'always').length,
      ondemandCount: activeRules.filter((rule) => rule.mode !== 'always').length,
      injectBytes: rendered === undefined ? 0 : byteLength(rendered),
    },
    project:
      workspace === ''
        ? null
        : {
            workspace,
            dir: projectRulesDir(workspace),
            items: projectRules.map(ruleView),
            activeCount: projectRules.filter((rule) => rule.enabled !== false).length,
            injectBytes: projectRendered === undefined ? 0 : byteLength(projectRendered),
          },
    skills: { items: skills },
    mcp: {
      items: mcp.servers.map((server) => ({ ...server, status: status[server.name] ?? { state: 'pending' } })),
      error: mcp.error,
      fileError: status.__file__?.error,
      syncError: status.__sync__?.error ?? null,
    },
    memory: {
      items: memories.map(memoryView),
      enabledCount: activeMemories.length,
      globalCount: activeMemories.filter((memory) => memory.scope === 'global').length,
      workspaceCount: activeMemories.filter((memory) => memory.scope === 'workspace').length,
      injectBytes: (() => {
        const text = renderMemoryInjection(memories, { maxBytes: MAX_MEMORY_INJECT_BYTES })
        return text === undefined ? 0 : byteLength(text)
      })(),
      injectEnabled: settings.memory.enabled && settings.memory.inject,
    },
    backup: {
      dir: BACKUP_DIR,
      items: backups.map((item) => ({ file: item.file, bytes: item.bytes, createdAt: item.createdAt })),
      sections: sections.map((section) => ({
        id: section.id,
        label: section.label,
        hint: section.hint,
        sensitive: section.sensitive === true,
        roots: section.roots.length,
      })),
      retention: settings.backup.retention,
      snapshotBeforeImport: settings.backup.snapshotBeforeImport,
    },
    scan: {
      targets: { mcp: IMPORT_PATHS.mcp, skills: IMPORT_PATHS.skills },
      sources: SOURCE_IDS.map((id) => ({ id, label: SOURCE_LABELS[id], enabled: !settings.scan.disabled.includes(id) })),
      custom: settings.scan.custom,
    },
    settings,
    optimize: {
      ...settings.optimize,
      available: runtime.optimize !== undefined,
      hasCustomPrompt: settings.optimize.prompt.trim() !== '',
    },
  }
}

/** 处理一次 API 请求。 */
async function handle(req, res, runtime, url, launch) {
  /**
   * 请求里带的工作区。
   *
   * 三种来源，优先级从高到低：显式 `workspace=` 参数 → `session=` 参数（由 host 解析该会话的
   * 工作目录，客户端因此不必去猜会话快照的形状）→ 空（只看全局）。
   */
  const workspaceOfQuery = (source) => {
    const explicit = String(source.get('workspace') ?? '').trim()
    if (explicit !== '') return explicit
    const session = String(source.get('session') ?? '').trim()
    if (session === '' || runtime.sessionCwd === undefined) return ''
    return String(runtime.sessionCwd(session) ?? '').trim()
  }
  /** 写操作 payload 里的工作区（同上：先看显式路径，再看会话工作目录）。 */
  const workspaceOfPayload = (payload) => {
    const explicit = String(payload?.workspace ?? '').trim()
    if (explicit !== '') return explicit
    const session = String(payload?.session ?? '').trim()
    if (session === '' || runtime.sessionCwd === undefined) return ''
    return String(runtime.sessionCwd(session) ?? '').trim()
  }

  /* ───────────────── GET /state ───────────────── */
  if (req.method === 'GET' && url.pathname === `${BASE}/state`) {
    sendJson(res, 200, { ok: true, state: await buildState(runtime, workspaceOfQuery(url.searchParams)) })
    return
  }

  /* ───────────────── GET /body ───────────────── */
  if (req.method === 'GET' && url.pathname === `${BASE}/body`) {
    const section = url.searchParams.get('section')
    const id = url.searchParams.get('id') ?? ''
    if (section === 'rule') {
      const workspace = workspaceOfQuery(url.searchParams)
      const rule = await readRule(id, workspace === '' ? undefined : { scope: 'project', workspace })
      if (rule === undefined) {
        sendJson(res, 400, { ok: false, error: `规则 ${id} 不存在` })
        return
      }
      sendJson(res, 200, { ok: true, body: rule.body })
      return
    }
    if (section === 'skill') {
      const skill = await readSkill(id)
      if (skill === undefined) {
        sendJson(res, 400, { ok: false, error: `技能 ${id} 不存在` })
        return
      }
      sendJson(res, 200, { ok: true, body: skill.body })
      return
    }
    if (section === 'memory') {
      const memory = await readMemory(id)
      if (memory === undefined) {
        sendJson(res, 400, { ok: false, error: `记忆 ${id} 不存在` })
        return
      }
      sendJson(res, 200, { ok: true, body: memory.body })
      return
    }
    sendJson(res, 400, { ok: false, error: `未知分区 ${String(section)}` })
    return
  }

  /* ───────────────── GET /scan ───────────────── */
  if (req.method === 'GET' && url.pathname === `${BASE}/scan`) {
    const settings = await readSettings()
    const result = await scanAll(settings)
    sendJson(res, 200, { ok: true, scan: result })
    return
  }

  /* ───────────────── GET /flags ───────────────── */
  if (req.method === 'GET' && url.pathname === `${BASE}/flags`) {
    const settings = await readSettings()
    sendJson(res, 200, {
      ok: true,
      flags: {
        optimize: {
          enabled: settings.optimize.enabled,
          available: runtime.optimize !== undefined,
        },
      },
    })
    return
  }

  /* ───────────────── GET /revision ───────────────── */
  if (req.method === 'GET' && url.pathname === `${BASE}/revision`) {
    sendJson(res, 200, { ok: true, revision: runtime.revision })
    return
  }

  /* ───────────────── GET /routes ───────────────── */
  if (req.method === 'GET' && url.pathname === `${BASE}/routes`) {
    if (runtime.optimize === undefined) {
      sendJson(res, 200, { ok: true, routes: [], fallback: null, note: 'LLM 服务尚未就绪' })
      return
    }
    const routes = await runtime.optimize.routes()
    const fallback = await dshDefaultModel()
    sendJson(res, 200, { ok: true, routes, fallback: fallback ?? null })
    return
  }

  /* ───────────────── POST /optimize ───────────────── */
  if (req.method === 'POST' && url.pathname === `${BASE}/optimize`) {
    if (runtime.optimize === undefined) {
      sendJson(res, 400, { ok: false, error: 'LLM 服务尚未就绪，无法优化提示词' })
      return
    }
    const payload = await readJson(req)
    const settings = await readSettings()
    if (!settings.optimize.enabled) {
      sendJson(res, 400, { ok: false, error: '提示词优化已在控制中心设置里关闭' })
      return
    }
    const fallback = await dshDefaultModel()
    const result = await runtime.optimize.optimize(payload.text, {
      settings: settings.optimize,
      fallbackRoute: fallback,
    })
    sendJson(res, 200, { ok: true, ...result })
    return
  }

  /* ───────────────── POST /upload（备份包分析）───────────────── */
  if (req.method === 'POST' && url.pathname === `${BASE}/upload`) {
    const buffer = await readBody(req, MAX_UPLOAD_BYTES)
    if (buffer.length === 0) {
      sendJson(res, 400, { ok: false, error: '没有收到文件内容' })
      return
    }
    // 解析失败是**用户输入问题**（选错文件、包损坏），用 400 + 原因回答，
    // 而不是让外层的 500 兜底——那会让 UI 显示成「插件坏了」。
    let analysis
    try {
      analysis = analyzeBackup(buffer)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error?.message ?? String(error) })
      return
    }
    const plan = await planRestore(analysis, [])
    pruneUploads()
    const token = randomUUID()
    uploads.set(token, { at: Date.now(), buffer })
    sendJson(res, 200, {
      ok: true,
      token,
      manifest: analysis.manifest,
      sections: analysis.sections.map((section) => {
        const counts = plan.items.filter((item) => item.section === section.id)
        return {
          ...section,
          create: counts.filter((item) => item.action === 'create').length,
          overwrite: counts.filter((item) => item.action === 'overwrite').length,
        }
      }),
      counts: plan.counts,
      preview: plan.items.slice(0, 200).map((item) => ({
        section: item.section,
        name: item.name,
        target: item.target,
        action: item.action,
        bytes: item.bytes,
      })),
    })
    return
  }

  if (req.method !== 'POST' || url.pathname !== `${BASE}/action`) {
    sendJson(res, 404, { ok: false, error: '未知接口' })
    return
  }

  /* ───────────────── POST /action ───────────────── */
  const payload = await readJson(req)
  const section = payload.section
  const op = payload.op
  let extra
  try {
    if (section === 'rule') {
      // `scope: 'project'` + `workspace` 表示改的是那个工作区的项目规则；缺省即全局规则。
      const target = payload.scope === 'project' ? { scope: 'project', workspace: workspaceOfPayload(payload) } : undefined
      if (op === 'save') await writeRule(payload.rule ?? {}, target)
      else if (op === 'delete') await deleteRule(String(payload.file ?? ''), target)
      else if (op === 'toggle') await setRuleEnabled(String(payload.file ?? ''), payload.enabled !== false, target)
      else throw new Error(`规则分区不支持的操作：${String(op)}`)
    } else if (section === 'skill') {
      if (op === 'save') await writeSkill(payload.skill ?? {})
      else if (op === 'delete') await deleteSkill(String(payload.id ?? ''))
      else if (op === 'toggle') await setSkillEnabled(String(payload.id ?? ''), payload.enabled !== false)
      else throw new Error(`技能分区不支持的操作：${String(op)}`)
      // 技能目录由 registry 按 revision 缓存，写完必须主动通知失效，否则目录停在旧快照上。
      runtime.invalidateSkills()
    } else if (section === 'memory') {
      if (op === 'save') await writeMemory(payload.memory ?? {})
      else if (op === 'delete') await deleteMemory(String(payload.file ?? ''))
      else if (op === 'toggle' || op === 'pin') {
        const current = await readMemory(String(payload.file ?? ''))
        if (current === undefined) throw new Error(`记忆 ${String(payload.file)} 不存在`)
        // 刻意沿用原来的 `updatedAt`：开关与置顶是元数据变更，刷新时间会让列表顺序在用户
        // 点一下开关时整体跳动（列表按 updatedAt 排序）。
        await writeMemory(
          {
            ...current,
            file: current.file,
            enabled: op === 'toggle' ? payload.enabled !== false : current.enabled,
            pinned: op === 'pin' ? payload.pinned === true : current.pinned,
          },
          current.updatedAt || undefined,
        )
      } else throw new Error(`记忆分区不支持的操作：${String(op)}`)
    } else if (section === 'mcp') {
      if (op === 'save') {
        const { servers } = await readMcp()
        const incoming = payload.server ?? {}
        const name = String(incoming.name ?? '')
        const next = servers.filter((server) => server.name !== name)
        next.push(incoming)
        await writeMcp(next)
      } else if (op === 'delete') {
        const { servers } = await readMcp()
        await writeMcp(servers.filter((server) => server.name !== String(payload.name ?? '')))
      } else if (op === 'toggle') {
        const { servers } = await readMcp()
        await writeMcp(
          servers.map((server) =>
            server.name === String(payload.name ?? '') ? { ...server, enabled: payload.enabled !== false } : server,
          ),
        )
      } else if (op !== 'sync') {
        throw new Error(`MCP 分区不支持的操作：${String(op)}`)
      }
      await runtime.mcp.sync()
    } else if (section === 'settings') {
      if (op !== 'save') throw new Error(`设置分区不支持的操作：${String(op)}`)
      await writeSettings(payload.settings ?? {})
    } else if (section === 'backup') {
      if (op === 'create') {
        const settings = await readSettings()
        extra = await createBackup(payload.sections, {
          label: payload.label,
          retention: settings.backup.retention,
        })
      } else if (op === 'delete') {
        await deleteBackup(String(payload.file ?? ''))
      } else if (op === 'inspect') {
        // 「还原」前先看清楚会动到什么：只读分析 + 计划，不写任何文件。
        const { analysis, plan } = await inspectBackupFile(String(payload.file ?? ''))
        extra = {
          manifest: analysis.manifest,
          sections: analysis.sections.map((section) => {
            const items = plan.items.filter((item) => item.section === section.id)
            return {
              ...section,
              create: items.filter((item) => item.action === 'create').length,
              overwrite: items.filter((item) => item.action === 'overwrite').length,
            }
          }),
          counts: plan.counts,
        }
      } else if (op === 'restore') {
        // 两种来源：上传的备份包（token）或备份目录里已有的产物（file）。
        const fromFile = String(payload.file ?? '') !== ''
        const record = fromFile ? undefined : uploads.get(String(payload.token ?? ''))
        if (!fromFile && record === undefined) throw new Error('备份包已过期（请重新上传），或不是本次会话上传的文件')
        let analysis
        let plan
        if (fromFile) {
          const inspected = await inspectBackupFile(String(payload.file))
          analysis = inspected.analysis
          plan = await planRestore(analysis, payload.sections)
        } else {
          analysis = analyzeBackup(record.buffer)
          plan = await planRestore(analysis, payload.sections)
        }
        const settings = await readSettings()
        // 恢复前的自动快照是**尽力而为**：当前配置本来就是空的（没有任何可备份文件）时，
        // 快照失败不该把恢复本身也挡下来——那会让「从一个空环境恢复配置」变得不可能。
        let snapshot = null
        let snapshotError
        const snapshotSections = payload.sections !== undefined && payload.sections.length > 0
          ? payload.sections
          : analysis.sections.map((section) => section.id)
        if (settings.backup.snapshotBeforeImport) {
          try {
            snapshot = await createBackup(snapshotSections, {
              label: 'before-restore',
              retention: settings.backup.retention,
            })
          } catch (error) {
            snapshotError = error?.message ?? String(error)
          }
        }
        const applied = await applyRestore(plan, { dryRun: payload.dryRun === true })
        if (!fromFile) uploads.delete(String(payload.token))
        extra = {
          written: applied.written.length,
          failed: applied.failed,
          snapshot: snapshot === null ? null : snapshot.file,
          snapshotError: snapshotError ?? null,
        }
      } else throw new Error(`备份分区不支持的操作：${String(op)}`)
    } else if (section === 'scan') {
      if (op !== 'import') throw new Error(`导入分区不支持的操作：${String(op)}`)
      const settings = await readSettings()
      const result = await importItems(payload.selection ?? {}, settings)
      if (result.mcp.imported.length > 0) await runtime.mcp.sync()
      if (result.skills.imported.length > 0) runtime.invalidateSkills()
      extra = result
    } else if (section === 'reveal') {
      // 打开目录 / 定位文件：这一步必须 await——失败（比如系统没有文件管理器）要变成界面上的错误，
      // 而不是静默什么都不发生。
      // 三个字段**原样透传**给 `reveal`：名字归一（`path` 优先、兼容旧客户端的 `dir`）只在那里判一次，
      // 免得这条分支和那个函数各持一套「哪个字段才算数」的规则（那正是这个按钮坏掉的原因）。
      extra = await reveal({ file: payload.file, path: payload.path, dir: payload.dir }, launch)
    } else {
      throw new Error(`未知分区：${String(section)}`)
    }
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error?.message ?? String(error) })
    return
  }
  sendJson(res, 200, { ok: true, ...(extra === undefined ? {} : { result: extra }), state: await buildState(runtime, workspaceOfPayload(payload)) })
  // 写成功就 bump 一次版本号：浏览器侧轮询 /revision，看到变化会重拉 state，避免与 Agent 的改动脱节。
  if (MUTATING_SECTIONS.has(section)) runtime.bumpRevision()
}

/** 会改数据的 section（reveal / mcp-sync 不算，它们不落盘）。 */
const MUTATING_SECTIONS = new Set(['rule', 'skill', 'memory', 'mcp', 'settings', 'backup', 'scan'])

/**
 * 把 API 挂到宿主 web 服务器上。
 *
 * @param ctx - 插件上下文（需要 `webServer`）。
 * @param runtime - 插件共享运行时。
 * @param options - 可选依赖：`launch` 是「打开目录 / 定位文件」用的启动器。
 *   缺省走系统文件管理器；单测注入假启动器——测试不该真在用户桌面上开出一排窗口。
 * @returns disposer。
 */
export function registerApi(ctx, runtime, options = {}) {
  if (ctx.webServer === undefined) return () => {}
  return ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    handler: (req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      handle(req, res, runtime, url, options.launch).catch((error) => {
        sendJson(res, 500, { ok: false, error: error?.message ?? String(error) })
      })
    },
  })
}
