/**
 * 把一份现成的规则目录导入 `~/.dsh/rules`，供设置页统一管理。
 *
 * 用途一：把 TRAE 的 `~/.trae-cn/user_rules` 一次性搬进来。
 * 用途二：把散落在各处的规则（例如 `$DSH_HOME/AGENTS.md`、baize 的 `global.json`）收拢成单一真源。
 *
 * 导入语义（刻意保守，避免误伤已有规则）：
 * - **同名文件已存在则跳过**，不覆盖——已有内容优先，需要更新请显式加 `--overwrite`。
 * - 兼容 TRAE 的 `alwaysApply: true`：转写成 `mode: always`（强加载），其余为 `mode: ondemand`。
 * - **描述沿用源目录 `AGENTS.md` 索引里的那行说明**：注入给模型的索引只有名称 + 路径 + 描述，
 *   描述为空索引就退化成一张文件名清单，所以宁可在这里多解析一次源索引。
 * - `--always <文件名…>` 可把指定文件强制提升为强加载（用于把总则类文档常驻）。
 * - `--exclude <文件名…>` 跳过指定文件（典型用法：排除源目录自己的 `AGENTS.md` 索引——
 *   设置页会实时生成一份等价索引，多一份只会漂移）。
 *
 * 用法：
 *   node scripts/import-rules.mjs --from "C:\\Users\\zhong\\.trae-cn\\user_rules" \
 *        --always "00-驾驭工程核心规则.md" --exclude "AGENTS.md"
 *   node scripts/import-rules.mjs --from <file.md> --name "全局开发规则"
 *
 * @module dsh-control-center/scripts/import-rules
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { parseRule, serializeRule } from '../lib/rules.js'

const RULES_DIR = join(homedir(), '.dsh', 'rules')

/** 解析参数。 */
function parseArgs(argv) {
  const options = { from: undefined, always: [], exclude: [], overwrite: false, name: undefined, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--from') {
      options.from = argv[index + 1]
      index += 1
    } else if (token === '--always') {
      options.always.push(argv[index + 1])
      index += 1
    } else if (token === '--exclude') {
      options.exclude.push(argv[index + 1])
      index += 1
    } else if (token === '--name') {
      options.name = argv[index + 1]
      index += 1
    } else if (token === '--overwrite') options.overwrite = true
    else if (token === '--dry-run') options.dryRun = true
  }
  return options
}

/**
 * 从源目录的 `AGENTS.md` 索引里抽出「文件名 → 一行描述」。
 *
 * 只认 markdown 链接行：`- [xx.md](xx.md) — 描述`（分隔符用 `—` 或 `-`）。
 *
 * @param dir - 源目录。
 * @returns `Map<string, string>`（文件不存在或没有匹配行时为空表）。
 */
async function readIndexDescriptions(dir) {
  const indexPath = join(dir, 'AGENTS.md')
  if (!existsSync(indexPath)) return new Map()
  const text = await readFile(indexPath, 'utf8')
  const descriptions = new Map()
  for (const line of text.split('\n')) {
    const match = /^\s*[-*]\s*\[([^\]]+\.md)\]\([^)]*\)\s*(?:—|--|-)\s*(.+?)\s*$/.exec(line)
    if (match !== null) descriptions.set(match[1], match[2])
  }
  return descriptions
}

/** 收集待导入的 `{ file, text }` 列表。 */
async function collect(options) {
  const source = resolve(options.from)
  if (!existsSync(source)) throw new Error(`源路径不存在：${source}`)
  const entries = await readdir(source, { withFileTypes: true }).catch(() => undefined)
  if (entries === undefined) {
    // 单文件导入：用它当规则名（或 --name 指定）。
    const text = await readFile(source, 'utf8')
    const file = `${(options.name ?? basename(source).replace(/\.md$/i, '')).trim()}.md`
    return { items: [{ file, text }], descriptions: new Map() }
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  const items = []
  for (const file of files) {
    if (options.exclude.includes(file)) continue
    items.push({ file, text: await readFile(join(source, file), 'utf8') })
  }
  return { items, descriptions: await readIndexDescriptions(source) }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.from === undefined) {
    console.error('缺少 --from <目录或 .md 文件>')
    process.exitCode = 1
    return
  }
  const { items, descriptions } = await collect(options)
  if (!options.dryRun) await mkdir(RULES_DIR, { recursive: true })

  let imported = 0
  let skipped = 0
  let promoted = 0
  let described = 0
  for (const item of items) {
    const target = join(RULES_DIR, item.file)
    if (existsSync(target) && !options.overwrite) {
      console.log(`跳过（已存在）  ${item.file}`)
      skipped += 1
      continue
    }
    const parsed = parseRule(item.file, item.text, target)
    if (parsed.description.length === 0) {
      const fromIndex = descriptions.get(item.file)
      if (fromIndex !== undefined) {
        parsed.description = fromIndex
        described += 1
      }
    }
    if (options.always.includes(item.file) && parsed.mode !== 'always') {
      parsed.mode = 'always'
      promoted += 1
    }
    if (!options.dryRun) await writeFile(target, serializeRule(parsed), 'utf8')
    console.log(
      `${options.dryRun ? '将导入' : '已导入'}        ${item.file}  [${parsed.mode === 'always' ? '强加载' : '按需'}]${parsed.description === '' ? '  ⚠ 无描述' : ''}`,
    )
    imported += 1
  }
  console.log('')
  console.log(`规则目录   : ${RULES_DIR}`)
  console.log(
    `导入 ${imported} 条，跳过 ${skipped} 条${promoted > 0 ? `，提升为强加载 ${promoted} 条` : ''}${described > 0 ? `，从源索引补上描述 ${described} 条` : ''}。`,
  )
  if (options.dryRun) console.log('（dry-run，未写入任何文件）')
}

await main()
