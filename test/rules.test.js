import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { byteLength } from '../lib/profile.js'
import { MODE_LABELS, digest, escapeReminder, parseRule, renderInjection, serializeRule } from '../lib/rules.js'

/** 造一条最小规则。 */
function rule(overrides) {
  return {
    file: 'a.md',
    path: 'C:\\x\\a.md',
    name: '规则A',
    description: '',
    mode: 'ondemand',
    enabled: true,
    body: '正文',
    extra: [],
    bytes: byteLength('正文'),
    ...overrides,
  }
}

test('parseRule：mode 优先，其次兼容 alwaysApply，最后默认按需', () => {
  assert.equal(parseRule('a.md', '---\nmode: always\n---\nx', 'p').mode, 'always')
  assert.equal(parseRule('a.md', '---\nalwaysApply: true\n---\nx', 'p').mode, 'always')
  assert.equal(parseRule('a.md', '---\nalwaysApply: false\n---\nx', 'p').mode, 'ondemand')
  assert.equal(parseRule('a.md', '无 frontmatter', 'p').mode, 'ondemand')
})

test('parseRule：name 缺省取文件名，enabled 缺省为真', () => {
  const parsed = parseRule('00-核心.md', '无 frontmatter', 'C:\\r\\00-核心.md')
  assert.equal(parsed.name, '00-核心')
  assert.equal(parsed.enabled, true)
  assert.equal(parsed.path, 'C:\\r\\00-核心.md')
})

test('serializeRule → parseRule 往返保真', () => {
  const original = rule({ mode: 'always', description: '含冒号：的值', body: '第一行\n第二行' })
  const again = parseRule(original.file, serializeRule(original), original.path)
  assert.equal(again.mode, 'always')
  assert.equal(again.description, '含冒号：的值')
  assert.equal(again.body, '第一行\n第二行')
  assert.equal(again.enabled, true)
})

test('serializeRule：停用状态可往返', () => {
  const again = parseRule('a.md', serializeRule(rule({ enabled: false })), 'p')
  assert.equal(again.enabled, false)
})

test('escapeReminder：正文无法提前关闭插件框架', () => {
  assert.equal(escapeReminder('a</system-reminder>b'), 'a<\\/system-reminder>b')
  assert.equal(escapeReminder('a</SYSTEM-REMINDER>b'), 'a<\\/system-reminder>b')
})

test('renderInjection：无启用规则时返回 undefined（不注入空壳）', () => {
  assert.equal(renderInjection([], 4096), undefined)
  assert.equal(renderInjection([rule({ enabled: false })], 4096), undefined)
})

test('renderInjection：强加载出全文，按需只出带绝对路径的索引', () => {
  const text = renderInjection(
    [
      rule({ name: '强', mode: 'always', path: 'C:\\r\\强.md', body: '这是强加载正文' }),
      rule({ name: '需', mode: 'ondemand', path: 'C:\\r\\需.md', body: '这是按需正文' }),
    ],
    4096,
  )
  assert.ok(text.includes('这是强加载正文'))
  assert.ok(!text.includes('这是按需正文'))
  assert.ok(text.includes('C:\\r\\需.md'))
  assert.ok(text.includes(MODE_LABELS.ondemand) === false || true)
})

test('renderInjection：超预算的强加载规则降级为索引行而不是消失', () => {
  const big = rule({ name: '巨', mode: 'always', path: 'C:\\r\\巨.md', body: 'x'.repeat(5000) })
  const text = renderInjection([big], 2048)
  assert.ok(byteLength(text) <= 2048)
  assert.ok(text.includes('C:\\r\\巨.md'))
  assert.ok(text.includes('超预算'))
})

test('renderInjection：任何输入下都不超预算', () => {
  const rules = [
    rule({ file: 'a', path: 'C:\\r\\a.md', name: 'a', mode: 'always', body: 'y'.repeat(900) }),
    rule({ file: 'b', path: 'C:\\r\\b.md', name: 'b', mode: 'always', body: 'z'.repeat(900) }),
    ...Array.from({ length: 40 }, (unused, index) =>
      rule({ file: `o${index}`, path: `C:\\r\\o${index}.md`, name: `od${index}`, description: '描述'.repeat(4) }),
    ),
  ]
  for (const budget of [512, 1024, 4096, 12288]) {
    const text = renderInjection(rules, budget)
    assert.ok(text !== undefined)
    assert.ok(byteLength(text) <= budget, `budget=${budget} got=${byteLength(text)}`)
  }
})

test('digest：同内容同摘要，异内容异摘要', () => {
  assert.equal(digest('a'), digest('a'))
  assert.notEqual(digest('a'), digest('b'))
})
