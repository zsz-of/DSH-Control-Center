/**
 * 自动换模型：某个提供方报**余额不足**时，把当前会话切到别的提供方的模型，并代发一条「继续」。
 *
 * 触发信号是会话事件 `turn/end` 上的错误码（平台自己的适配器就是这么报余额不足的）：
 * `@deepseek-ai/dsh-llm` 导出 `QUOTA_EXCEEDED_CODE = "QUOTA"` 与
 * `ACCOUNT_QUOTA_EXCEEDED_CODE = "ACCOUNT_QUOTA"`，客户端 ui-chat 的配额提示读的也是同一处。
 *
 * **为什么不是简单换个全局默认**：用户要求「只改当前这条会话」。平台有两条路——
 * `sessionController.selectModel()` 会顺带把全局默认也存掉（平台自己的模型选择器就是这样），
 * 而 `sessionController.agents.selectForNextRequest(agent, selection)` 只把选择写进这条会话
 * （`model/selection` 事件 + 内存里那份选择），不动全局默认。这里走后者。
 *
 * **子代理与智能体团队**：它们也都是「有 live agent 的会话」，事件里的 sessionId 一样能拿到
 * agent（`ctx.agents.get(id)`），换的也是那个子会话自己的模型——不需要另一套逻辑。
 *
 * @module dsh-control-center/model-switch
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readSettings } from './settings.js'

/** 余额不足的错误码（平台 `@deepseek-ai/dsh-llm` 的同一对常量）。 */
export const QUOTA_CODES = new Set(['QUOTA', 'ACCOUNT_QUOTA'])

/** 等级上限（设置里只允许 1|2|3）。 */
const MAX_TIER = 3

/** `provider/model` 键（设置里等级表与屏蔽项都用它）。 */
export function routeKey(provider, model) {
  return `${String(provider ?? '')}/${String(model ?? '')}`
}

/**
 * 从一条会话事件里取「余额不足」的错误码。
 *
 * 形状与客户端 ui-chat 的配额提示一致：`turn/end` → `data.reason.kind === 'error'` →
 * `data.reason.error.code`。不带 `turn/end` 或不是错误结束时返回 `undefined`。
 *
 * @param event - 会话事件。
 * @returns 命中的错误码，或 `undefined`。
 */
export function quotaCodeOf(event) {
  if (event === null || typeof event !== 'object') return undefined
  if (event.type !== 'turn/end') return undefined
  const reason = event.data?.reason
  if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') return undefined
  const code = reason.error?.code
  return typeof code === 'string' && QUOTA_CODES.has(code) ? code : undefined
}

/**
 * 把平台 `sessionController.modelCatalog()` 的结果收敛成本模块要用的形状。
 *
 * 只依赖两个字段：提供方 `id`、它的 `models[].id`（外加可选的 `name` 与默认思考档）。
 * 平台换个形状时丢的是显示名，不是换源能力。
 *
 * @param raw - `modelCatalog()` 的返回值。
 * @returns `{ providers: [{ id, name, models: [{ id, name, effort }] }] }`。
 */
export function normalizeCatalog(raw) {
  const groups = Array.isArray(raw?.groups) ? raw.groups : []
  const providers = []
  for (const group of groups) {
    if (group === null || typeof group !== 'object') continue
    const id = typeof group.id === 'string' ? group.id : ''
    if (id === '') continue
    const models = []
    for (const model of Array.isArray(group.models) ? group.models : []) {
      if (model === null || typeof model !== 'object') continue
      const modelId = typeof model.id === 'string' ? model.id : ''
      if (modelId === '') continue
      const effort = typeof model.reasoning?.defaultEffort === 'string' ? model.reasoning.defaultEffort : undefined
      models.push({ id: modelId, name: typeof model.name === 'string' ? model.name : modelId, effort })
    }
    providers.push({ id, name: typeof group.name === 'string' ? group.name : id, models })
  }
  return { providers }
}

/**
 * 按设置的层级顺序排提供方。
 *
 * `providerOrder` 里没提到的提供方接在后面（按目录顺序）——新装的提供方不该因为「还没排序」
 * 就永远轮不到，但也不该插到用户排好的层级中间。
 *
 * @param providers - 目录里的提供方。
 * @param order - 设置里的 `providerOrder`。
 * @returns 排好序的提供方数组。
 */
export function orderProviders(providers, order) {
  const listed = Array.isArray(order) ? order.filter((id) => typeof id === 'string' && id !== '') : []
  const rank = new Map()
  listed.forEach((id, index) => rank.set(id, index))
  // 没排过的接在后面，保持目录里的相对顺序。
  const tail = new Map()
  let next = listed.length
  for (const provider of providers) {
    if (rank.has(provider.id)) continue
    tail.set(provider.id, next)
    next += 1
  }
  return [...providers].sort(
    (left, right) => (rank.get(left.id) ?? tail.get(left.id) ?? 0) - (rank.get(right.id) ?? tail.get(right.id) ?? 0),
  )
}

/**
 * 选下一个模型（纯函数，便于单测）。
 *
 * 规则（按用户裁决）：
 * 1. 只在**比失败提供方更低层**的提供方里选（`providerOrder` 的顺序即层级，只能向下换）；
 * 2. 同级优先：与失败模型**同等级**的候选排第一；
 * 3. 没有同级的就**降一级**（等级数字 +1）；
 * 4. 还没轮到时，**未分级**的模型作为末位候补；
 * 5. 屏蔽项里的模型永不入选；同提供方不选（余额不足是提供方/账号级的）。
 *
 * @param options - `{ catalog, policy, failed }`。
 * @returns `{ provider, model, tier, effort }` 或 `undefined`（没有可换的）。
 */
export function chooseRoute({ catalog, policy, failed }) {
  const providers = orderProviders(normalizeCatalog(catalog).providers, policy?.providerOrder)
  const failedProvider = String(failed?.provider ?? '')
  const failedModel = String(failed?.model ?? '')
  if (failedProvider === '' || failedModel === '') return undefined
  const failedIndex = providers.findIndex((provider) => provider.id === failedProvider)
  if (failedIndex < 0) return undefined
  const lower = providers.slice(failedIndex + 1)
  if (lower.length === 0) return undefined

  const tiers = policy?.tiers ?? {}
  const blocked = new Set(Array.isArray(policy?.blocked) ? policy.blocked : [])
  const failedTier = tiers[routeKey(failedProvider, failedModel)]

  const candidates = []
  for (const provider of lower) {
    for (const model of provider.models) {
      const key = routeKey(provider.id, model.id)
      if (blocked.has(key)) continue
      candidates.push({ provider: provider.id, model: model.id, tier: tiers[key], effort: model.effort })
    }
  }
  if (candidates.length === 0) return undefined

  /** 三趟：同级 → 降一级 → 未分级兜底；每趟内部保持「提供方层级 → 目录顺序」。 */
  const passes = []
  if (Number.isInteger(failedTier)) {
    passes.push((candidate) => candidate.tier === failedTier)
    if (failedTier < MAX_TIER) passes.push((candidate) => candidate.tier === failedTier + 1)
  }
  passes.push((candidate) => candidate.tier === undefined)
  for (const match of passes) {
    const hit = candidates.find(match)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * 自动换源引擎。
 *
 * 由 `lib/index.js` 用 `ctx.on('session/event', …)` 接上；`sessionController` 缺席时
 * （精简组合）整个功能静默不生效——它是可选依赖，不能让插件加载失败。
 */
export class ModelSwitcher {
  /**
   * @param options - `{ ctx, runtime, logger }`。
   */
  constructor({ ctx, runtime, logger = console }) {
    this.ctx = ctx
    this.runtime = runtime
    this.logger = logger
    /** `sessionController` 就绪后由 {@link connectController} 填上。 */
    this.controller = undefined
  }

  /** 接上平台会话控制器（它提供目录、会话级换模型与发消息）。 */
  connectController(controller) {
    this.controller = controller
  }

  /** 读一次模型目录；取不到时返回空目录而不是抛错。 */
  async catalog() {
    try {
      return await this.controller.modelCatalog()
    } catch (error) {
      this.logger.warn?.(`[control-center] 读模型目录失败，自动换源跳过本次：${String(error)}`)
      return { groups: [] }
    }
  }

  /**
   * 处理一条会话事件。
   *
   * @param subject - 事件主体（Session）。
   * @param event - 会话事件。
   * @returns 无。
   */
  async handleEvent(subject, event) {
    const code = quotaCodeOf(event)
    if (code === undefined) return
    const sessionId = typeof subject?.id === 'string' ? subject.id : ''
    if (sessionId === '') return
    try {
      await this.switchFor(sessionId, code)
    } catch (error) {
      this.logger.warn?.(`[control-center] 自动换源失败（${sessionId}）：${String(error)}`)
    }
  }

  /**
   * 给一条会话换模型并代发「继续」。
   *
   * @param sessionId - 会话 id（普通会话、子代理会话、智能体团队的会话都一样）。
   * @param code - 触发换源的错误码（写进提示里）。
   * @returns 换源结果 `{ ok, from, to, text }`。
   */
  async switchFor(sessionId, code = 'QUOTA') {
    if (this.controller === undefined) return { ok: false, reason: 'controller-unavailable' }
    const settings = await readSettings()
    if (settings.models.autoSwitch !== true) return { ok: false, reason: 'disabled' }

    const agent = this.ctx.agents?.get?.(sessionId)
    if (agent === undefined) return { ok: false, reason: 'session-not-live' }

    // 这条会话此刻用的是哪条路由：就是刚刚报余额不足的那条。
    let failed
    try {
      failed = this.controller.agents?.selectionFor?.(agent)?.current
    } catch {
      failed = undefined
    }
    const from = { provider: String(failed?.provider ?? ''), model: String(failed?.model ?? '') }
    if (from.provider === '' || from.model === '') return { ok: false, reason: 'route-unknown' }

    const catalog = await this.catalog()
    const next = chooseRoute({ catalog, policy: settings.models, failed: from })
    if (next === undefined) {
      const text = `「${from.provider}/${from.model}」报余额不足，但没有可自动切换的模型（检查控制中心 → 模型里的等级、屏蔽项与提供方层级）。`
      this.notice(sessionId, { ok: false, code, from, to: null, text })
      return { ok: false, reason: 'no-candidate', text }
    }

    const selection = { provider: next.provider, model: next.model }
    if (typeof next.effort === 'string' && next.effort !== '') selection.reasoningEffort = next.effort
    // 只改这条会话：append(`model/selection`) + 更新内存里那份选择；**不碰全局默认模型**。
    this.controller.agents.selectForNextRequest(agent, selection)

    const text = `继续（控制中心已自动换源：「${from.provider}/${from.model}」报余额不足 → 已切到「${next.provider}/${next.model}」）`
    const sent = await this.resume(sessionId, agent, text)
    this.notice(sessionId, { ok: true, code, from, to: { provider: next.provider, model: next.model }, text, resumed: sent })
    return { ok: true, from, to: selection, text, resumed: sent }
  }

  /**
   * 代发一条用户消息（默认 `followup`：排在当前工作之后，等价于用户自己发的下一条）。
   *
   * 先走平台的会话命令（它的语义最完整：来源标记、附件绑定、忙碌判定）；
   * 子代理会话可能被平台以「子代理所有权」拒掉，那时退回 agent 自己的 `followup`。
   *
   * @param sessionId - 会话 id。
   * @param agent - live agent。
   * @param text - 正文。
   * @returns 是否发出去了。
   */
  async resume(sessionId, agent, text) {
    const content = [{ type: 'text', text }]
    if (typeof this.controller.prompt === 'function') {
      try {
        await this.controller.prompt({ sessionId, content })
        return true
      } catch (error) {
        this.logger.warn?.(`[control-center] 代发「继续」走了平台通道被拒，改用 agent.followup：${String(error)}`)
      }
    }
    try {
      agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
      return true
    } catch (error) {
      this.logger.warn?.(`[control-center] 代发「继续」失败：${String(error)}`)
      return false
    }
  }

  /** 记下这次换源（浏览器侧据此提示 + 高亮模型下拉）。 */
  notice(sessionId, payload) {
    if (this.runtime?.modelSwitches === undefined) return
    this.runtime.modelSwitches.set(sessionId, { at: Date.now(), acknowledged: false, ...payload })
    this.runtime.bumpRevision?.()
  }
}
