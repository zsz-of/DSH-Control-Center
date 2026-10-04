/**
 * 安装脚本的 profile spec 写法规格锁。
 *
 * 不是形式主义：profile `dependencies` 里写成**绝对 `file:`** 会让桌面壳 bundled 的 pnpm 10
 * 把盘符路径当相对路径拼接，`pnpm install` 在 `profiles/web` 里当场
 * `ENOENT: no such file or directory, scandir '<profile>\D:\...'`；这步每个维护周期都跑，
 * 失败会让桌面壳放弃市场基线并进安全模式（机制与实测见 `scripts/install.mjs` 的 `dependencySpec()`）。
 * 这里只锁「写法」这一个可静态检查的事实，不需要 @deepseek-ai 链接，因此永不被跳过。
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const INSTALL_SCRIPT = join(HERE, '..', 'scripts', 'install.mjs')
const source = readFileSync(INSTALL_SCRIPT, 'utf8')

test('profile 依赖 spec 写 link:，绝不写绝对 file:', () => {
  assert.ok(
    source.includes('link:${SOURCE'),
    'install.mjs 必须把依赖写成 `link:<posix 绝对路径>`：绝对 `file:` 会被 pnpm 10 当相对路径拼在 profile 后面并 ENOENT',
  )
  assert.ok(
    !source.includes('file:${SOURCE'),
    'install.mjs 不能再出现绝对 `file:` spec（`file:D:/…`、`file:///D:/…` 实测同样 ENOENT）',
  )
  assert.ok(
    source.includes('packageJson.dependencies[PACKAGE_NAME] = `link:'),
    'dependencies 的赋值必须直接写成 link: 形式（没有中间函数时，注释里的理由与真实写值更要绑死）',
  )
})
