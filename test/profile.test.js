import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseDocument, serializeDocument, slugify, truncateBytes, byteLength } from '../lib/profile.js'

test('parseDocument：无 frontmatter 时原样返回正文', () => {
  const text = '# 标题\n\n正文\n'
  const doc = parseDocument(text)
  assert.equal(doc.hasFrontmatter, false)
  assert.equal(doc.body, text)
  assert.deepEqual(doc.data, {})
})

test('parseDocument：解析布尔/数字/引号/裸字符串', () => {
  const doc = parseDocument('---\nname: 测试\nalwaysApply: true\nn: 3\nq: "a: b"\n---\nbody\n')
  assert.equal(doc.data.name, '测试')
  assert.equal(doc.data.alwaysApply, true)
  assert.equal(doc.data.n, 3)
  assert.equal(doc.data.q, 'a: b')
  assert.equal(doc.body, 'body\n')
})

test('parseDocument：空 frontmatter 也能解析', () => {
  const doc = parseDocument('---\n---\nbody\n')
  assert.equal(doc.hasFrontmatter, true)
  assert.equal(doc.body, 'body\n')
})

test('parseDocument：正文里的 --- 分隔线不受影响', () => {
  const doc = parseDocument('---\nname: a\n---\n\n上文\n\n---\n\n下文\n')
  assert.equal(doc.data.name, 'a')
  assert.ok(doc.body.includes('上文'))
  assert.ok(doc.body.includes('下文'))
})

test('parseDocument：无法识别的行进 extra，往返不丢', () => {
  const doc = parseDocument('---\nname: a\n元数据: x\n---\nbody\n')
  assert.deepEqual(doc.extra, ['元数据: x'])
  const again = parseDocument(serializeDocument(doc.data, doc.body, doc.extra))
  assert.deepEqual(again.extra, ['元数据: x'])
})

test('serializeDocument：含冒号的值被加引号后可正确回读', () => {
  const text = serializeDocument({ description: '总则：上下文治理' }, 'body')
  assert.equal(parseDocument(text).data.description, '总则：上下文治理')
})

test('slugify：剔除非法的 Windows 文件名字符并保留中文', () => {
  assert.equal(slugify('00-驾驭工程核心规则'), '00-驾驭工程核心规则')
  assert.equal(slugify('a/b:c*d?"e<f>g|h'), 'a-b-c-d-e-f-g-h')
  assert.equal(slugify('   '), 'untitled')
})

test('truncateBytes：不切断 UTF-8 码点且不超上限', () => {
  const text = '驾驭工程ABC'
  const cut = truncateBytes(text, 7)
  assert.ok(byteLength(cut) <= 7)
  assert.ok(text.startsWith(cut))
  assert.equal(truncateBytes(text, 999), text)
  assert.equal(truncateBytes(text, 0), '')
})
