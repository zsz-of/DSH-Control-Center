/**
 * 提示词优化器测试：用假的 `llm` 服务验证路由解析、提示词选择与结果清洗。
 *
 * 真实调用要花钱、要网络、还不稳定；这里验证的是**我们自己那部分逻辑**：
 * 路由怎么选、系统提示词怎么定、模型话术怎么剥、失败怎么报。
 */

import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const PEER_LINK = join(HERE, '..', 'node_modules', '@deepseek-ai', 'dsh-llm')
const ready = existsSync(PEER_LINK)

let optimize
before(async () => {
  if (ready) optimize = await import('../lib/optimize.js')
})

/**
 * 造一个假的 llm 服务。
 *
 * @param options - `{ chunks, providers, models }`。
 */
function fakeLlm(options = {}) {
  const seen = []
  const providers = options.providers ?? [{ id: 'p1', name: 'P1' }]
  return {
    seen,
    listProviders: () => providers,
    listModels: async () => options.models ?? [{ id: 'm1', name: 'M1' }],
    resolveModelInfo: options.resolveModelInfo ?? (async () => ({ reasoning: { efforts: [] } })),
    prepareCall: async (config) => {
      if (options.prepareFails === true) throw new Error('no adapter registered')
      return {
        config,
        stream: (request) => {
          seen.push({ config, request })
          const chunks = options.chunks ?? [
            { type: 'text-delta', text: '优化后的' },
            { type: 'text-delta', text: '提示词' },
            { type: 'finish', reason: { kind: 'stop' } },
          ]
          return (async function* generate() {
            for (const chunk of chunks) yield chunk
          })()
        },
      }
    },
  }
}

test('优化：模型返回文本被收集，路由来自设置', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const llm = fakeLlm()
  const optimizer = new optimize.PromptOptimizer({ llm })
  const result = await optimizer.optimize('写个脚本', {
    settings: { provider: 'p1', model: 'm1', prompt: '' },
  })
  assert.equal(result.optimized, '优化后的提示词')
  assert.equal(result.provider, 'p1')
  assert.equal(result.model, 'm1')
  // 系统提示词是内置的那份，用户草稿作为唯一一条 user 消息。
  assert.match(llm.seen[0].request.system, /提示词优化器/)
  assert.equal(llm.seen[0].request.messages[0].content[0].text, '写个脚本')
})

test('优化：设置里留空时跟随 DSH 默认模型，再否则用第一条可用路由', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const llm = fakeLlm()
  const optimizer = new optimize.PromptOptimizer({ llm })

  const followed = await optimizer.optimize('x', {
    settings: { provider: '', model: '', prompt: '' },
    fallbackRoute: { provider: 'fallback', model: 'fb-1' },
  })
  assert.equal(followed.provider, 'fallback')
  assert.equal(followed.model, 'fb-1')

  const first = await optimizer.optimize('x', { settings: { provider: '', model: '', prompt: '' } })
  assert.equal(first.provider, 'p1')
  assert.equal(first.model, 'm1')
})

test('优化：自定义提示词整体替换内置提示词；思考强度透传', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const llm = fakeLlm()
  const optimizer = new optimize.PromptOptimizer({ llm })
  await optimizer.optimize('x', {
    settings: { provider: 'p1', model: 'm1', prompt: '只做错别字修正', reasoningEffort: 'off' },
  })
  assert.equal(llm.seen[0].request.system, '只做错别字修正')
  assert.equal(llm.seen[0].config.reasoningEffort, 'off')
})

test('优化：默认关闭思考——模型有 off 档就发 off，没有则交给适配器默认', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')

  const supportsOff = fakeLlm({ resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'off' }, { id: 'max' }] } }) })
  const first = new optimize.PromptOptimizer({ llm: supportsOff })
  await first.optimize('x', { settings: { provider: 'p1', model: 'm1', prompt: '' } })
  assert.equal(supportsOff.seen[0].config.reasoningEffort, 'off', '模型支持 off 时应默认发 off')

  const noOff = fakeLlm({ resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'max' }] } }) })
  const second = new optimize.PromptOptimizer({ llm: noOff })
  await second.optimize('x', { settings: { provider: 'p1', model: 'm1', prompt: '' } })
  assert.equal(noOff.seen[0].config.reasoningEffort, undefined, '模型没有 off 档时不要硬塞，交给适配器默认')

  const unknown = fakeLlm({ resolveModelInfo: async () => { throw new Error('元数据不可用') } })
  const third = new optimize.PromptOptimizer({ llm: unknown })
  await third.optimize('x', { settings: { provider: 'p1', model: 'm1', prompt: '' } })
  assert.equal(unknown.seen[0].config.reasoningEffort, undefined, '元数据取不到时也不要硬塞')
})

test('优化：模型套了代码块围栏时剥掉（草稿本身带围栏则不动）', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const fenced = fakeLlm({ chunks: [{ type: 'text-delta', text: '```markdown\n请把日志按天切分\n```' }] })
  const optimizer = new optimize.PromptOptimizer({ llm: fenced })
  const result = await optimizer.optimize('把日志切一下', { settings: { provider: 'p1', model: 'm1', prompt: '' } })
  assert.equal(result.optimized, '请把日志按天切分')

  const keepFence = fakeLlm({ chunks: [{ type: 'text-delta', text: '```python\nprint(1)\n```' }] })
  const second = new optimize.PromptOptimizer({ llm: keepFence })
  const kept = await second.optimize('```python\nprint(1)\n``` 优化它', { settings: { provider: 'p1', model: 'm1', prompt: '' } })
  assert.equal(kept.optimized, '```python\nprint(1)\n```')
})

test('优化：空草稿 / 超长草稿 / 无可用路由 / 流内错误都给出可读错误', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const optimizer = new optimize.PromptOptimizer({ llm: fakeLlm() })
  await assert.rejects(() => optimizer.optimize('   ', { settings: {} }), /输入框是空的/)
  await assert.rejects(() => optimizer.optimize('x'.repeat(optimize.MAX_INPUT_CHARS + 1), { settings: {} }), /草稿太长/)

  const none = new optimize.PromptOptimizer({ llm: fakeLlm({ providers: [] }) })
  await assert.rejects(() => none.optimize('x', { settings: {} }), /没有任何可用的模型路由/)

  const failing = new optimize.PromptOptimizer({
    llm: fakeLlm({ chunks: [{ type: 'finish', reason: { kind: 'error' } }] }),
  })
  await assert.rejects(() => failing.optimize('x', { settings: { provider: 'p1', model: 'm1' } }), /未完成/)

  const empty = new optimize.PromptOptimizer({ llm: fakeLlm({ chunks: [{ type: 'text-delta', text: '   ' }] }) })
  await assert.rejects(() => empty.optimize('x', { settings: { provider: 'p1', model: 'm1' } }), /没有返回任何内容|空结果/)
})

test('优化：路由列表按 provider 聚合，取不到模型的 provider 被跳过', async (t) => {
  if (!ready) return t.skip('缺少 @deepseek-ai/dsh-llm 链接')
  const llm = {
    listProviders: () => [
      { id: 'good', name: 'Good' },
      { id: 'broken', name: 'Broken' },
    ],
    listModels: async (id) => {
      if (id === 'broken') throw new Error('适配器离线')
      return [{ id: 'gm', name: 'Good Model' }]
    },
  }
  const routes = await new optimize.PromptOptimizer({ llm }).routes()
  assert.deepEqual(routes, [{ provider: 'good', providerName: 'Good', model: 'gm', modelName: 'Good Model' }])
})
