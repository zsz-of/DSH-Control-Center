/**
 * 「打开目录 / 定位文件」的单元测试。
 *
 * 这个按钮以前的失败方式全是静默的：路径不存在时 `explorer.exe` 不报错也不开窗、`spawn` 的
 * `error` 事件没人监听。所以这里逐条锁住行为——**不真的开窗**：把启动器换成假的，
 * 只验证「建目录 → 选对命令与参数 → 失败要冒泡成可显示的错误」。
 */

import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { reveal } from '../lib/api.js'

let home

/** 假的子进程：按需发出 `spawn` 或 `error`，并记录被调用的命令。 */
function fakeLaunch(mode = 'spawn') {
  const calls = []
  const launch = (command, args, options) => {
    calls.push({ command, args, options })
    if (mode === 'throw') throw new Error('EACCES')
    const child = new EventEmitter()
    child.unref = () => {}
    setImmediate(() => (mode === 'error' ? child.emit('error', new Error('ENOENT')) : child.emit('spawn')))
    return child
  }
  return { launch, calls }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'dcc-reveal-'))
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

test('reveal：目标目录不存在时先建出来，再把目录交给系统文件管理器', async () => {
  const target = join(home, 'memory')
  const { launch, calls } = fakeLaunch()
  const result = await reveal({ dir: target }, launch)
  assert.equal(result.kind, 'dir')
  assert.equal(result.target, target)
  assert.equal((await stat(target)).isDirectory(), true, '目录必须先被建出来')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args[0], target)
  assert.equal(calls[0].options.detached, true)
  const expected = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  assert.equal(calls[0].command, expected)
})

test('reveal：定位文件时建父目录，Windows 上用 /select, 而不是把文件当程序打开', async () => {
  const file = join(home, 'control-center', 'mcp.json')
  const { launch, calls } = fakeLaunch()
  const result = await reveal({ file }, launch)
  assert.equal(result.kind, 'file')
  assert.equal(result.target, file)
  assert.equal((await stat(join(home, 'control-center'))).isDirectory(), true, '父目录必须先被建出来')
  if (process.platform === 'win32') assert.deepEqual(calls[0].args, [`/select,${file}`])
  else if (process.platform === 'darwin') assert.deepEqual(calls[0].args, ['-R', file])
  else assert.deepEqual(calls[0].args, [join(home, 'control-center')])
})

test('reveal：什么都不给时退回数据根目录', async () => {
  const { launch, calls } = fakeLaunch()
  const result = await reveal({}, launch)
  assert.equal(result.kind, 'dir')
  assert.equal(result.target, calls[0].args[0])
  assert.equal((await stat(result.target)).isDirectory(), true)
})

test('reveal：启动失败要冒泡成可显示的错误，而不是静默什么都不发生', async () => {
  await assert.rejects(() => reveal({ dir: join(home, 'a') }, fakeLaunch('error').launch), /无法启动/)
  await assert.rejects(() => reveal({ dir: join(home, 'b') }, fakeLaunch('throw').launch), /无法启动/)
})
