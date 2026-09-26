/**
 * 「打开目录 / 定位文件」的单元测试。
 *
 * 这几个按钮的失败方式全是静默的：`spawn` 的 `error` 事件没人监听、路径不存在时
 * `explorer.exe` 不报错也不开窗、定位一个不存在的文件时 explorer 会去开**桌面**。
 * 所以这里逐条锁住行为——**不真的开窗**：把启动器换成假的，
 * 只验证「字段名认对 → 建目录 → 选对命令与参数 → 失败要冒泡成可显示的错误」。
 */

import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { reveal } from '../lib/api.js'

let home
/** 各平台「打开 / 定位」用的命令与参数形态。 */
const win = process.platform === 'win32'
const mac = process.platform === 'darwin'
const opener = win ? 'explorer.exe' : mac ? 'open' : 'xdg-open'

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

test('reveal：`path` 指的目录不存在时先建出来，再把目录交给系统文件管理器', async () => {
  const target = join(home, 'memory')
  const { launch, calls } = fakeLaunch()
  const result = await reveal({ path: target }, launch)
  assert.equal(result.kind, 'dir')
  assert.equal(result.target, target)
  assert.equal((await stat(target)).isDirectory(), true, '目录必须先被建出来')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args[0], target)
  assert.equal(calls[0].options.detached, true)
  // windowsHide 必须不是 true：它会让 Windows 给 explorer.exe 带上 SW_HIDE，
  // 目录确实被打开了但窗口是隐藏的——用户看到的就是「点了没反应」（实测详见 api.js 注释）。
  assert.notEqual(calls[0].options.windowsHide, true, 'windowsHide 会隐藏 explorer 窗口')
  assert.equal(calls[0].command, opener)
})

test('reveal：旧客户端 bundle 发的 `dir` 仍然认，且 `path` 优先', async () => {
  const legacy = join(home, 'skills')
  const preferred = join(home, 'rules')
  const { launch, calls } = fakeLaunch()
  const old = await reveal({ dir: legacy }, launch)
  assert.equal(old.target, legacy, '旧字段名不能静默退回数据根目录')
  assert.equal((await stat(legacy)).isDirectory(), true)
  const both = await reveal({ path: preferred, dir: legacy }, launch)
  assert.equal(both.target, preferred, '两个都给时以 path 为准')
  assert.equal(calls.length, 2)
})

test('reveal：定位已存在的文件时用 /select, 而不是把文件当程序打开', async () => {
  const dir = join(home, 'control-center')
  const file = join(dir, 'mcp.json')
  await mkdir(dir, { recursive: true })
  await writeFile(file, '{}')
  const { launch, calls } = fakeLaunch()
  const result = await reveal({ file }, launch)
  assert.equal(result.kind, 'file')
  assert.equal(result.target, file)
  if (win) assert.deepEqual(calls[0].args, [`/select,${file}`])
  else if (mac) assert.deepEqual(calls[0].args, ['-R', file])
  else assert.deepEqual(calls[0].args, [dir])
})

test('reveal：文件还不存在时退回打开它所在的目录（explorer 会去开桌面，不能那么干）', async () => {
  const file = join(home, 'control-center', 'backups', '还没建过的产物.zip')
  const { launch, calls } = fakeLaunch()
  const result = await reveal({ file }, launch)
  assert.equal(result.kind, 'dir')
  assert.equal(result.target, join(home, 'control-center', 'backups'))
  assert.equal((await stat(result.target)).isDirectory(), true, '父目录必须先被建出来')
  assert.equal(calls[0].args[0], result.target)
})

test('reveal：什么都不给时退回数据根目录', async () => {
  const { launch, calls } = fakeLaunch()
  const result = await reveal({}, launch)
  assert.equal(result.kind, 'dir')
  assert.equal(result.target, calls[0].args[0])
  assert.equal((await stat(result.target)).isDirectory(), true)
})

test('reveal：启动失败要冒泡成可显示的错误，而不是静默什么都不发生', async () => {
  await assert.rejects(() => reveal({ path: join(home, 'a') }, fakeLaunch('error').launch), /无法启动/)
  await assert.rejects(() => reveal({ path: join(home, 'b') }, fakeLaunch('throw').launch), /无法启动/)
})
