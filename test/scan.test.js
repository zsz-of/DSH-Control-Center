/**
 * 跨客户端扫描与导入测试。
 *
 * 解析器部分（TOML / YAML-ish / JSON）是纯函数，直接喂样例；
 * 扫描与导入部分用一个**自定义源**指向临时目录，并把全部内置源关掉——
 * 这样测试既跑的是真实代码路径，又不会去翻开发者本机的十几个客户端目录。
 */

import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

let scan
let store
let paths
let home
let other

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-scan-home-'))
  other = await mkdtemp(join(tmpdir(), 'dcc-scan-other-'))
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dcc-scan-harness-'))
  paths = await import('../lib/paths.js')
  store = await import('../lib/store.js')
  scan = await import('../lib/scan.js')

  // 造一个「别的客户端」：JSON 里 2 个服务器（一个合法、一个 SSE 不支持），外加一个技能。
  await writeFile(
    join(other, 'mcp.json'),
    JSON.stringify({
      mcpServers: {
        filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'D:\\data'], env: { TOKEN: 'x' } },
        legacy: { type: 'sse', url: 'http://localhost:9000/sse' },
      },
    }),
    'utf8',
  )
  await mkdir(join(other, 'skills', 'helper-one'), { recursive: true })
  await writeFile(
    join(other, 'skills', 'helper-one', 'SKILL.md'),
    '---\nname: helper-one\ndescription: 一个测试技能\n---\n\n技能正文\n',
    'utf8',
  )
})

after(async () => {
  await rm(home, { recursive: true, force: true })
  await rm(other, { recursive: true, force: true })
})

/** 只留自定义源的设置。 */
function settingsWith(source) {
  return { scan: { disabled: scan.SOURCE_IDS, custom: source === undefined ? [] : [source] } }
}

test('解析：JSON 的三种键名都能抽出 mcpServers', () => {
  assert.deepEqual(Object.keys(scan.extractMcpServers('{"mcpServers":{"a":{"command":"x"}}}')), ['a'])
  assert.deepEqual(Object.keys(scan.extractMcpServers('{"mcp_servers":{"b":{"command":"x"}}}')), ['b'])
  assert.deepEqual(Object.keys(scan.extractMcpServers('{"mcp":{"servers":{"c":{"command":"x"}}}}')), ['c'])
  // 单条形态（顶层就是 command/url）也认。
  assert.deepEqual(Object.keys(scan.extractMcpServers('{"command":"x"}')), ['command', 'url'].filter((key) => key === 'command'))
  assert.deepEqual(scan.extractMcpServers('坏文本'), {})
})

test('解析：YAML-ish 片段能读懂 mcpServers 两层结构', () => {
  const text = [
    'mcpServers:',
    '  playwright:',
    '    command: npx',
    '    args:',
    '      - -y',
    '      - "@playwright/mcp@latest"',
    '    env:',
    '      TOKEN: abc',
    '  remote:',
    '    url: http://localhost:3000/mcp',
    '',
  ].join('\n')
  const servers = scan.extractMcpServers(text)
  assert.deepEqual(servers.playwright.args, ['-y', '@playwright/mcp@latest'])
  assert.deepEqual(servers.playwright.env, { TOKEN: 'abc' })
  assert.equal(servers.remote.url, 'http://localhost:3000/mcp')
})

test('解析：TOML 子集支持段、跨行数组、内联表与注释', () => {
  const text = [
    '# 顶层注释',
    'model = "gpt-5"',
    '[mcp_servers.playwright]',
    'command = "npx"  # 行尾注释',
    'args = [',
    '  "-y",',
    '  "@playwright/mcp@latest",',
    ']',
    'env = { TOKEN = "abc", MODE = "fast" }',
    'startup_timeout_sec = 20',
    '',
    '[mcp_servers.remote]',
    'url = "https://example.com/mcp"',
    '',
  ].join('\n')
  const parsed = scan.parseToml(text)
  assert.equal(parsed.model, 'gpt-5')
  assert.equal(parsed.mcp_servers.playwright.command, 'npx')
  assert.deepEqual(parsed.mcp_servers.playwright.args, ['-y', '@playwright/mcp@latest'])
  assert.deepEqual(parsed.mcp_servers.playwright.env, { TOKEN: 'abc', MODE: 'fast' })
  assert.equal(parsed.mcp_servers.playwright.startup_timeout_sec, 20)
  assert.equal(parsed.mcp_servers.remote.url, 'https://example.com/mcp')
})

test('翻译：stdio / http 两种形态，SSE 与缺字段明确报错', () => {
  const stdio = scan.toServer('a', { command: 'npx', args: ['-y', 'pkg'], env: { T: '1' }, startup_timeout_sec: 30 })
  assert.equal(stdio.server.transport, 'stdio')
  assert.deepEqual(stdio.server.args, ['-y', 'pkg'])
  assert.deepEqual(stdio.server.env, { T: '1' })
  assert.equal(stdio.server.toolCallTimeoutMs, 30000)

  const http = scan.toServer('b', { url: 'http://x/mcp', headers: { Authorization: 'Bearer y' } })
  assert.equal(http.server.transport, 'streamable-http')
  assert.deepEqual(http.server.headers, { Authorization: 'Bearer y' })

  assert.match(scan.toServer('c', { type: 'sse', url: 'http://x/sse' }).error, /SSE/)
  assert.match(scan.toServer('d', { args: [] }).error, /command/)
  assert.match(scan.toServer('e', 'not-an-object').error, /对象/)
})

test('扫描：自定义源能被扫出来，坏条目带错误而不是消失', async () => {
  const result = await scan.scanAll(settingsWith({ id: 'other', label: '别的客户端', kind: 'json', path: join(other, 'mcp.json') }))
  assert.equal(result.sources.length, 1)
  const source = result.sources[0]
  assert.equal(source.present, true)
  assert.equal(source.mcp.length, 2)
  assert.equal(source.skills.length, 0, 'JSON 源不扫技能')
  const filesystem = source.mcp.find((item) => item.name === 'filesystem')
  assert.equal(filesystem.server.command, 'npx')
  const legacy = source.mcp.find((item) => item.name === 'legacy')
  assert.match(legacy.error, /SSE/)
  assert.equal(result.totals.mcp, 2)
})

test('扫描：dir 型自定义源只收技能', async () => {
  const result = await scan.scanAll(settingsWith({ id: 'other-skills', label: '技能目录', kind: 'dir', path: join(other, 'skills') }))
  assert.equal(result.sources[0].mcp.length, 0)
  assert.deepEqual(result.sources[0].skills.map((item) => item.name), ['helper-one'])
  assert.equal(result.sources[0].skills[0].description, '一个测试技能')
  assert.equal(result.sources[0].skills[0].kind, 'bundle')
})

test('导入：一次调用同时写入 MCP 与技能，并把不支持的项报告为失败', async () => {
  // JSON 源负责 MCP，dir 源负责技能——两个自定义源一起用，正是 UI 上的常见组合。
  const settings = {
    scan: {
      disabled: scan.SOURCE_IDS,
      custom: [
        { id: 'other', label: '别的客户端', kind: 'json', path: join(other, 'mcp.json') },
        { id: 'other-skills', label: '技能目录', kind: 'dir', path: join(other, 'skills') },
      ],
    },
  }
  const result = await scan.importItems(
    {
      servers: [
        { source: 'other', name: 'filesystem' },
        { source: 'other', name: 'legacy' },
        { source: 'other', name: '不存在' },
      ],
      skills: [{ source: 'other-skills', name: 'helper-one' }],
    },
    settings,
  )
  assert.deepEqual(result.mcp.imported.map((item) => item.name), ['filesystem'])
  assert.equal(result.mcp.failed.length, 2)
  assert.match(result.mcp.failed[0].error, /SSE/)
  assert.deepEqual(result.skills.imported.map((item) => item.name), ['helper-one'])

  const written = await store.readMcp()
  assert.deepEqual(written.servers.map((item) => item.name), ['filesystem'])
  assert.equal(written.servers[0].command, 'npx')
  const skillText = await readFile(join(paths.SKILLS_DIR, 'helper-one', 'SKILL.md'), 'utf8')
  assert.match(skillText, /一个测试技能/)
})

test('导入：默认不覆盖同名项，勾选覆盖才替换', async () => {
  const settings = settingsWith({ id: 'other', label: '别的客户端', kind: 'json', path: join(other, 'mcp.json') })
  const skipped = await scan.importItems({ servers: [{ source: 'other', name: 'filesystem' }], skills: [] }, settings)
  assert.equal(skipped.mcp.imported.length, 0)
  assert.match(skipped.mcp.skipped[0].reason, /同名/)

  const overwritten = await scan.importItems({ servers: [{ source: 'other', name: 'filesystem' }], skills: [], overwrite: true }, settings)
  assert.equal(overwritten.mcp.imported.length, 1)
  assert.equal(overwritten.mcp.skipped.length, 0)
})

test('导入：来源不存在时报告失败而不是静默跳过', async () => {
  const result = await scan.importItems({ servers: [{ source: 'ghost', name: 'x' }], skills: [{ source: 'ghost', name: 'y' }] }, settingsWith())
  assert.equal(result.mcp.failed.length, 1)
  assert.equal(result.skills.failed.length, 1)
  assert.match(result.mcp.failed[0].error, /找不到/)
})

test('导入：非法技能名被拒（写进去平台也会忽略，不如直接说清楚）', async () => {
  await mkdir(join(other, 'skills', 'Bad_Name'), { recursive: true })
  await writeFile(join(other, 'skills', 'Bad_Name', 'SKILL.md'), '---\nname: Bad_Name\ndescription: d\n---\n\nx\n', 'utf8')
  const settings = settingsWith({ id: 'other-skills', label: '技能目录', kind: 'dir', path: join(other, 'skills') })
  const result = await scan.importItems({ servers: [], skills: [{ source: 'other-skills', name: 'Bad_Name' }] }, settings)
  assert.equal(result.skills.failed.length, 1)
  assert.match(result.skills.failed[0].error, /kebab-case/)
})
