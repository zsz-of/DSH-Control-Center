/**
 * 自动换模型（余额不足 → 换到别的提供方）的测试。
 *
 * 分两层：
 * 1. **纯决策** `chooseRoute`：只吃目录 + 策略 + 失败路由，不碰 ctx——规则（同级优先、
 *    没同级降一级、屏蔽项、只能向下换、同提供方不选）全在这里钉死；
 * 2. **引擎** `ModelSwitcher`：用桩 controller 走一遍「换会话级模型 + 代发继续 + 记通知」，
 *    并确认它**没有**去动全局默认模型（用户要求只改当前会话）。
 *
 * 在临时 home + 临时 `$DSH_HOME` 下跑：`paths.js` 在导入时求值路径，`readSettings` 依赖它。
 *
 * @module test/model-switch
 */

import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

let mod
let settings
let home
let harness

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-switch-home-'))
  harness = await mkdtemp(join(tmpdir(), 'dcc-switch-harness-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = harness
  settings = await import('../lib/settings.js')
  mod = await import('../lib/model-switch.js')
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(harness, { recursive: true, force: true })
})

/** 一份目录：三个提供方，各有强/中/弱三档模型。 */
function catalogFixture() {
  return {
    groups: [
      { id: 'p1', name: '一号', models: [{ id: 'strong', name: '强', reasoning: { defaultEffort: 'high' } }] },
      {
        id: 'p2',
        name: '二号',
        models: [
          { id: 'strong', name: '强', reasoning: { defaultEffort: 'medium' } },
          { id: 'mid', name: '中' },
          { id: 'weak', name: '弱' },
        ],
      },
      { id: 'p3', name: '三号', models: [{ id: 'mid', name: '中' }, { id: 'weak', name: '弱' }] },
    ],
  }
}

/** 完整策略：三档都登记，提供方层级 p1 → p2 → p3。 */
function policyFixture(overrides = {}) {
  return {
    autoSwitch: true,
    providerOrder: ['p1', 'p2', 'p3'],
    tiers: {
      'p1/strong': 1,
      'p2/strong': 1,
      'p2/mid': 2,
      'p3/mid': 2,
      'p3/weak': 3,
    },
    blocked: [],
    ...overrides,
  }
}

test('quotaCodeOf：只认 turn/end 上的 QUOTA / ACCOUNT_QUOTA', () => {
  const event = (code, kind = 'error', type = 'turn/end') => ({ type, data: { reason: { kind, error: { code } } } })
  assert.equal(mod.quotaCodeOf(event('QUOTA')), 'QUOTA')
  assert.equal(mod.quotaCodeOf(event('ACCOUNT_QUOTA')), 'ACCOUNT_QUOTA')
  assert.equal(mod.quotaCodeOf(event('RATE_LIMITED')), undefined, '别把限流当成余额不足')
  assert.equal(mod.quotaCodeOf(event('QUOTA', 'aborted')), undefined, '被中断不算')
  assert.equal(mod.quotaCodeOf(event('QUOTA', 'error', 'turn/start')), undefined, '只看回合结束')
  assert.equal(mod.quotaCodeOf({ type: 'turn/end', data: {} }), undefined)
  assert.equal(mod.quotaCodeOf(undefined), undefined)
})

test('normalizeCatalog：坏形状只丢显示名，不抛错', () => {
  const catalog = mod.normalizeCatalog({
    groups: [
      { id: 'a', models: [{ id: 'm1', reasoning: { defaultEffort: 'low' } }, { id: '' }, null] },
      { id: '', models: [{ id: 'x' }] },
      null,
    ],
  })
  assert.deepEqual(catalog.providers.map((item) => item.id), ['a'])
  assert.deepEqual(catalog.providers[0].models, [{ id: 'm1', name: 'm1', effort: 'low' }])
  assert.deepEqual(mod.normalizeCatalog(undefined).providers, [])
})

test('orderProviders：排过序的按层级，没排过的接在后面（保持目录顺序）', () => {
  const providers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(mod.orderProviders(providers, ['c', 'a']).map((item) => item.id), ['c', 'a', 'b'])
  assert.deepEqual(mod.orderProviders(providers, []).map((item) => item.id), ['a', 'b', 'c'])
})

test('chooseRoute：同级优先，没有同级就降一级（不跳两级）', () => {
  const catalog = catalogFixture()
  const policy = policyFixture()
  // 一号的强模型（1 级）失败 → 二号的强模型（同为 1 级）。
  assert.deepEqual(
    pick(mod.chooseRoute({ catalog, policy, failed: { provider: 'p1', model: 'strong' } })),
    { provider: 'p2', model: 'strong' },
  )
  // 没有同级候选 → 只降到 2 级（二号的 mid），而不是三号的 3 级弱模型。
  const noSameTier = policyFixture({ tiers: { 'p1/strong': 1, 'p2/mid': 2, 'p3/mid': 2, 'p3/weak': 3 } })
  assert.deepEqual(
    pick(mod.chooseRoute({ catalog, policy: noSameTier, failed: { provider: 'p1', model: 'strong' } })),
    { provider: 'p2', model: 'mid' },
  )
})

test('chooseRoute：屏蔽项、同提供方与「只能向下换」', () => {
  const catalog = catalogFixture()
  // 屏蔽掉二号的同级与降级候选 → 落到三号的 2 级。
  const blocked = policyFixture({ blocked: ['p2/strong', 'p2/mid'] })
  assert.deepEqual(
    pick(mod.chooseRoute({ catalog, policy: blocked, failed: { provider: 'p1', model: 'strong' } })),
    { provider: 'p3', model: 'mid' },
  )
  // 同级与降一级都没有 → 未分级模型兜底；同一趟里按「提供方层级 → 目录顺序」取第一个。
  const ungraded = policyFixture({ tiers: { 'p1/strong': 1 } })
  assert.deepEqual(
    pick(mod.chooseRoute({ catalog, policy: ungraded, failed: { provider: 'p1', model: 'strong' } })),
    { provider: 'p2', model: 'strong' },
    '未分级的候选按提供方层级与目录顺序排，先轮到二号的第一个模型',
  )
  // 候选里永远不含失败提供方自己。
  const chosen = mod.chooseRoute({ catalog, policy: policyFixture(), failed: { provider: 'p1', model: 'strong' } })
  assert.notEqual(chosen.provider, 'p1')
  // 最下面那一层没有更下层可换。
  assert.equal(mod.chooseRoute({ catalog, policy: policyFixture(), failed: { provider: 'p3', model: 'weak' } }), undefined)
  // 失败提供方不在目录里（比如刚被卸载）→ 不猜层级。
  assert.equal(mod.chooseRoute({ catalog, policy: policyFixture(), failed: { provider: 'gone', model: 'x' } }), undefined)
  // 全部屏蔽 → 没有候选。
  const all = policyFixture({ blocked: ['p2/strong', 'p2/mid', 'p2/weak', 'p3/mid', 'p3/weak'] })
  assert.equal(mod.chooseRoute({ catalog, policy: all, failed: { provider: 'p1', model: 'strong' } }), undefined)
})

/** 只取决策结果里关心的两格（顺带把 effort 带出来断言）。 */
function pick(route) {
  return route === undefined ? undefined : { provider: route.provider, model: route.model }
}

/* ─────────────────────────── 引擎（桩 controller） ─────────────────────────── */

/** 造一套桩：记录「换了哪个会话级选择」与「代发了什么」。 */
function stubRuntime() {
  const calls = { selected: [], prompted: [], followed: [], revision: 0 }
  const followed = []
  const agent = {
    id: 'sess-1',
    followup: (message) => followed.push(message),
  }
  const controller = {
    modelCatalog: async () => catalogFixture(),
    agents: {
      selectionFor: () => ({ current: { provider: 'p1', model: 'strong' } }),
      selectForNextRequest: (target, selection) => calls.selected.push({ target, selection }),
    },
    prompt: async (request) => calls.prompted.push(request),
  }
  const ctx = { agents: { get: (id) => (id === 'sess-1' ? agent : undefined) } }
  const runtime = {
    modelSwitches: new Map(),
    bumpRevision: () => {
      calls.revision += 1
    },
  }
  return { calls, agent, controller, ctx, runtime, followed }
}

test('引擎：余额不足 → 只改这条会话的模型 + 代发「继续」+ 记通知（不碰全局默认）', async () => {
  await settings.writeSettings({ models: policyFixture() })
  const { calls, agent, controller, ctx, runtime } = stubRuntime()
  const switcher = new mod.ModelSwitcher({ ctx, runtime, logger: { warn: () => {} } })
  switcher.connectController(controller)

  const result = await switcher.switchFor('sess-1', 'QUOTA')

  assert.equal(result.ok, true)
  assert.deepEqual(result.from, { provider: 'p1', model: 'strong' })
  assert.deepEqual(result.to, { provider: 'p2', model: 'strong', reasoningEffort: 'medium' })
  assert.equal(calls.selected.length, 1, '换的是会话级选择')
  assert.equal(calls.selected[0].target, agent, '换的是这条会话的 live agent')
  assert.deepEqual(
    calls.selected[0].selection,
    { provider: 'p2', model: 'strong', reasoningEffort: 'medium' },
    '目录里声明的默认思考档要一起带过去',
  )
  assert.equal(calls.prompted.length, 1, '要代发一条「继续」')
  assert.equal(calls.prompted[0].sessionId, 'sess-1')
  assert.match(calls.prompted[0].content[0].text, /已自动换源/)
  assert.match(calls.prompted[0].content[0].text, /p1\/strong/)
  assert.match(calls.prompted[0].content[0].text, /p2\/strong/)
  const notice = runtime.modelSwitches.get('sess-1')
  assert.equal(notice.ok, true)
  assert.equal(notice.acknowledged, false, '刚记下时是「未确认」，界面据此高亮模型下拉')
  assert.equal(calls.revision, 1, '写一次版本号，面板开着时会自己刷新')
})

test('引擎：总开关关掉 / 控制器缺席 / 会话不活着 / 没有候选 都不动手', async () => {
  const off = stubRuntime()
  await settings.writeSettings({ models: policyFixture({ autoSwitch: false }) })
  const disabled = new mod.ModelSwitcher({ ctx: off.ctx, runtime: off.runtime, logger: { warn: () => {} } })
  disabled.connectController(off.controller)
  assert.deepEqual(await disabled.switchFor('sess-1'), { ok: false, reason: 'disabled' })
  assert.equal(off.calls.selected.length + off.calls.prompted.length, 0)

  await settings.writeSettings({ models: policyFixture() })
  const noController = new mod.ModelSwitcher({ ctx: off.ctx, runtime: off.runtime, logger: { warn: () => {} } })
  assert.deepEqual(await noController.switchFor('sess-1'), { ok: false, reason: 'controller-unavailable' })

  const notLive = stubRuntime()
  const switcher = new mod.ModelSwitcher({ ctx: notLive.ctx, runtime: notLive.runtime, logger: { warn: () => {} } })
  switcher.connectController(notLive.controller)
  assert.deepEqual(await switcher.switchFor('sess-nope'), { ok: false, reason: 'session-not-live' })

  const all = stubRuntime()
  await settings.writeSettings({
    models: policyFixture({ blocked: ['p2/strong', 'p2/mid', 'p2/weak', 'p3/mid', 'p3/weak'] }),
  })
  const blockedSwitcher = new mod.ModelSwitcher({ ctx: all.ctx, runtime: all.runtime, logger: { warn: () => {} } })
  blockedSwitcher.connectController(all.controller)
  const none = await blockedSwitcher.switchFor('sess-1', 'QUOTA')
  assert.equal(none.ok, false)
  assert.equal(none.reason, 'no-candidate')
  assert.equal(all.calls.selected.length, 0, '没有候选就不能换')
  assert.equal(all.calls.prompted.length, 0, '也没必要代发「继续」')
  assert.equal(all.runtime.modelSwitches.get('sess-1').ok, false, '但要在界面上说清「换不了」')
})

test('引擎：平台发消息通道被拒时退回 agent.followup（子代理会话就是这样）', async () => {
  await settings.writeSettings({ models: policyFixture() })
  const stub = stubRuntime()
  stub.controller.prompt = async () => {
    throw new Error('api-session: subagent ownership')
  }
  const switcher = new mod.ModelSwitcher({ ctx: stub.ctx, runtime: stub.runtime, logger: { warn: () => {} } })
  switcher.connectController(stub.controller)
  const result = await switcher.switchFor('sess-1', 'ACCOUNT_QUOTA')
  assert.equal(result.ok, true)
  assert.equal(result.resumed, true, '退回 agent.followup 也算发出去了')
  assert.equal(stub.followed.length, 1)
  assert.match(stub.followed[0].content[0].text, /继续/)
  assert.equal(stub.calls.selected.length, 1, '换模型照旧')
})

test('引擎：handleEvent 从会话事件里认出余额不足并完成换源', async () => {
  await settings.writeSettings({ models: policyFixture() })
  const stub = stubRuntime()
  const switcher = new mod.ModelSwitcher({ ctx: stub.ctx, runtime: stub.runtime, logger: { warn: () => {} } })
  switcher.connectController(stub.controller)
  await switcher.handleEvent({ id: 'sess-1' }, { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'QUOTA' } } } })
  assert.equal(stub.calls.selected.length, 1)
  await switcher.handleEvent({ id: 'sess-1' }, { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'CONTEXT_WINDOW' } } } })
  assert.equal(stub.calls.selected.length, 1, '别的错误码不该触发换源')
})
