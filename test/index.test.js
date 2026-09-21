/**
 * host 半侧接线测试：用桩上下文真跑一遍 `apply()`，并验证 `agent/pre-step` 的注入内容。
 *
 * 这是**不需要 DSH 运行**就能验证「规则/记忆到底有没有进上下文」的地方——
 * 注入逻辑坏了是静默的（模型只是不知道规则），所以必须有测试盯着。
 *
 * 依赖 `Source/node_modules/@deepseek-ai` 这一层链接（`install.mjs` 会建）；
 * 没有它就无法解析 `@deepseek-ai/dsh-llm`，此时整组测试跳过而不是假装通过。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEER_LINK = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh-llm')

let home
let ready = false
let plugin
let store
let memory
let settings

before(async () => {
  if (!existsSync(PEER_LINK)) return
  home = await mkdtemp(join(tmpdir(), 'dcc-index-home-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dcc-index-harness-'))
  store = await import('../lib/store.js')
  memory = await import('../lib/memory.js')
  settings = await import('../lib/settings.js')
  plugin = await import('../lib/index.js')
  ready = true
})

after(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true })
})

/** 造一个只记录调用的桩上下文。 */
function stubContext(options = {}) {
  const captured = { handlers: new Map(), effects: [], disposers: [], providers: [], routes: [], tools: [] }
  // 桩 ctx 提供的服务；`inject` 只在该服务存在时才跑回调，与真实 cordis 语义一致。
  const services = {
    ...(options.llm === undefined ? {} : { llm: options.llm }),
    tools: {
      register(definition) {
        captured.tools.push(definition)
        return () => {}
      },
    },
  }
  const ctx = {
    on(event, handler) {
      captured.handlers.set(event, handler)
    },
    effect(fn) {
      captured.effects.push(fn)
      const dispose = fn()
      if (typeof dispose === 'function') captured.disposers.push(dispose)
      return () => {}
    },
    inject(deps, run) {
      // 依赖不齐时回调不跑（真实 cordis 也是等依赖就绪才加载子插件）。
      if (!deps.every((dep) => services[dep] !== undefined)) return
      run({ ...ctx, ...services })
    },
    skills: {
      registerProvider(create) {
        captured.providers.push(create({ invalidate: () => {} }))
        return () => {}
      },
    },
    webServer: {
      register(spec) {
        captured.routes.push(spec)
        return () => {}
      },
    },
    plugin: async () => ({}),
  }
  return { ctx, captured }
}

/** 调一次 pre-step 处理器（session 对象要稳定，去重是按它会话记的）。 */
async function runPreStep(handler, cwd, session = { header: { cwd } }) {
  const decision = { kind: 'enter', messages: [] }
  return handler({ agent: { session }, signal: { aborted: false } }, async () => decision)
}

test('host 接线：apply() 注册注入钩子、技能提供方、MCP 运行时与 HTTP 路由', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接（先跑一次 node scripts/install.mjs）')
  const { ctx, captured } = stubContext()
  plugin.apply(ctx)
  assert.equal(plugin.name, 'control-center')
  assert.deepEqual(plugin.inject, ['agents', 'webServer', 'skills'])
  assert.ok(captured.handlers.has('agent/pre-step'), '必须注册 pre-step 注入')
  assert.ok(captured.providers.length >= 1, '必须注册技能提供方')
  assert.equal(captured.routes.length, 1)
  assert.equal(captured.routes[0].path, '/api/dsh-control-center')
  assert.equal(captured.routes[0].kind, 'prefix')
  // 运行期清理钩子必须存在（插件卸载时不能留下挂着的 MCP fiber）。
  assert.ok(captured.disposers.length >= 3)
})

test('注入：强加载规则正文 + 全局记忆一起进上下文，且第二次不再重复注入', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  await store.writeRule({ name: '硬规则', description: '必须遵守', mode: 'always', body: '永远先跑测试' })
  await memory.writeMemory({ name: '项目背景', description: '事实', body: '本机 Node 走 nvm' })

  const { ctx, captured } = stubContext()
  plugin.apply(ctx)
  const handler = captured.handlers.get('agent/pre-step')
  const session = { header: { cwd: 'D:\\Code\\X' } }

  const first = await runPreStep(handler, 'D:\\Code\\X', session)
  assert.equal(first.kind, 'enter')
  assert.equal(first.messages.length, 2, '规则与记忆各一条消息')
  const text = first.messages.map((message) => message.content.map((block) => block.text).join('')).join('\n---\n')
  assert.match(text, /永远先跑测试/)
  assert.match(text, /本机 Node 走 nvm/)
  assert.match(text, /<system-reminder>/)

  // 内容没变 → 同一会话不再重复注入（省 token）。
  const second = await runPreStep(handler, 'D:\\Code\\X', session)
  assert.equal(second.messages.length, 0)
})

test('注入：关掉记忆注入后只注入规则', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  await settings.writeSettings({ memory: { inject: false } })
  const { ctx, captured } = stubContext()
  plugin.apply(ctx)
  const handler = captured.handlers.get('agent/pre-step')
  // 换一个「会话」以绕过去重（WeakMap 按会话记录）。
  const decision = await handler(
    { agent: { session: { header: { cwd: 'D:\\Code\\X' } } }, signal: { aborted: false } },
    async () => ({ kind: 'enter', messages: [] }),
  )
  const text = decision.messages.map((message) => message.content.map((block) => block.text).join('')).join('\n')
  assert.match(text, /永远先跑测试/)
  assert.ok(!text.includes('本机 Node 走 nvm'), '关掉注入后记忆不能进上下文')
  await settings.writeSettings({ memory: { inject: true } })
})

test('注入：项目记忆只在工作目录匹配的会话里出现', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  await memory.writeMemory({
    name: '项目约定',
    description: '只在 Demo 项目生效',
    body: '这个项目用 pnpm',
    scope: 'workspace',
    workspace: 'D:\\Code\\Demo',
  })
  const { ctx, captured } = stubContext()
  plugin.apply(ctx)
  const handler = captured.handlers.get('agent/pre-step')

  const matching = await runPreStep(handler, 'D:\\Code\\Demo')
  const matchingText = matching.messages.map((message) => message.content.map((block) => block.text).join('')).join('\n')
  assert.match(matchingText, /这个项目用 pnpm/)

  const other = await runPreStep(handler, 'D:\\Code\\Other')
  const otherText = other.messages.map((message) => message.content.map((block) => block.text).join('')).join('\n')
  assert.ok(!otherText.includes('这个项目用 pnpm'), '别的项目不该看到这条记忆')
  await memory.deleteMemory('项目约定.md')
})

test('注入：项目规则与全局规则一起注入，且项目规则标出来源', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const workspace = await mkdtemp(join(tmpdir(), 'dcc-index-ws-'))
  try {
    await store.writeRule({ name: '全局硬规则', description: '', mode: 'always', body: 'GLOBAL-BODY' })
    const projectDir = join(workspace, '.dsh', 'rules')
    const { mkdir: makeDir, writeFile: write } = await import('node:fs/promises')
    await makeDir(projectDir, { recursive: true })
    await write(join(projectDir, 'p.md'), '---\nname: 项目硬规则\ndescription: 只管这个项目\nmode: always\n---\n\nPROJECT-BODY\n', 'utf8')

    const { ctx, captured } = stubContext()
    plugin.apply(ctx)
    const handler = captured.handlers.get('agent/pre-step')

    const matching = await runPreStep(handler, workspace)
    const text = matching.messages.map((message) => message.content.map((block) => block.text).join('')).join('\n')
    assert.match(text, /PROJECT-BODY/)
    assert.match(text, /GLOBAL-BODY/)
    assert.match(text, /项目规则/, '项目规则要标出来源，模型才知道这是本项目的约定')

    // 别的项目看不到这条项目规则。
    const other = await runPreStep(handler, 'D:\\Code\\Other')
    const otherText = other.messages.map((message) => message.content.map((block) => block.text).join('')).join('\n')
    assert.ok(!otherText.includes('PROJECT-BODY'))
    assert.match(otherText, /GLOBAL-BODY/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('注入：没有任何规则与记忆时不注入空壳消息', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  // 清空上一条测试留下的规则与记忆，构造「全新安装」的状态。
  for (const rule of await store.listRules()) await store.deleteRule(rule.file)
  for (const item of await memory.listMemories()) await memory.deleteMemory(item.file)

  const { ctx, captured } = stubContext()
  plugin.apply(ctx)
  const handler = captured.handlers.get('agent/pre-step')
  const decision = await runPreStep(handler, 'D:\\Code\\Empty')
  assert.equal(decision.messages.length, 0)
})
