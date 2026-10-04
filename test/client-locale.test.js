/**
 * 文案一致性测试：**用到的键都定义了、定义的键都用到、中英字典键集相同**。
 *
 * 为什么值得单独一个测试文件：
 * - 缺键不会报错。核心的 `translate` 在找不到键时**回落成键名本身**，于是界面上会直接
 *   显示 `flow.whatever` 这种字符串——只有人眼在真机上才看得见，自动化测试不查就永远漏；
 * - 多键是纯噪声（字典进了 bundle，白白占体积），违反「禁止为以后可能用到保留」的约束；
 * - 中英键集不一致时，切到英文就会漏键，而中文界面完全正常，最容易漏测。
 *
 * 扫描方式：把两组的客户端分片当文本读（`lib/client/*.js` + `lib/client-flow/*.js`），
 * 收集所有 `'flow.*'` / `'view.*'` 形式的字面量。两条纪律：
 * 1. 先剥掉**字典条目语法**（`'flow.x':` —— 键后面紧跟冒号），剩下的字面量才算「被引用」。
 *    这样 `05-locale.js` 里的 label 适配器（`markdownLabels` / `terminalLabels` 同样调 `t(...)`）
 *    也能算作使用点，而字典自己的键不会互相「证明」被用到。
 * 2. 之所以扫**字面量**而不是只扫 `t('...')` 调用：类别键是经 `CATEGORY_LOCALE_KEYS`
 *    间接传给 `t` 的（`t(CATEGORY_LOCALE_KEYS[category])`），只扫调用会把它们误判成未使用。
 */

import { strict as assert } from 'node:assert'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// 任务流半侧的分片在合并后搬到了 `lib/client-flow/`：字典与用法分居两组，扫描必须覆盖两边。
const SHARD_DIRS = [join(HERE, '..', 'lib', 'client'), join(HERE, '..', 'lib', 'client-flow')]

const { exports } = await loadBundle()
const { ZH, EN } = exports.__internals

/** 读取两组的全部客户端分片文本。 */
async function readShards() {
  const shards = []
  for (const dir of SHARD_DIRS) {
    const names = (await readdir(dir)).filter((name) => name.endsWith('.js')).sort()
    for (const name of names) shards.push({ name, text: await readFile(join(dir, name), 'utf8') })
  }
  return shards
}

/**
 * 字典条目语法：**行首缩进后**直接是 `'flow.x':`（键后紧跟冒号）。
 *
 * 必须锚定行首：三元表达式 `cond ? 'flow.rail.jump' : 'flow.rail.older'` 里
 * 冒号前的那个字面量长得和字典键一样，不锚定就会把**真实引用**误当成字典条目剥掉，
 * 于是报出「已定义但无人引用」的假警。
 */
const DICTIONARY_ENTRY = /^[ \t]*['"](?:flow|view)\.[A-Za-z0-9_.]+['"]\s*:/gm

/** 收集分片里所有 `'flow.*'` / `'view.*'` 用法字面量。 */
function collectKeys(text) {
  const keys = new Set()
  for (const match of text.replace(DICTIONARY_ENTRY, '').matchAll(/['"]((?:flow|view)\.[A-Za-z0-9_.]+)['"]/g)) {
    keys.add(match[1])
  }
  return keys
}

const shards = await readShards()
const used = new Set()
for (const shard of shards) for (const key of collectKeys(shard.text)) used.add(key)

test('中英字典的键集完全一致', () => {
  const zh = Object.keys(ZH).sort()
  const en = Object.keys(EN).sort()
  assert.deepEqual(zh, en, '中英字典键集不一致：切到英文会漏键')
})

test('用到的每个键都在字典里（缺键会让界面直接显示键名）', () => {
  const missing = [...used].filter((key) => !(key in ZH)).sort()
  assert.deepEqual(missing, [], `以下键被引用但未定义：${missing.join(', ')}`)
})

test('字典里的每个键都被用到（不留死文案）', () => {
  const dead = Object.keys(ZH)
    .filter((key) => !used.has(key))
    .sort()
  assert.deepEqual(dead, [], `以下键已定义但无人引用：${dead.join(', ')}`)
})

test('插值参数在模板里以 {name} 形式出现', () => {
  const offenders = []
  for (const [key, template] of Object.entries(ZH)) {
    if (typeof template !== 'string') offenders.push(`${key}: 值不是字符串（t 不会调用函数值）`)
    if (/\(.*\)\s*=>/.test(template)) offenders.push(`${key}: 看起来是函数而不是字符串模板`)
  }
  assert.deepEqual(offenders, [])
  assert.equal(ZH['flow.ops'], '{count} 个操作')
  assert.equal(ZH['flow.tasksSummary'], '{total} 项 · {done} 已完成')
})
