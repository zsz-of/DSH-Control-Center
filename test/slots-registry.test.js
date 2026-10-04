/**
 * 与核心**真实插槽注册表**（`@deepseek-ai/dsh-client-ui-slots` 的 `SlotCore`）对表的集成测试。
 *
 * 原生座位能工作的前提是一条很细的机制：本插件的视图条目要往核心**已经声明**的子槽
 * `conversation.chat.node` / `conversation.message.images` 里渲染，却又不能重新声明它们
 * （`register()` 的子槽冲突检查会抛「slot is already declared」）。
 * 本项目的做法是把这两个核心子槽挂成**不可枚举属性**：冲突检查只枚举自有可枚举键
 * （`lib/index.js:100`），而 `renderSlot` 的所有权检查只做属性读取
 * （`dsh-client-ui-renderer/lib/client.js:285`）。
 *
 * 这条机制必须拿**真实现**验一遍：自己对核心源码的解读一旦出错，症状是整套原生渲染在真机上
 * 直接不工作（或更糟——把别人的子槽连带收掉）。缺 profile 依赖时整组 skip，不允许假装通过。
 */

import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'

/** profile 的 `node_modules`：桌面壳实际使用的依赖都在这里。 */
function profileNodeModules() {
  if (process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '') {
    return join(process.env.DSH_HOME, 'profiles', 'node_modules')
  }
  if (process.platform === 'win32' && process.env.APPDATA !== undefined) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness', 'profiles', 'node_modules')
  }
  return undefined
}

let SlotCore
let internals
let ready = false
try {
  const base = profileNodeModules()
  if (base !== undefined) {
    const registry = await import(
      pathToFileURL(join(base, '@deepseek-ai', 'dsh-client-ui-slots', 'lib', 'index.js')).href
    )
    SlotCore = registry.SlotCore
    ready = typeof SlotCore === 'function'
  }
} catch {
  ready = false
}
const loaded = await loadBundle()
internals = loaded.exports.__internals

/**
 * 照核心 ui-chat 的做法声明插槽：`conversation.view` 由会话视图条目声明，
 * 并在自己的 children 里声明两个子槽（`dsh-client-ui-chat/lib/client.js:8090-8106`）。
 *
 * @param core - 真实的 `SlotCore` 实例。
 * @returns 核心那条视图条目的释放函数。
 */
function declareCoreView(core) {
  core.register(
    {
      name: 'root',
      id: 'session-view-owner',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    },
    () => null,
  )
  return core.register(
    {
      name: 'conversation.view',
      id: 'chat',
      order: 0,
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.message.images': { kind: 'single', scope: 'session' },
      },
    },
    () => null,
  )
}

test('真实注册表：核心已声明子槽时，本插件声明同一子槽不冲突且可读', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 @deepseek-ai/dsh-client-ui-slots（先跑一次 install.mjs）')
  const core = new SlotCore()
  const disposeCoreView = declareCoreView(core)
  const disposeTool = core.register({ name: 'conversation.chat.node', key: 'tool-call' }, () => null)

  let disposeMine
  assert.doesNotThrow(() => {
    disposeMine = core.register(
      {
        name: 'conversation.view',
        id: 'flow',
        order: 5,
        children: internals.nativeViewChildren(),
      },
      () => null,
    )
  }, '核心子槽若写成可枚举属性，这一步就会抛「slot is already declared」')

  const mine = core.entries('conversation.view').find((entry) => entry.options.id === 'flow')
  assert.ok(mine !== undefined, '本插件的条目应在账本里')
  // renderSlot 的所有权检查就是这一次属性读取。
  assert.equal(mine.children[internals.NATIVE_NODE_SLOT].kind, 'keyed')
  assert.equal(mine.children[internals.NATIVE_NODE_SLOT].scope, 'session')
  assert.equal(mine.children[internals.NATIVE_IMAGES_SLOT].kind, 'single')
  // 渲染器用 Object.values(children) 判断要不要给 SessionProvider（renderer:616）。
  assert.equal(
    Object.values(mine.children).some((spec) => spec.scope === 'session'),
    true,
    '必须至少有一个可枚举的会话作用域子槽，否则原生座位会缺作用域绑定',
  )
  // 核心注册的原生条目仍在自己的单元格里。
  assert.deepEqual(
    core.entriesOfSlot('conversation.chat.node').map((entry) => entry.options.key),
    ['tool-call'],
  )

  // 释放本插件条目：绝不能连带把别人的子槽收掉（releaseEntry 同样只枚举自有可枚举键）。
  disposeMine()
  assert.notEqual(core.spec('conversation.chat.node'), undefined, '核心的子槽声明必须活着')
  assert.notEqual(core.spec('conversation.message.images'), undefined)
  assert.equal(core.spec(internals.OWN_SEAT_SLOT), undefined, '本插件自己的子槽随条目一起收起')
  assert.deepEqual(
    core.entriesOfSlot('conversation.chat.node').map((entry) => entry.options.key),
    ['tool-call'],
  )

  disposeTool()
  disposeCoreView()
})

test('真实注册表：本插件自己的会话作用域子槽随条目声明与释放', (t) => {
  if (!ready) return t.skip('缺少 profile 里的 @deepseek-ai/dsh-client-ui-slots')
  const core = new SlotCore()
  declareCoreView(core)

  const disposeMine = core.register(
    { name: 'conversation.view', id: 'flow', children: internals.nativeViewChildren() },
    () => null,
  )
  assert.deepEqual(core.spec(internals.OWN_SEAT_SLOT), { kind: 'single', scope: 'session' })

  disposeMine()
  assert.equal(core.spec(internals.OWN_SEAT_SLOT), undefined)
})
