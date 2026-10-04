/**
 * 把两组源码分片按文件名顺序拼成 `lib/client.js`。
 *
 * **为什么要有这一步**：DSH 只按 `exports["./client"]` 给插件**一个** URL
 * （`/plugins/<id>/client.js`），浏览器侧拿不到第二个文件，所以产物必须是单文件；
 * 但把十几个标签页与一套任务流视图塞进一个文件里改起来是灾难。折中方案是把源码按领域切成
 * 若干片段、用一个零依赖的拼接脚本生成产物——不是打包链，没有转译、没有依赖解析，只有 `join`。
 *
 * 两组分片：
 * - **核心组** `lib/client/*.js`：控制中心自己。`00-head.js` 开 `window.__ModuleLoader__.load`
 *   工厂、`99-tail.js` 收工厂并 `return module.exports`；
 * - **任务流组** `lib/client-flow/*.js`（原独立插件 `dsh-chat-flow`）。它**自己不开工厂、也不收尾**，
 *   而是被包进一个 IIFE，由核心组的 `99-tail.js` 收成 `const chatFlow`，再合成唯一的
 *   `apply` / `inject`（并集）。IIFE 的作用是隔离：两组各自都有 `const h` / `const inject` /
 *   `NS` / `STYLE_ID` 等同名顶层声明，同处一个作用域会直接语法冲突。
 *
 * 约定：
 * - 片段只写「工厂函数体内的代码」，`00-head.js` 开工厂、`99-tail.js` 收工厂并导出；
 * - 产物带生成标记与两组片段清单，便于确认线上跑的到底是哪一份；
 * - 生成后自己 `node --check` 一遍语法，语法错绝不留给浏览器去发现。
 *
 * 用法：`node scripts/build-client.mjs [--check]`
 *   --check  只校验已存在的 lib/client.js 与片段是否同步（CI / 安装前用），不写文件
 *
 * @module dsh-control-center/scripts/build-client
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = resolve(HERE, '..', 'lib')
const CORE_DIR = join(LIB, 'client')
const FLOW_DIR = join(LIB, 'client-flow')
const OUTPUT = join(LIB, 'client.js')

/** 任务流组被插在核心组的哪个分片之前（必须是核心组的收尾分片）。 */
const CORE_TAIL = '99-tail.js'

/** 生成产物头部：一眼能看出这是生成文件，以及由哪些片段按什么顺序拼成。 */
function banner(coreNames, flowNames) {
  return `/**
 * 本文件由 scripts/build-client.mjs 自动生成，请勿直接编辑。
 * 核心组分片（按拼接顺序）：
${coreNames.map((name) => ` *   - lib/client/${name}`).join('\n')}
 *
 * 任务流组（原 dsh-chat-flow，包进一个 IIFE 插在核心组收尾分片之前）：
${flowNames.map((name) => ` *   - lib/client-flow/${name}`).join('\n')}
 *
 * 修改流程：改 lib/client/*.js 或 lib/client-flow/*.js → node scripts/build-client.mjs
 */

`
}

/** 读齐一组分片（同时保留分片名，供检查用）。 */
async function assembleParts(dir) {
  const names = (await readdir(dir))
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
  if (names.length === 0) throw new Error(`没有找到任何客户端分片：${dir}`)
  if (!names[0].startsWith('00-')) throw new Error(`第一个分片必须是 00-head.js，实际是 ${names[0]}`)
  if (!names[names.length - 1].startsWith('99-')) throw new Error(`最后一个分片必须是 99-*.js，实际是 ${names[names.length - 1]}`)
  const parts = []
  for (const name of names) parts.push({ name, text: await readFile(join(dir, name), 'utf8') })
  return { names, parts }
}

/** 用 node --check 校验语法（产物是 ESM，靠 package.json 的 type: module 判定）。 */
function checkSyntax(text) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`产物语法检查失败：\n${result.stderr ?? ''}`)
}

/**
 * 挡住「CSS 模板字符串里混进反引号」这一类坑。
 *
 * 核心组的 `10-style.js` 整张样式表是**一个**模板字符串。里面多一个反引号就会把它提前闭合，
 * 后面的 CSS 变成 JS——这种产物有时仍然语法合法（`--check` 过得去、单测也能跑），
 * 却会让插件在浏览器里**加载失败**：用户看到的是整个界面不见了，报错信息则是一段 CSS 文本。
 * 这个坑已经踩到第三次了，所以在这里机械拦住，不再靠人记住。
 *
 * 规则：`10-style.js` 里只允许出现**两个**反引号，就是模板字符串的首尾。
 * 想在该文件里再写模板字符串，就把那段 JS 挪到别的分片去。
 *
 * 注意只查核心组：任务流组的 `40-style.js` 是**多个**模板字符串（22 个反引号），
 * 它不满足这条约束也不需要满足——所以这条检查不能推广到 flow 组。
 *
 * @param parts - 核心组分片名与内容的数组。
 */
function checkTemplateLiterals(parts) {
  const style = parts.find((part) => part.name === '10-style.js')
  if (style === undefined) return
  const ticks = (style.text.match(/`/g) ?? []).length
  if (ticks !== 2) {
    throw new Error(
      `[WHAT] 10-style.js 里有 ${ticks} 个反引号，只允许有 2 个（样式表模板字符串的首尾）。\n` +
        '[WHY] 样式表整体是一个模板字符串；多出来的反引号会提前闭合它，把后面的 CSS 变成 JS。' +
        '产物可能仍然语法合法、单测也能过，但插件会在浏览器里加载失败（表现为整个界面消失）。\n' +
        '[FIX] 把 CSS 注释里的反引号换成「」或直接去掉；确实需要新的模板字符串时，把那段 JS 挪到别的分片。',
    )
  }
}

/**
 * 挡住「任务流分片带着自己的 loader 外壳被复制进来」这一类坑。
 *
 * 任务流是从一个独立插件复制过来的，那些分片原本自带 `window.__ModuleLoader__.load(...)` 开头与
 * `return module.exports` 收尾。带着它们拼进核心组，产物会变成**两个** bundle 注册（第二个还会
 * 覆盖第一个的 id），或者直接语法不通。这里要求：任务流组的 head 不提 `__ModuleLoader__`、
 * tail 不 `return module.exports`——它只留工厂体内的代码，外壳由核心组负责。
 *
 * @param parts - 任务流组分片名与内容的数组。
 */
function checkFlowShell(parts) {
  const head = parts.find((part) => part.name === '00-head.js')
  const tail = parts.find((part) => part.name === '99-tail.js')
  // 只在**代码行**上匹配：这些分片的注释里会提到外壳长什么样（说明为什么被删掉），不能算违规。
  const loaderCall = /^\s*(?:window\.)?__ModuleLoader__\s*\.\s*load\s*\(/m
  const moduleReturn = /^\s*return\s+module\.exports\s*$/m
  if (head !== undefined && loaderCall.test(head.text)) {
    throw new Error(
      '[WHAT] lib/client-flow/00-head.js 里还有 __ModuleLoader__.load(...)（任务流分片带回了自己的 loader 外壳）。\n' +
        '[WHY] 合并后只允许核心组的 00-head.js 开工厂；多一个注册会覆盖前一个 bundle 的 id。\n' +
        '[FIX] 删掉该文件里的 loader 外壳，只保留工厂体内的代码。',
    )
  }
  if (tail !== undefined && moduleReturn.test(tail.text)) {
    throw new Error(
      '[WHAT] lib/client-flow/99-tail.js 里还有 return module.exports（任务流分片带回了自己的收尾）。\n' +
        '[WHY] 收尾由核心组的 99-tail.js 统一负责，它要把整个任务流组收成 const chatFlow。\n' +
        '[FIX] 删掉该文件末尾的 return module.exports 与外层收尾括号。',
    )
  }
}

/** 把任务流组包成一个 IIFE——它的变量不能泄漏进核心组的作用域。 */
function wrapFlow(parts) {
  return `    /* ──────────────── 任务流半侧（原 dsh-chat-flow）：独立 IIFE ──────────────── */
    // 两组都有自己的 \`h\` / \`inject\` / \`NS\` / \`STYLE_ID\` 等顶层声明，同处一个作用域会语法冲突，
    // 所以整组关进 IIFE；下面的 \`module\`/\`exports\` 就是它原来的 bundle 收尾所需的那两个变量。
    const chatFlow = (function () {
      var module = { exports: {} }
      var exports = module.exports
${parts.map((part) => part.text).join('')}
      return module.exports
    })()

`
}

/** 主流程。 */
async function main() {
  const checkOnly = process.argv.includes('--check')
  const core = await assembleParts(CORE_DIR)
  const flow = await assembleParts(FLOW_DIR)
  checkTemplateLiterals(core.parts)
  checkFlowShell(flow.parts)
  if (!core.parts.some((part) => part.name === CORE_TAIL)) {
    throw new Error(`核心组里找不到收尾分片 ${CORE_TAIL}，无法插入任务流组`)
  }

  const bodies = core.parts
    .map((part) => (part.name === CORE_TAIL ? wrapFlow(flow.parts) + part.text : part.text))
    .join('')
  const text = banner(core.names, flow.names) + bodies
  checkSyntax(text)

  const summary = `核心 ${core.names.length} + 任务流 ${flow.names.length}`
  if (checkOnly) {
    let existing
    try {
      existing = await readFile(OUTPUT, 'utf8')
    } catch {
      throw new Error('lib/client.js 不存在，请先跑一次 node scripts/build-client.mjs')
    }
    if (existing !== text) throw new Error('lib/client.js 与 lib/client/*.js / lib/client-flow/*.js 不同步，请重新生成')
    console.log(`✅ lib/client.js 与 ${core.names.length + flow.names.length} 个分片一致（${summary}，${(text.length / 1024).toFixed(1)} KB）`)
    return
  }

  await writeFile(OUTPUT, text, 'utf8')
  console.log(`✅ 已生成 lib/client.js（${summary} 个分片，${(text.length / 1024).toFixed(1)} KB）`)
}

await main()
