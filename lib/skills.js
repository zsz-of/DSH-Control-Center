/**
 * 技能提供方：把 `~/.dsh/skills` 里的技能注册进 DSH 的技能 registry。
 *
 * **为什么由本插件提供 provider，而不是给 `dsh-skill-filesystem` 加一个根目录**：
 * 在当前 web 组合里，host 层的 `skill-filesystem` 被 `dsh-web-app` **刻意禁用**
 * （注释原话：本地发现由每个 agent preset 自己挂载），因此往那行写 `customSkillDirs` 是死配置。
 * 而技能 registry 是「host + 按作用域分层」的：**仓库插件注册进它的全局层**，
 * 每个 agent 读自己作用域链选出的合并 catalog——这正是本插件的官方接缝。
 *
 * 采用的契约（对照 `dsh-skill-filesystem` 的实现）：
 * - `registerProvider(create)`，`create(control)` 返回 provider；`control` 提供 `invalidate` 与 `signal`。
 * - `list(options)` 返回候选数组，候选带 `name / description / whenToUse? / invocation /
 *   provider / source / rank / locator / resourceBase / path`。
 * - `get(candidate, options)` 返回含 `content` 的完整技能；文件消失时返回 `undefined`。
 *
 * rank 选 300（`custom`，即「其他本地 skill 根目录」那一档），低于平台自己的用户根（400）——
 * 同名技能时平台既有目录优先，本插件不遮蔽已有技能。
 *
 * @module dsh-control-center/skills
 */

import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseDocument } from './profile.js'
import { SKILLS_DIR } from './paths.js'
import { listSkills } from './store.js'

const PROVIDER_NAME = 'control-center'
const SOURCE = 'custom'
const RANK = 300

/** 从 frontmatter 解析调用策略（与平台同一套键名）。 */
function invocationOf(data) {
  return {
    modelInvocable: data['disable-model-invocation'] !== true,
    userInvocable: data['user-invocable'] !== false,
  }
}

/** `~/.dsh/skills` 的技能提供方。 */
export class ControlCenterSkillProvider {
  /**
   * @param control - registry 给出的控制句柄（`invalidate` / `signal`）。
   */
  constructor(control) {
    this.name = PROVIDER_NAME
    this.control = control
    // 本提供方不持有 watcher 等宿主资源，但 registry 的 provider 契约里
    // dispose 是生命周期钩子，保留它以符合契约（文件变化靠调用方 invalidate 刷新）。
    control?.signal?.addEventListener('abort', () => this.dispose(), { once: true })
  }

  /**
   * 列出候选技能。
   *
   * 调用策略的四种组合都要列出——`disable-model-invocation` 的技能只服务「用户手动调用」
   * 这一个入口，过滤掉它会让那个入口失效。
   *
   * **唯一被过滤掉的是「控制中心里关掉」的技能**（frontmatter `enabled: false`）：
   * 这类技能对 agent 完全不存在，所以它既不进注入的技能目录、也不会出现在 `/` 菜单里。
   */
  async list() {
    const items = await listSkills()
    return items
      .filter((item) => item.error === undefined && item.enabled !== false)
      .map((item) => ({
        name: item.id,
        description: item.description,
        ...(item.whenToUse.length > 0 ? { whenToUse: item.whenToUse } : {}),
        invocation: { modelInvocable: item.modelInvocable, userInvocable: item.userInvocable },
        provider: PROVIDER_NAME,
        source: SOURCE,
        rank: RANK,
        locator: {
          path: item.path,
          directory: item.kind === 'bundle' ? dirname(item.path) : SKILLS_DIR,
        },
        resourceBase: {
          kind: 'directory',
          path: item.kind === 'bundle' ? dirname(item.path) : SKILLS_DIR,
        },
        path: item.path,
      }))
  }

  /**
   * 读取胜出候选的完整正文。
   *
   * 直接按 `locator.path` 读单文件，不再扫目录——`get` 会被频繁调用，省一次 readdir。
   *
   * @param candidate - {@link list} 返回的候选。
   * @param options - 含 `signal`，用于取消读取。
   * @returns 完整技能，或 `undefined`（文件已被删除时）。
   */
  async get(candidate, options) {
    const path = candidate?.locator?.path ?? candidate?.path
    if (typeof path !== 'string') return undefined
    let raw
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined
      throw error
    }
    options?.signal?.throwIfAborted?.()
    const { data, body } = parseDocument(raw)
    const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : candidate.name
    const description = typeof data.description === 'string' ? data.description : ''
    if (description.length === 0) return undefined
    return {
      name,
      description,
      ...(typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? { whenToUse: data.whenToUse } : {}),
      invocation: invocationOf(data),
      source: SOURCE,
      provider: PROVIDER_NAME,
      resourceBase: candidate.resourceBase,
      path,
      content: body.replace(/^\s*\n/, '').replace(/\s+$/, ''),
    }
  }

  /** 释放本提供方（当前无宿主资源，符合 registry 的 provider 契约）。 */
  dispose() {
    this.control = undefined
  }
}

/**
 * 把技能提供方挂到 registry 上。
 *
 * `onControl` 是必需的接线：registry 只把 `control`（含 `invalidate`）交给 provider 工厂，
 * 而设置页写完文件后必须**主动通知 registry 目录已变**，否则技能目录会一直停在旧快照上。
 * 通过回调把 control 交给调用方持有，避免在模块里存全局可变状态。
 *
 * @param ctx - 插件上下文（需要 `skills` 服务）。
 * @param onControl - 工厂被调用时收到 control 句柄。
 * @returns `registerProvider` 返回的 disposer。
 */
export function registerSkillProvider(ctx, onControl) {
  return ctx.skills.registerProvider((control) => {
    onControl(control)
    return new ControlCenterSkillProvider(control)
  })
}

/** 平台加载技能正文的那个工具（`dsh-tool-skill`）。 */
export const SKILL_TOOL_NAME = 'skill'

/**
 * 拦住对「已被用户关掉」的技能的调用。
 *
 * 为什么需要它：技能从目录里摘掉之后，模型仍可能凭**旧上下文里残留的名字**再调一次
 * （长会话里最容易出现）。那时平台只会给一个「没有这个技能」的模糊错误，模型往往会换个名字
 * 反复试。这里直接给出准确原因，一次说清「是用户关掉的、去哪里打开」。
 *
 * 用户的 `/名称` 手动调用不需要在这里拦：技能不在目录里，`/` 菜单里也就不会有它。
 *
 * @param ctx - 带 `tools` 服务的上下文。
 * @returns 事件 disposer。
 */
export function registerDisabledSkillGate(ctx) {
  return ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec?.name !== SKILL_TOOL_NAME) return next()
    const name = typeof exec.arguments?.name === 'string' ? exec.arguments.name : ''
    if (name === '') return next()
    const disabled = (await listSkills()).find((item) => item.id === name && item.enabled === false)
    if (disabled === undefined) return next()
    return {
      kind: 'deny',
      reason: `技能「${name}」已被用户在控制中心关闭，本次调用不执行。要使用它，请先在「控制中心 → 技能」里重新启用。`,
    }
  })
}
