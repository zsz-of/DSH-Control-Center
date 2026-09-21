/**
 * 把 `lib/client/*.js` 按文件名顺序拼成 `lib/client.js`。
 *
 * **为什么要有这一步**：DSH 只按 `exports["./client"]` 给插件**一个** URL
 * （`/plugins/<id>/client.js`），浏览器侧拿不到第二个文件，所以产物必须是单文件；
 * 但把七个标签页塞进一个文件里改起来是灾难。折中方案是把源码按领域切成若干片段、
 * 用一个零依赖的拼接脚本生成产物——不是打包链，没有转译、没有依赖解析，只有 `join`。
 *
 * 约定：
 * - 片段只写「工厂函数体内的代码」，`00-head.js` 开工厂、`99-tail.js` 收工厂并导出；
 * - 产物带生成标记与片段清单，便于确认线上跑的到底是哪一份；
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
const PARTS_DIR = join(LIB, 'client')
const OUTPUT = join(LIB, 'client.js')

/** 生成产物头部：一眼能看出这是生成文件，以及由哪些片段拼成。 */
function banner(parts) {
  return `/**
 * 本文件由 scripts/build-client.mjs 自动生成，请勿直接编辑。
 * 源码分片（按拼接顺序）：
${parts.map((name) => ` *   - lib/client/${name}`).join('\n')}
 *
 * 修改流程：改 lib/client/*.js → node scripts/build-client.mjs
 */

`
}

/** 读齐全部片段（同时保留分片名，供检查用）。 */
async function assembleParts() {
  const names = (await readdir(PARTS_DIR))
    .filter((name) => name.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b))
  if (names.length === 0) throw new Error(`没有找到任何客户端分片：${PARTS_DIR}`)
  if (!names[0].startsWith('00-')) throw new Error(`第一个分片必须是 00-head.js，实际是 ${names[0]}`)
  if (!names[names.length - 1].startsWith('99-')) throw new Error(`最后一个分片必须是 99-*.js，实际是 ${names[names.length - 1]}`)
  const parts = []
  for (const name of names) parts.push({ name, text: await readFile(join(PARTS_DIR, name), 'utf8') })
  return { text: banner(names) + parts.map((part) => part.text).join(''), names, parts }
}

/** 用 node --check 校验语法（产物是 ESM，靠 package.json 的 type: module 判定）。 */
function checkSyntax(text) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: text, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`产物语法检查失败：\n${result.stderr ?? ''}`)
}

/**
 * 挡住「CSS 模板字符串里混进反引号」这一类坑。
 *
 * `10-style.js` 的整张样式表是**一个**模板字符串。里面多一个反引号就会把它提前闭合，
 * 后面的 CSS 变成 JS——这种产物有时仍然语法合法（`--check` 过得去、单测也能跑），
 * 却会让插件在浏览器里**加载失败**：用户看到的是整个界面不见了，报错信息则是一段 CSS 文本。
 * 这个坑已经踩到第三次了，所以在这里机械拦住，不再靠人记住。
 *
 * 规则：`10-style.js` 里只允许出现**两个**反引号，就是模板字符串的首尾。
 * 想在该文件里再写模板字符串，就把那段 JS 挪到别的分片去。
 *
 * @param parts - 分片名与内容的数组。
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

/** 主流程。 */
async function main() {
  const checkOnly = process.argv.includes('--check')
  const parts = await assembleParts()
  checkTemplateLiterals(parts.parts)
  const { text, names } = parts
  checkSyntax(text)

  if (checkOnly) {
    let existing
    try {
      existing = await readFile(OUTPUT, 'utf8')
    } catch {
      throw new Error('lib/client.js 不存在，请先跑一次 node scripts/build-client.mjs')
    }
    if (existing !== text) throw new Error('lib/client.js 与 lib/client/*.js 不同步，请重新生成')
    console.log(`✅ lib/client.js 与 ${names.length} 个分片一致（${(text.length / 1024).toFixed(1)} KB）`)
    return
  }

  await writeFile(OUTPUT, text, 'utf8')
  console.log(`✅ 已生成 lib/client.js（${names.length} 个分片，${(text.length / 1024).toFixed(1)} KB）`)
}

await main()
