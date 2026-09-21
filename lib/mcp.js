/**
 * MCP 运行时：把 `~/.dsh/mcp.json` 里的服务器注册信息变成真正可用的工具。
 *
 * **持久化天然成立**：`apply()` 每次启动都按 mcp.json 重新挂载，所以文件本身就是真源，
 * 不需要再往 profile 的 `cordis.patch.yml` 写一份镜像配置——也就不会有「两份配置互相漂移」
 * 和「必须重启桌面壳才生效」的问题。改动只发生在运行时（挂载/卸载/重挂），立即生效。
 *
 * 挂载位置说明：本插件是 profile 级插件（根 realm），子 fiber 与 agent preset 的
 * `isolate` realm 无关；工具注册表按作用域层持有定义，agent 继承全局工具，
 * 因此这里挂载出的 `mcp__<name>__<tool>` 对每个 agent 可见。
 *
 * @module dsh-control-center/mcp
 */

import { readMcp } from './store.js'

/** 把本插件的服务器条目翻译成 `dsh-mcp-client` 的 Config 形状。 */
function toClientConfig(server) {
  const config = {
    serverName: server.name,
    transport: server.transport,
  }
  if (server.transport === 'stdio') {
    config.command = server.command
    config.args = server.args
    if (Object.keys(server.env ?? {}).length > 0) config.env = server.env
    if (server.cwd !== undefined) config.cwd = server.cwd
  } else {
    config.url = server.url
    if (Object.keys(server.headers ?? {}).length > 0) config.headers = server.headers
  }
  if (server.toolCallTimeoutMs !== undefined) config.toolCallTimeoutMs = server.toolCallTimeoutMs
  if (server.failOnStartupError === true) config.failOnStartupError = true
  return config
}

/** 两份配置是否等价（用于判断某个服务器需要重挂还是可以原样保留）。 */
function sameConfig(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * MCP 服务器的运行时管理器。
 *
 * 持有每个已挂载服务器的 fiber 与最近一次结果，供 HTTP API 汇报状态。
 */
export class McpRuntime {
  /**
   * @param ctx - 插件上下文（必须是 profile 级，工具才能被所有 agent 继承）。
   */
  constructor(ctx) {
    this.ctx = ctx
    /** @type {Map<string, { fiber: unknown, config: object }>} */
    this.mounted = new Map()
    /** @type {Map<string, { state: string, error?: string, tools?: number }>} */
    this.status = new Map()
  }

  /** 按需加载 MCP 客户端插件；加载失败时返回 `undefined` 并让调用方汇报原因。 */
  async loadClient() {
    if (this.client !== undefined) return this.client
    try {
      const module = await import('@deepseek-ai/dsh-mcp-client')
      this.client = module
      return module
    } catch (error) {
      this.client = null
      this.loadError = `无法加载 @deepseek-ai/dsh-mcp-client：${error?.message ?? String(error)}`
      return undefined
    }
  }

  /**
   * 用客户端插件自带的 Config schema 校验/补默认值。
   *
   * schema 可调用时用它验证（非法配置在这一步就报错，而不是等连接失败）；
   * 不可调用时退回原样传参，并把原因记进状态里，避免静默吞掉校验能力的缺失。
   */
  validate(client, config) {
    const schema = client?.Config
    if (typeof schema !== 'function') return { config, note: 'mcp-client 未导出可调用的 Config，已跳过 schema 校验' }
    return { config: schema(config), note: undefined }
  }

  /** 卸载一个已挂载的服务器。 */
  async unmount(name) {
    const entry = this.mounted.get(name)
    if (entry === undefined) return
    this.mounted.delete(name)
    try {
      await entry.fiber?.dispose?.()
    } catch (error) {
      this.status.set(name, { state: 'error', error: `卸载失败：${error?.message ?? String(error)}` })
    }
  }

  /**
   * 与 `mcp.json` 对账：挂载新增/变更的服务器，卸载被删除或停用的服务器。
   *
   * 单个服务器挂载失败**不影响其他服务器**——失败只写进该条的状态里，设置页据此显示原因。
   *
   * @returns 每个服务器的状态映射。
   */
  async sync() {
    const { servers, error } = await readMcp()
    if (error !== undefined) {
      this.status.clear()
      this.status.set('__file__', { state: 'error', error })
      return this.snapshot()
    }

    const client = await this.loadClient()
    if (client === undefined) {
      for (const server of servers) {
        if (server.enabled === false) continue
        this.status.set(server.name, { state: 'error', error: this.loadError })
      }
      return this.snapshot()
    }

    const wanted = new Map(
      servers.filter((server) => server.enabled !== false).map((server) => [server.name, toClientConfig(server)]),
    )

    // 卸载：已不在名单里、被停用、或配置已变的（配置变了一律重挂，不做原地热改）。
    for (const [name, entry] of [...this.mounted]) {
      const next = wanted.get(name)
      if (next === undefined) {
        await this.unmount(name)
        this.status.delete(name)
        continue
      }
      if (!sameConfig(entry.config, next)) {
        await this.unmount(name)
        this.status.delete(name)
      }
    }

    // 挂载新增与刚被卸载的。
    for (const [name, raw] of wanted) {
      if (this.mounted.has(name)) continue
      try {
        const { config, note } = this.validate(client, raw)
        const fiber = await this.ctx.plugin(client, config)
        this.mounted.set(name, { fiber, config })
        this.status.set(name, note === undefined ? { state: 'mounted' } : { state: 'mounted', error: note })
      } catch (error) {
        this.status.set(name, {
          state: 'error',
          error: `挂载失败：${error?.message ?? String(error)}`,
        })
      }
    }

    // 停用的服务器也要有可见状态，否则 UI 上会像「凭空消失」。
    for (const server of servers) {
      if (server.enabled === false) this.status.set(server.name, { state: 'disabled' })
    }
    return this.snapshot()
  }

  /** 当前状态快照（纯数据，可安全序列化给浏览器）。 */
  snapshot() {
    return Object.fromEntries(this.status)
  }

  /** 卸载全部已挂载服务器（插件 dispose 时调用）。 */
  async dispose() {
    for (const name of [...this.mounted.keys()]) await this.unmount(name)
    this.status.clear()
  }
}
