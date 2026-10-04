/**
 * 与核心**真实工具运行时**（`@deepseek-ai/dsh-tools` 的 `ToolRuntime`，服务名 `tools`）对表的集成测试。
 *
 * 「总结命令」是 host 唯一注册的工具，注册走 `ctx.tools.register(defineTool({ … }))`。
 * `host.test.js` 的自造桩能验接线，但验不了两件事：
 *
 * 1. `defineTool` 真的接受这份定义（空参数表、输出 schema 的形状由平台校验）；
 * 2. `effect` 卸载时注册真的收得回去——收不回去的话，插件重载一次就会有两个同名工具。
 *
 * 所以这里拿**真容器**（真 `Context` + 真 `ToolRuntime`）跑一遍。`systemPrompt` 与 `agents` 用最小替身
 * 顶住：前者是 `ToolRuntime` 构造依赖，后者是本插件 `inject` 的硬依赖（缺它 `apply` 根本不会被调用）。
 * 缺 `@deepseek-ai` 链接时整组 skip，不允许假装通过（与 `slots-registry.test.js` 同一条纪律）。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { PROTOCOL_ORDER, SUMMARY_TOOL_NAME } from '../lib/flow/protocol.js'

let Context
let ToolRuntime
let plugin
let ready = false
try {
  const cordis = await import('@deepseek-ai/cordis')
  const tools = await import('@deepseek-ai/dsh-tools')
  Context = cordis.Context
  ToolRuntime = tools.default
  const flow = await import('../lib/flow/index.js')
  // 合并后任务流半侧只导出 `applyFlow(ctx, pluginName)`；真容器要的是一个插件对象，
  // 所以这里补上 `name` / `inject`（`agents` 是它唯一的硬依赖，其余服务它自己用 `ctx.inject` 等）。
  plugin = {
    name: 'control-center',
    inject: ['agents'],
    apply: (ctx) => flow.applyFlow(ctx, 'control-center'),
  }
  ready = typeof Context === 'function' && typeof ToolRuntime === 'function' && typeof flow.applyFlow === 'function'
} catch {
  ready = false
}

/** cordis 的注入回调是异步排布的：让出一轮事件循环再断言。 */
function tick() {
  return new Promise((done) => setTimeout(done, 20))
}

/**
 * 在真容器里装一遍本插件。
 *
 * @returns `tools`（真工具运行时）、`sections`（systemPrompt 收到的分区）与 fiber。
 */
function bootHost() {
  const app = new Context()
  const sections = []
  app.provide('systemPrompt', {
    section: (section) => {
      sections.push(section)
      return () => {}
    },
    tools: () => () => {},
  })
  // `inject = ['agents']` 是硬依赖：真机上由 agent 平面提供，这里空对象即可。
  app.provide('agents', {})
  const tools = new ToolRuntime(app, {})
  let changes = 0
  app.on('tools/change', () => {
    changes += 1
  })
  const fiber = app.plugin(plugin)
  return { tools, sections, fiber, changes: () => changes }
}

test('真容器：注册表里有「总结命令」，执行无副作用，卸载后收回', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools / cordis（未安装 profile 链接）')
  const { tools, fiber, changes } = bootHost()
  await tick()

  const definition = tools.get(SUMMARY_TOOL_NAME)
  assert.ok(definition !== undefined, 'tools.get 必须拿得到刚注册的工具')
  assert.equal(changes() > 0, true, '注册必须发出 tools/change（核心靠它刷新工具表）')
  assert.equal(definition.name, SUMMARY_TOOL_NAME)
  assert.match(definition.description, /总结/, '描述是模型唯一的调用依据')
  assert.deepEqual(definition.parameters, { type: 'object', properties: {} }, '这个工具不收参数')
  assert.deepEqual(await definition.execute({}, {}), { marked: true }, '执行只回一个标记，没有副作用')
  assert.equal(definition.presentCall({}).card, 'generic')

  // 重载安全：effect 卸载后必须从注册表消失（否则插件重载会出现两个同名工具）。
  await fiber.dispose()
  await tick()
  assert.equal(tools.get(SUMMARY_TOOL_NAME), undefined, '卸载后注册必须收回')
})

test('真容器：协议分区真的挂上了 systemPrompt，且点名「总结命令」', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-tools / cordis（未安装 profile 链接）')
  const { sections, fiber } = bootHost()
  await tick()

  const section = sections.find((item) => item.order === PROTOCOL_ORDER)
  assert.ok(section !== undefined, '`ctx.inject(["systemPrompt"])` 的回调必须把分区交上去')
  assert.equal(
    section.text.includes(SUMMARY_TOOL_NAME),
    true,
    '协议正文不点名工具，模型不会知道自己有这个工具',
  )

  await fiber.dispose()
})
