/**
 * 把本插件安装进一个 DSH profile（默认 `web`），或回滚安装。
 *
 * 安装做三件事（全部幂等，可重复执行）：
 * 0. 先用 `scripts/build-client.mjs` 把 `lib/client/*.js` 拼成 `lib/client.js`。
 *    产物是**唯一**被浏览器加载的客户端文件（DSH 只按 `exports["./client"]` 给一个 URL），
 *    所以装之前必须先保证它是最新的——否则源码改了、线上跑的还是旧 bundle。
 * 1. `Source/node_modules/@deepseek-ai` → 指向 harness 的 `@deepseek-ai`。
 *    这是必需的：插件以**链接**方式装进 profile 后，Node 会从真实路径向上找依赖，
 *    只有补齐这一层 `@deepseek-ai/*` 才能解析出 `dsh-llm` / `dsh-mcp-client`。
 * 2. `<profile>/node_modules/dsh-control-center` → 指向本仓库 `Source/`（junction）。
 *    用链接而不是复制：改代码即生效，不存在「两份源码互相漂移」。
 * 3. `<profile>/package.json`：加进 `dependencies` 与 `dsh.profile.bundles`。
 *    bundles 才是真正的挂载名单；本包自带的 `cordis.patch.yml`（`dsh.bundle.patch`）
 *    负责插入插件行，因此**不需要动 profile 的 patch 文件**——少一处可能写坏配置的地方。
 *
 * 技能目录 `~/.dsh/skills` 的接入**不在这里**：host 层的 `skill-filesystem` 在当前 web 组合里
 * 被刻意禁用（本地发现由每个 agent preset 自己挂载），所以技能由本插件注册 provider 到
 * registry 的全局层实现——那是仓库插件提供技能的官方接缝。
 *
 * 装完会用 `dsh --profile <p> --dump-config` **组合一次配置并断言结果**——
 * 这是不启动服务就能验证「脏配置会不会把桌面壳搞崩」的手段。
 * 找不到 CLI（老壳/新壳两种布局都没命中，可用 `DSH_BIN` 指定）或 profile 由
 * 桌面应用独占管理（`desktop`）时，这一步记为「跳过」而不是失败。
 *
 * 用法：
 *   node scripts/install.mjs                 # 安装到 web profile
 *   node scripts/install.mjs --profile web
 *   node scripts/install.mjs --revert        # 回滚
 *   node scripts/install.mjs --dry-run       # 只打印将要做的改动
 *
 * @module dsh-control-center/scripts/install
 */

import { existsSync } from 'node:fs'
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(HERE, '..')
const PACKAGE_NAME = 'dsh-control-center'
/** 组合结果里出现的插件行 id（与 `cordis.patch.yml` 的 insert 行一致）。 */
const PLUGIN_ID = 'control-center'

/** 解析命令行参数。 */
function parseArgs(argv) {
  const options = { profile: 'web', revert: false, dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--profile') {
      options.profile = argv[index + 1]
      index += 1
    } else if (token === '--revert') options.revert = true
    else if (token === '--dry-run') options.dryRun = true
  }
  return options
}

/** 定位 harness 根目录（$DSH_HOME 优先）。 */
function harnessRoot() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, 'dsh-desktop', 'harness')
  }
  return join(homedir(), '.dsh')
}

/** 判断路径是否存在。 */
async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 建立 junction（Windows 上 junction 不需要管理员权限）。 */
async function link(source, target, dryRun) {
  if (await exists(target)) return 'skipped'
  if (dryRun) return 'would-create'
  await mkdir(dirname(target), { recursive: true })
  await symlink(source, target, 'junction')
  return 'created'
}

/**
 * 找出可用的 dsh CLI。
 *
 * 布局有两代：老版桌面壳把 CLI 装在 `$DSH_HOME/profiles/node_modules`，
 * 新版（DSH NEXT）由 Electron 应用自带，放在应用目录的 `resources/app/node_modules`。
 * 两者都找不到时可以用 `DSH_BIN` 环境变量直接指定 bin.js。
 *
 * @returns 绝对路径；找不到时 `undefined`。
 */
function findCliBin() {
  const override = process.env.DSH_BIN
  if (typeof override === 'string' && override.length > 0 && existsSync(override)) return override
  const candidates = [join(harnessRoot(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')]
  const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
  for (const base of bases) {
    if (typeof base !== 'string' || base.length === 0) continue
    for (const product of ['DSH NEXT', 'DSH Desktop', 'dsh-desktop']) {
      candidates.push(join(base, product, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      candidates.push(
        join(base, 'Programs', product, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      )
    }
  }
  return candidates.find((path) => existsSync(path))
}

/**
 * 用 dsh CLI 组合一次配置并断言插件行在。
 *
 * 组合失败会以非零退出码 + 原因返回，此时应立即回滚——绝不让脏配置留到重启后的桌面壳去踩。
 *
 * 两种「校验不了」的情况不算失败：找不到 CLI（老壳/新壳布局都没命中）、
 * 或者 profile 被桌面应用独占管理（`desktop` 这个名字 CLI 一律拒绝组合）。
 * 它们记为 `skipped`，由调用方提示用户重启桌面壳亲眼确认。
 *
 * @param profile - profile 名。
 * @returns `{ ok, skipped?, detail }`。
 */
function validateComposition(profile) {
  const bin = findCliBin()
  if (bin === undefined) {
    return { ok: true, skipped: true, detail: '找不到 dsh CLI，跳过组合校验（可用 DSH_BIN=<bin.js 路径> 指定）' }
  }
  const result = spawnSync(process.execPath, [bin, '--profile', profile, '--dump-config'], {
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  })
  if (result.status !== 0) {
    const stderr = result.stderr ?? ''
    if (stderr.includes('managed exclusively')) {
      return {
        ok: true,
        skipped: true,
        detail: `profile "${profile}" 由桌面应用独占管理，CLI 拒绝组合——重启桌面壳即可生效`,
      }
    }
    return { ok: false, detail: `--dump-config 退出码 ${result.status}：${stderr.slice(0, 600)}` }
  }
  const text = result.stdout ?? ''
  if (!new RegExp(`^\\s*- id: ${PLUGIN_ID}$`, 'm').test(text)) {
    return { ok: false, detail: `组合结果里没有 ${PLUGIN_ID} 插件行` }
  }
  return { ok: true, detail: '组合配置校验通过（插件行已进入 profile）' }
}

/** 组合校验前先把客户端 bundle 重新生成一遍。 */
function buildClient() {
  const script = join(SOURCE, 'scripts', 'build-client.mjs')
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: SOURCE, windowsHide: true })
  if (result.status !== 0) throw new Error(`客户端 bundle 生成失败：${(result.stderr ?? '').slice(0, 600)}`)
  return (result.stdout ?? '').trim()
}

/** 主流程。 */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const root = harnessRoot()
  const profileRoot = join(root, 'profiles', options.profile)
  const nodeModules = join(profileRoot, 'node_modules')
  const packageJsonPath = join(profileRoot, 'package.json')

  if (!(await exists(packageJsonPath))) {
    throw new Error(`profile 不存在或缺少 package.json：${packageJsonPath}`)
  }
  if (!options.revert && !options.dryRun) console.log(`- client bundle : ${buildClient()}`)
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const bundles = packageJson.dsh?.profile?.bundles ?? []
  const listed = Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)

  const peerLink = join(SOURCE, 'node_modules', '@deepseek-ai')
  const peerTarget = join(root, 'profiles', 'node_modules', '@deepseek-ai')
  const pluginLink = join(nodeModules, PACKAGE_NAME)

  console.log(`harness : ${root}`)
  console.log(`profile : ${options.profile}  (${profileRoot})`)
  console.log(`source  : ${SOURCE}`)
  console.log(`模式    : ${options.revert ? '回滚' : '安装'}${options.dryRun ? '（dry-run）' : ''}`)
  console.log('')

  if (options.revert) {
    if (await exists(pluginLink)) {
      if (!options.dryRun) await rm(pluginLink, { recursive: false, force: true })
      console.log(`- 移除插件链接 : ${pluginLink}`)
    } else {
      console.log('- 移除插件链接 : 不存在，跳过')
    }
    if (listed) {
      packageJson.dsh.profile.bundles = bundles.filter((name) => name !== PACKAGE_NAME)
      if (packageJson.dependencies !== undefined) delete packageJson.dependencies[PACKAGE_NAME]
      if (!options.dryRun) await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
      console.log(`- package.json : 已摘除 ${PACKAGE_NAME}`)
    } else {
      console.log('- package.json : 不在 bundles 名单中，跳过')
    }
    console.log(`\n回滚完成（${peerLink} 保留：那是开发态依赖链接，可留可删）。`)
    return
  }

  console.log(`- peer 依赖链接 : ${await link(peerTarget, peerLink, options.dryRun)}`)
  console.log(`- 插件链接      : ${await link(SOURCE, pluginLink, options.dryRun)}`)
  if (!listed) {
    packageJson.dsh = packageJson.dsh ?? {}
    packageJson.dsh.profile = packageJson.dsh.profile ?? {}
    packageJson.dsh.profile.bundles = [...(packageJson.dsh.profile.bundles ?? []), PACKAGE_NAME]
    packageJson.dependencies = packageJson.dependencies ?? {}
    // 必须用 link:，不能写 file:——桌面壳 bundled 的 pnpm 会把**绝对** file: spec 当相对路径，
    // 在 profile 目录下拼出 `<profile>\D:\…` 并 ENOENT，桌面壳随后放弃市场基线并进安全模式。
    // 实测 file:D:/…、file:///D:/…、反斜杠形式全部 ENOENT；link: 建 junction 且可重复安装。
    packageJson.dependencies[PACKAGE_NAME] = `link:${SOURCE.replace(/\\/g, '/')}`
    if (!options.dryRun) await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
    console.log('- package.json  : 已加入 dependencies 与 dsh.profile.bundles')
  } else {
    console.log('- package.json  : 已在 bundles 名单中，跳过')
  }

  if (options.dryRun) {
    console.log('\ndry-run 结束，未写入任何文件。')
    return
  }

  const validation = validateComposition(options.profile)
  console.log('')
  if (!validation.ok) {
    console.log(`❌ 组合配置校验失败：${validation.detail}`)
    console.log('   请执行 `node scripts/install.mjs --revert` 回滚，再排查原因。')
    process.exitCode = 1
    return
  }
  console.log(`${validation.skipped ? '⚠️' : '✅'} ${validation.detail}`)
  if (validation.skipped) {
    console.log('   这一步只改了 profile 的 dependencies 与 bundles，改坏了也只是少挂/多挂一个插件；')
    console.log('   重启后再跑一次本脚本（或看桌面壳日志）即可确认。')
  }
  console.log('\n下一步：重启 DSH Desktop（桌面壳只在启动时组合 profile），然后点侧边栏底部「设置」上方的「控制中心」。')
  console.log('   客户端 bundle 已被浏览器按 URL 缓存：重启后若看不到新界面，用 Ctrl+R 强制刷新一次页面。')
}

await main()
