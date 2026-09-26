/**
 * 本插件自己的设置：`~/.dsh/control-center/settings.json`。
 *
 * **为什么不挂在 `ctx.settings` 上**：平台的 settings 服务是「插件声明 schema + 平台落盘」，
 * 读写在同一次进程内是异步的，而本插件的设置要同时服务浏览器侧（HTTP API）与 host 侧的
 * 提示词优化、记忆注入等热路径。放在自己数据根下的一个 JSON 里，读写都是显式的、
 * 可以脱离 cordis 单测，也不会与其他插件的 schema 迁移互相牵制。
 *
 * 读取一律**合并到默认值之上并逐字段校验类型**：手工改坏的字段退回默认值而不是让整页崩掉。
 *
 * @module dsh-control-center/settings
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONFIG_DIR, SETTINGS_FILE, harnessRoot } from './paths.js'

/** 全部默认值——UI 与 host 共用这一份，避免两处漂移。 */
export const DEFAULT_SETTINGS = {
  optimize: {
    /** 是否在输入框显示 ✨ 优化按钮。 */
    enabled: true,
    /** 空字符串 = 跟随 DSH 默认模型（见 {@link dshDefaultModel}）。 */
    provider: '',
    model: '',
    /** 空字符串 = 用适配器默认思考强度。 */
    reasoningEffort: '',
    /** 自定义系统提示词；空字符串 = 内置提示词。 */
    prompt: '',
  },
  memory: {
    /** 记忆总开关：关掉后既不注入也不接受自动提炼。 */
    enabled: true,
    /** 是否把启用的记忆注入每个会话。 */
    inject: true,
  },
  rules: {
    /**
     * AI 改规则前的审批档位（见 {@link RULE_APPROVALS}）。
     * 默认「每次询问」，与平台自带的行为一致，不替用户做主张。
     */
    approval: 'ask',
    /**
     * 「此工作区内始终允许」豁免的工作区绝对路径。
     *
     * 只有用户在审批弹框上亲自点过那一项才会写进来（界面里可以清除），不受档位切换影响——
     * 档位临时改成「始终允许」再改回来时，豁免不该悄悄丢掉。
     */
    allowedWorkspaces: [],
  },
  backup: {
    /** 备份目录里保留多少个产物，超出的从最旧的开始删；0 = 不清理。 */
    retention: 20,
    /** 导入前是否自动先导出一份当前配置（默认开，出事能回退）。 */
    snapshotBeforeImport: true,
  },
  scan: {
    /** 关闭某些扫描源（默认全开；存的是被**关闭**的 id）。 */
    disabled: [],
    /** 用户自定义源：`{ id, label, kind: json|toml|dir, path, mcpKey?, section? }`。 */
    custom: [],
  },
  ui: {
    /** 打开设置页时默认停留的标签页。 */
    defaultTab: 'rule',
  },
}

/** 允许出现在 UI 上的标签页 id（防止手工改配置写进一个渲染不出来的值）。 */
export const TAB_IDS = ['rule', 'mcp', 'skill', 'memory', 'scan', 'backup', 'settings']

/**
 * 「AI 改规则」的三档审批（对应 `settings.rules.approval`），顺序即界面顺序：
 *
 * - `ask`：每次询问（默认）——闸门自己弹一个四按钮的框，用户选什么就做什么；
 * - `allow`：始终允许，直接放行；
 * - `deny-always`：禁止且不再询问，一律拒绝。
 *
 * 「禁止一次」**不是档位**：它只是那个弹框上的一个按钮（拒掉这一次，档位不动）。老版本把它存成
 * `deny-once` 档位，这里不再认识它，读到时自动退回 `ask`。
 *
 * 这个开关是**插件自己**的，与平台的权限预设（`permission.defaultPreset`）无关：预设的
 * `approval: never` 只在闸门退回平台审批通道时才看得见（那时平台会在弹窗前直接判 rejected）。
 */
export const RULE_APPROVALS = ['ask', 'allow', 'deny-always']

/** 深拷贝默认值（结构化克隆，避免调用方改到常量）。 */
function defaults() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
}

/** 取字符串，非字符串一律退回兜底值。 */
function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

/** 取布尔，严格 `true` 才算真（其余走兜底）。 */
function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** 取非负整数。 */
function count(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

/**
 * 把任意输入规整成一份合法设置。
 *
 * @param raw - 来自磁盘或 UI 的原始对象。
 * @returns 补齐默认值后的设置对象。
 */
export function normalizeSettings(raw) {
  const base = defaults()
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const optimize = source.optimize ?? {}
  const memory = source.memory ?? {}
  const rules = source.rules ?? {}
  const backup = source.backup ?? {}
  const scan = source.scan ?? {}
  const ui = source.ui ?? {}
  const custom = Array.isArray(scan.custom) ? scan.custom : []
  return {
    optimize: {
      enabled: bool(optimize.enabled, base.optimize.enabled),
      provider: text(optimize.provider, ''),
      model: text(optimize.model, ''),
      reasoningEffort: text(optimize.reasoningEffort, ''),
      prompt: text(optimize.prompt, ''),
    },
    memory: {
      enabled: bool(memory.enabled, base.memory.enabled),
      inject: bool(memory.inject, base.memory.inject),
    },
    rules: {
      approval: RULE_APPROVALS.includes(rules.approval) ? rules.approval : base.rules.approval,
      allowedWorkspaces: [
        ...new Set(
          (Array.isArray(rules.allowedWorkspaces) ? rules.allowedWorkspaces : [])
            .filter((item) => typeof item === 'string' && item.trim() !== '')
            .map((item) => item.trim()),
        ),
      ],
    },
    backup: {
      retention: count(backup.retention, base.backup.retention),
      snapshotBeforeImport: bool(backup.snapshotBeforeImport, base.backup.snapshotBeforeImport),
    },
    scan: {
      disabled: (Array.isArray(scan.disabled) ? scan.disabled : []).filter((id) => typeof id === 'string'),
      custom: custom
        .filter((item) => item !== null && typeof item === 'object')
        .map((item) => ({
          id: text(item.id, '').trim(),
          label: text(item.label, '').trim(),
          kind: ['json', 'toml', 'dir'].includes(item.kind) ? item.kind : 'json',
          path: text(item.path, '').trim(),
          ...(text(item.mcpKey, '').trim() === '' ? {} : { mcpKey: text(item.mcpKey).trim() }),
          ...(text(item.section, '').trim() === '' ? {} : { section: text(item.section).trim() }),
        }))
        .filter((item) => item.id !== '' && item.path !== ''),
    },
    ui: {
      defaultTab: TAB_IDS.includes(ui.defaultTab) ? ui.defaultTab : base.ui.defaultTab,
    },
  }
}

/**
 * 读取设置。文件不存在或损坏时返回默认值（首次使用是正常状态，不是错误）。
 *
 * @returns 设置对象。
 */
export async function readSettings() {
  try {
    return normalizeSettings(JSON.parse(await readFile(SETTINGS_FILE, 'utf8')))
  } catch {
    return defaults()
  }
}

/**
 * 覆盖写入设置。
 *
 * @param patch - 部分设置；与当前值深合并后落盘。
 * @returns 落盘后的完整设置。
 */
export async function writeSettings(patch) {
  const current = await readSettings()
  const next = normalizeSettings({
    optimize: { ...current.optimize, ...(patch?.optimize ?? {}) },
    memory: { ...current.memory, ...(patch?.memory ?? {}) },
    rules: { ...current.rules, ...(patch?.rules ?? {}) },
    backup: { ...current.backup, ...(patch?.backup ?? {}) },
    scan: { ...current.scan, ...(patch?.scan ?? {}) },
    ui: { ...current.ui, ...(patch?.ui ?? {}) },
  })
  await mkdir(dirname(SETTINGS_FILE), { recursive: true })
  await writeFile(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** 读取设置文件所在目录（UI 上「打开目录」用）。 */
export const settingsDir = CONFIG_DIR

/**
 * DSH 全局默认模型（`$DSH_HOME/settings.yaml` 的 `agent-default-model`）。
 *
 * 只解析需要的两行：平台写这个文件时是「顶层块 + 两格缩进的键值」，因此一个两层的
 * 极简 YAML 读取就够，不引入 YAML 依赖。读不到时返回 `undefined`，由调用方决定兜底。
 *
 * @returns `{ provider, model }` 或 `undefined`。
 */
export async function dshDefaultModel() {
  let raw
  try {
    raw = await readFile(join(harnessRoot(), 'settings.yaml'), 'utf8')
  } catch {
    return undefined
  }
  let inside = false
  const found = {}
  for (const line of raw.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inside = /^agent-default-model\s*:/.test(line)
      continue
    }
    if (!inside) continue
    const match = /^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (value !== '') found[match[1]] = value
  }
  if (found.provider === undefined || found.model === undefined) return undefined
  return { provider: found.provider, model: found.model }
}
