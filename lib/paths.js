/**
 * 路径真源：本插件的用户数据根（`~/.dsh`）与 DSH 安装根（`$DSH_HOME`）。
 *
 * 全项目只有本模块拼接这两棵目录树，其他模块一律从这里 import，避免路径漂移。
 * MCP 服务器本体的安装位置由用户自行决定，本插件只管理 `mcp.json` 里的注册信息。
 *
 * 两棵树的区别：
 * - **数据根** `~/.dsh`：本插件自己管的数据（规则 / 技能 / MCP / 记忆 / 自己的设置与备份）。
 * - **安装根** `$DSH_HOME`：DSH 平台与其余插件的地盘（`settings.yaml`、`AGENTS.md`、
 *   `profiles/<name>/`）。备份要读它，但除「恢复」外本插件不写它。
 *
 * @module dsh-control-center/paths
 */

import { existsSync } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 用户级数据根目录（需求指定：系统用户目录下的 `.dsh`）。 */
export const DATA_ROOT = join(homedir(), '.dsh')

/** 规则目录：一条规则一个 `<slug>.md`（**全局规则**，对所有工作区生效）。 */
export const RULES_DIR = join(DATA_ROOT, 'rules')

/**
 * 项目规则在某工作区里的落点：`<工作区>/.dsh/rules/`。
 *
 * 与全局规则**同构**（一条规则一个 Markdown + 同一套 frontmatter），因此 UI、校验、注入渲染
 * 全部复用同一份实现；区别只在根目录与注入时的作用域过滤。
 * 放在工作区里的 `.dsh/` 下而不是根目录：一个文件夹可能同时是别的工具的工程根，
 * 把规则收进 `.dsh/` 才不会和它们的约定打架。
 *
 * @param workspace - 工作区绝对路径。
 * @returns 该项目规则目录的绝对路径。
 */
export function projectRulesDir(workspace) {
  return join(String(workspace ?? ''), '.dsh', 'rules')
}

/** 技能目录：`<name>/SKILL.md` 或平铺 `<name>.md`，与规则目录严格分开。 */
export const SKILLS_DIR = join(DATA_ROOT, 'skills')

/** 长期记忆目录：一条记忆一个 `<slug>.md`，frontmatter 记录作用域。 */
export const MEMORY_DIR = join(DATA_ROOT, 'memory')

/** MCP 服务器注册表。 */
export const MCP_FILE = join(DATA_ROOT, 'mcp.json')

/** 本插件自己的配置与产物目录。 */
export const CONFIG_DIR = join(DATA_ROOT, 'control-center')

/** 本插件设置（提示词优化、扫描源、界面偏好）。 */
export const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')

/** 备份产物目录（导出的 zip 落在这里，用户可自行复制走）。 */
export const BACKUP_DIR = join(CONFIG_DIR, 'backups')

/**
 * 规则注入的字节硬上限：强加载正文 + 其余规则索引合计不得超过它。
 *
 * 取 32 KiB：要能装下「驾驭工程核心规则」这类整篇常驻的硬规则（约 16 KB）再加十几条按需规则的
 * 索引，同时仍只有平台 `dsh-agent-instructions` 全局预算（64 KiB）的一半，不至于挤占任务上下文。
 * 超预算时强加载规则会降级为索引行（见 `rules.js`），因此调小它是安全的。
 */
export const MAX_INJECT_BYTES = 32768

/**
 * 记忆注入的字节硬上限。
 *
 * 记忆与规则共用「每步都注入」的位置，因此同样要克制：默认只常驻最相关的若干条，
 * 超预算的条目降级为「标题 + 文件路径」，模型需要时自己 `read`。
 */
export const MAX_MEMORY_INJECT_BYTES = 8192

/**
 * 单次备份包含的字节上限。
 *
 * 打包是在内存里拼一个 zip（本插件零依赖，没有流式写包器），所以要给内存画一条硬线：
 * 64 MiB 已经远超「规则 + 技能 + MCP + 记忆 + 插件清单」的正常体量（通常几百 KB），
 * 真撞上说明用户勾了一个本不该备份的目录——此时明确跳过并报告，比把内存吃满好。
 */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024

/**
 * DSH 安装根目录（`$DSH_HOME`）。
 *
 * 每次调用重新读环境变量：DSH 的启动器可能在模块加载之后才设置它（平台自己也是这么做的），
 * 因此不能在模块顶层缓存成常量。
 *
 * @returns 安装根绝对路径。
 */
export function harnessRoot() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness')
  }
  return join(homedir(), '.dsh')
}

/** profile 根目录（`$DSH_HOME/profiles/<name>`）。 */
export function profileDir(profile) {
  return join(harnessRoot(), 'profiles', profile)
}

/**
 * 当前正在运行本插件的 profile 名。
 *
 * 判定顺序（每一步都只看磁盘，不猜）：
 * 1. `$DSH_HOME/profiles/<name>/node_modules/dsh-control-center` 存在 → 就是它（通常只有一个）；
 * 2. 命令行参数里的 `--profile <name>`；
 * 3. 兜底 `web`（桌面壳的默认 profile）。
 *
 * @returns profile 名。
 */
export function resolveProfileName() {
  const root = harnessRoot()
  try {
    const names = readdirSync(join(root, 'profiles'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(root, 'profiles', name, 'node_modules', 'dsh-control-center')))
    if (names.length > 0) return names[0]
  } catch {
    // profiles 目录不存在（首次安装）时继续走命令行与兜底。
  }
  const argv = process.argv ?? []
  const index = argv.indexOf('--profile')
  if (index >= 0 && typeof argv[index + 1] === 'string' && argv[index + 1].length > 0) return argv[index + 1]
  return 'web'
}

/**
 * 已被某个 profile 安装的插件包名清单（读 profile 的 `package.json`）。
 *
 * @param profile - profile 名。
 * @returns `{ dependencies, bundles }`，读取失败时两者都是空对象/空数组。
 */
export function readProfileManifest(profile) {
  const file = join(profileDir(profile), 'package.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return {
      dependencies: parsed?.dependencies ?? {},
      bundles: Array.isArray(parsed?.dsh?.profile?.bundles) ? parsed.dsh.profile.bundles : [],
    }
  } catch {
    return { dependencies: {}, bundles: [] }
  }
}
