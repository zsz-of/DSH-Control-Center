/**
 * 插件加载测试：用**真实的 cordis Context** 把 host 半侧 apply 一遍。
 *
 * 为什么必须有这一条：`lib/index.js` 里「用错上下文」的错误只在真 Context 上才暴露——
 * cordis 的 Context 是个 proxy，读一个**不在 `inject` 里**的属性会直接抛
 * `cannot get property "X" without inject`，而这个异常会让**整个插件树加载失败**，
 * 桌面壳随即进 safe mode（`harness.log` 里能看到 `plugin tree failed to load`）。
 *
 * 其余测试用的是手写的普通对象 ctx，读任何属性都不报错，所以拦不住这类回归；
 * 只有拿真 Context 跑一遍才拦得住。
 *
 * 依赖 `Source/node_modules/@deepseek-ai` 链接（解析 `cordis` 与 `dsh-llm`）。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEERS = join(HERE, '..', 'node_modules', '@deepseek-ai')

let ready = false
let home
let harness
let Context
let plugin

before(async () => {
  if (!existsSync(join(PEERS, 'cordis')) || !existsSync(join(PEERS, 'dsh-llm'))) return
  home = await mkdtemp(join(tmpdir(), 'dcc-load-home-'))
  harness = await mkdtemp(join(tmpdir(), 'dcc-load-harness-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = harness
  ;({ Context } = await import('@deepseek-ai/cordis'))
  plugin = await import('../lib/index.js')
  ready = true
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  if (harness !== undefined) await rm(harness, { recursive: true, force: true })
})

/**
 * 造一个最小可用的真 Context。
 *
 * 插件 `inject` 声明的三个服务（`agents` / `webServer` / `skills`）必须在场，
 * 否则 cordis 不会调用 `apply`——那样测试会「因为什么都没跑」而假通过，
 * 所以下面那条用例还会断言 API 真的挂上去了。
 */
function context(specs) {
  const ctx = new Context()
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('webServer', {
    register(spec) {
      specs.push(spec)
      return () => {}
    },
  })
  ctx.provide('skills', {
    // registry 的 provider 工厂契约：`registerProvider(create)` 返回 disposer（不是 provider 本身）。
    registerProvider(create) {
      create({ invalidate: () => {}, signal: new AbortController().signal })
      return () => {}
    },
  })
  return ctx
}

test('插件能在真实 cordis 上下文上加载完成（读未声明的属性会在这里炸）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/* 链接')
  const ctx = context([])
  // `ctx.plugin()` 在插件启动失败时会 rethrow，正是 harness 启动时看到的那条错误。
  await ctx.plugin(plugin)
})

test('加载后 API 真的挂到了 webServer 上（不是「没进 apply 所以没报错」）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/* 链接')
  const specs = []
  const ctx = context(specs)
  await ctx.plugin(plugin)
  assert.equal(specs.length, 1, 'API 应该注册一次')
  assert.equal(specs[0].kind, 'prefix')
  assert.equal(specs[0].path, '/api/dsh-control-center')
  assert.equal(typeof specs[0].handler, 'function')
})
