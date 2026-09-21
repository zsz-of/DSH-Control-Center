/**
 * zip 读写测试：标准格式、往返一致、越界条目拒收。
 *
 * 这些断言是备份功能的底线——产物打不开或悄悄写坏，用户是在「要恢复的时候」才发现。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createZip, crc32, isSafeEntryName, readZip } from '../lib/zip.js'

test('zip：多条目往返，内容与顺序保持一致', () => {
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"a":1}', 'utf8') },
    { name: 'payload/rules/a.md', data: Buffer.from('中文内容\n第二行', 'utf8') },
    { name: 'payload/skills/b/SKILL.md', data: Buffer.from('---\nname: b\n---\n\n正文', 'utf8') },
  ]
  const buffer = createZip(entries)
  // 头部签名与结束记录签名都在。
  assert.equal(buffer.readUInt32LE(0), 0x04034b50)
  const parsed = readZip(buffer)
  assert.deepEqual(parsed.map((entry) => entry.name), entries.map((entry) => entry.name))
  for (const [index, entry] of entries.entries()) {
    assert.equal(parsed[index].data.toString('utf8'), entry.data.toString('utf8'))
  }
})

test('zip：空文件与二进制内容都不丢字节', () => {
  const binary = Buffer.from([0, 1, 2, 250, 251, 255, 0, 128])
  const buffer = createZip([
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'bin/data.bin', data: binary },
  ])
  const parsed = readZip(buffer)
  assert.equal(parsed[0].data.length, 0)
  assert.deepEqual([...parsed[1].data], [...binary])
})

test('zip：可压缩内容真的被压缩（存储回退不会让包变大）', () => {
  const big = Buffer.from('ABCD'.repeat(20000), 'utf8')
  const buffer = createZip([{ name: 'big.txt', data: big }])
  assert.ok(buffer.length < big.length / 2, `压缩后应显著变小，实际 ${buffer.length} vs ${big.length}`)
  assert.equal(readZip(buffer)[0].data.toString('utf8'), big.toString('utf8'))
})

test('zip：损坏的包报错而不是返回半截数据', () => {
  const buffer = createZip([{ name: 'a.txt', data: Buffer.from('hello') }])
  const truncated = buffer.subarray(0, buffer.length - 30)
  assert.throws(() => readZip(truncated), /zip|中央目录/)
  assert.throws(() => readZip(Buffer.from('not a zip at all')), /zip/)
})

test('zip：CRC32 与已知值一致', () => {
  // "123456789" 的标准 CRC32 是 0xCBF43926。
  assert.equal(crc32(Buffer.from('123456789', 'utf8')), 0xcbf43926)
})

test('zip：目录穿越条目一律拒收', () => {
  assert.equal(isSafeEntryName('payload/rules/a.md'), true)
  assert.equal(isSafeEntryName('../etc/passwd'), false)
  assert.equal(isSafeEntryName('payload/../../x'), false)
  assert.equal(isSafeEntryName('/abs/path'), false)
  assert.equal(isSafeEntryName('C:/Windows/x'), false)
  assert.equal(isSafeEntryName('a//b'), false)
  assert.equal(isSafeEntryName(''), false)
})
