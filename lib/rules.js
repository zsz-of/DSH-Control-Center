/**
 * 规则模型：解析 / 序列化 / 注入渲染。
 *
 * 两种模式（需求一.3）：
 * - `always` —— **强加载**：正文全文注入每个会话的持久基线，模型必然读到。
 * - `ondemand` —— **允许自己读取**：正文**不进**上下文，只注入「名称 + 描述 + 绝对路径」索引，
 *   模型判断相关后用 `read` 工具按路径取正文。这样既不占常驻预算，也保证一定读得到。
 *
 * 「无论哪种模式都能被 AI 读取到」的保证来自两点：索引里**永远带绝对路径**，
 * 以及强加载规则一旦超出预算就**降级为索引行**（而不是消失）。
 *
 * 本模块不 import cordis，可用 `node --test` 直接验证。
 *
 * @module dsh-control-center/rules
 */

import { createHash } from 'node:crypto'
import { byteLength, parseDocument, serializeDocument, truncateBytes } from './profile.js'

/** 规则的两种注入模式。 */
export const RULE_MODES = ['always', 'ondemand']

/** 模式的中文标签（UI 与注入文本共用，避免两处措辞漂移）。 */
export const MODE_LABELS = {
  always: '强加载',
  ondemand: '允许自己读取',
}

/** 注入文本的开场说明：只讲框架与优先级，不复述规则正文。 */
const INTRO = [
  '以下用户规则对本对话的每一步都有效，必须遵守。',
  '更具体的指令优先于更宽泛的指令；它们不覆盖 system、developer 或用户的直接指令。',
].join('\n')

const HEAD = '<system-reminder>\n'
const TAIL = '\n</system-reminder>'
const INLINE_HEAD = '\n## 强加载规则（全文）\n'
const INDEX_HEAD =
  '\n## 其余规则（本轮未展开正文）\n需要时用 read 工具按下列**绝对路径**读取正文，不要凭标题猜测内容。\n'
const REASON_DEFERRED = '强加载·正文超预算'
const REASON_ONDEMAND = '按需'

/** 极端分支里「已省略 N 条」的说明行；`omitted` 为 0 时不产生说明。 */
function omittedNoteFor(omitted) {
  return omitted > 0 ? `\n（索引超预算，已省略 ${omitted} 条按需规则，请在设置页精简规则数量）` : ''
}

/**
 * 把仓库控制的文本里可能出现的字面 `</system-reminder>` 转义，
 * 否则规则正文可以提前关闭插件自己开的框架。
 *
 * @param text - 待注入的原始文本。
 * @returns 已转义文本。
 */
export function escapeReminder(text) {
  return text.replace(/<\/system-reminder>/gi, '<\\/system-reminder>')
}

/**
 * 解析一条规则文件。
 *
 * 模式判定顺序：`mode` 优先；否则兼容 TRAE 的 `alwaysApply`（`true` → 强加载，
 * `false` → 按需）；都没有则默认按需——默认**不**常驻是安全的一侧。
 *
 * @param file - 文件名（含 `.md`）。
 * @param text - 文件全文。
 * @param path - 绝对路径（用于索引行）。
 * @returns 规则对象。
 */
export function parseRule(file, text, path) {
  const { data, extra, body } = parseDocument(text)
  const declared = typeof data.mode === 'string' ? data.mode.trim().toLowerCase() : undefined
  const mode = RULE_MODES.includes(declared)
    ? declared
    : data.alwaysApply === true
      ? 'always'
      : 'ondemand'
  const trimmedBody = body.replace(/^\s*\n/, '').replace(/\s+$/, '')
  return {
    file,
    path,
    name:
      typeof data.name === 'string' && data.name.trim().length > 0
        ? data.name.trim()
        : file.replace(/\.md$/i, ''),
    description: typeof data.description === 'string' ? data.description.trim() : '',
    mode,
    enabled: data.enabled !== false,
    body: trimmedBody,
    extra,
    bytes: byteLength(trimmedBody),
  }
}

/**
 * 把规则对象写回文件文本。
 *
 * `enabled` 只在显式停用时写出，`description` 为空则省略——让文件保持最小。
 *
 * @param rule - 规则对象。
 * @returns 文件全文。
 */
export function serializeRule(rule) {
  return serializeDocument(
    {
      name: rule.name,
      description: rule.description.length > 0 ? rule.description : undefined,
      mode: rule.mode,
      enabled: rule.enabled === false ? false : undefined,
    },
    rule.body,
    rule.extra ?? [],
  )
}

/** 一条索引行：名称、绝对路径、描述、作用域、模式原因。 */
function indexLine(rule, reason) {
  const description = rule.description.length > 0 ? ` — ${rule.description}` : ''
  const origin = rule.scope === 'project' ? '项目规则 | ' : ''
  return `- ${rule.name}（\`${rule.path}\`）${description} [${origin}${reason}]`
}

/** 一条强加载规则的标题块。 */
function headingOf(rule) {
  const description = rule.description.length > 0 ? `\n${rule.description}` : ''
  const origin = rule.scope === 'project' ? '（项目规则）' : ''
  return `\n### ${rule.name}${origin}${description}\n`
}

/**
 * 渲染注入文本，并施加 `maxBytes` 硬上限。
 *
 * 采用**测量驱动**而非预算算术：每轮真正把候选文本拼出来再量字节数，装不下就降级一层。
 * 这样「渲染结果永不超预算」是由构造保证的，不会因为预算公式与真实拼接方式漂移而出错
 * （早期版本正是栽在 `INTRO` 漏算上）。
 *
 * 降级阶梯（保证可达性优先）：
 * 1. 全部强加载规则带正文；
 * 2. 从**末尾**逐条把强加载规则降级为索引行（正文不进上下文，但**绝对路径一定在**）；
 * 3. 按需规则的索引行从后往前让位，并写明省略数量；
 * 4. 最后才退化为开场说明。
 *
 * 刻意**不做「半截正文」**：规则被截断一半，模型可能照着残缺条款执行，比完全不注入正文更危险；
 * 降级为索引行（附绝对路径、要求按需读取）在语义上永远正确。
 *
 * @param rules - 全部规则（含停用的；本函数自行过滤）。
 * @param maxBytes - 渲染结果的字节上限。
 * @returns 注入文本，或 `undefined`（没有启用中的规则时）。
 */
export function renderInjection(rules, maxBytes) {
  const active = rules.filter((rule) => rule.enabled !== false)
  if (active.length === 0) return undefined
  const always = active.filter((rule) => rule.mode === 'always')
  const ondemand = active.filter((rule) => rule.mode !== 'always')
  const fixedHead = `${HEAD}${INTRO}\n`

  /**
   * 组装一份候选文本。
   * @param inlinedCount - 前 N 条强加载规则注入正文，其余降级为索引行。
   * @param listedOndemand - 要列进索引的按需规则。
   * @param omittedNote - 索引被裁剪时附加的说明行。
   * @returns 候选注入文本。
   */
  function assemble(inlinedCount, listedOndemand, omittedNote) {
    const inlined = always.slice(0, inlinedCount)
    const deferred = always.slice(inlinedCount)
    const bodies = inlined
      .map((rule, index) => {
        const head = index === 0 ? INLINE_HEAD : ''
        return `${head}${headingOf(rule)}${escapeReminder(rule.body)}\n`
      })
      .join('')
    const indexLines = [
      ...deferred.map((rule) => indexLine(rule, REASON_DEFERRED)),
      ...listedOndemand.map((rule) => indexLine(rule, REASON_ONDEMAND)),
    ]
    const indexBlock =
      indexLines.length === 0 && omittedNote.length === 0
        ? ''
        : `${INDEX_HEAD}${indexLines.join('\n')}${omittedNote}`
    return `${fixedHead}${bodies}${indexBlock}${TAIL}`
  }

  // 阶梯 1 → 2：尽量多带正文；从末尾逐条降级直到装得下。
  for (let count = always.length; count > 0; count -= 1) {
    const text = assemble(count, ondemand, '')
    if (byteLength(text) <= maxBytes) return text
  }

  // 阶梯 2：强加载全部降级为索引行（此时所有规则的绝对路径都可达）。
  const indexed = assemble(0, ondemand, '')
  if (byteLength(indexed) <= maxBytes) return indexed

  // 阶梯 3：索引本身超预算——按需规则的索引行从后往前让位，并写明省略数量。
  for (let keep = ondemand.length - 1; keep >= 0; keep -= 1) {
    const text = assemble(0, ondemand.slice(0, keep), omittedNoteFor(ondemand.length - keep))
    if (byteLength(text) <= maxBytes) return text
  }

  // 阶梯 4：连强加载规则的索引行都放不下（预算被设得极小）——只保留开场说明。
  const minimal = assemble(0, [], omittedNoteFor(ondemand.length))
  return byteLength(minimal) <= maxBytes ? minimal : truncateBytes(fixedHead, maxBytes)
}

/** 注入文本的内容摘要，用于「规则没变就不重复注入」。 */
export function digest(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex')
}
