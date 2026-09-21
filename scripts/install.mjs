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
 * 用 dsh CLI 组合一次配置并断言插件行在。
 *
 * 组合失败会以非零退出码 + 原因返回，此时应立即回滚——绝不让脏配置留到重启后的桌面壳去踩。
 *
 * @param profile - profile 名。
 * @returns `{ ok, detail }`。
 */
function validateComposition(profile) {
  const bin = join(harnessRoot(), 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(bin)) return { ok: false, detail: `找不到 dsh CLI：${bin}` }
  const result = spawnSync(process.execPath, [bin, '--profile', profile, '--dump-config'], {
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  })
  if (result.status !== 0) {
    return { ok: false, detail: `--dump-config 退出码 ${result.status}：${(result.stderr ?? '').slice(0, 600)}` }
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
    packageJson.dependencies[PACKAGE_NAME] = `file:${SOURCE.replace(/\\/g, '/')}`
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
  if (validation.ok) {
    console.log(`✅ ${validation.detail}`)
    console.log('\n下一步：重启 DSH Desktop（桌面壳只在启动时组合 profile），然后点侧边栏底部「设置」上方的「控制中心」。')
    console.log('   客户端 bundle 已被浏览器按 URL 缓存：重启后若看不到新界面，用 Ctrl+R 强制刷新一次页面。')
  } else {
    console.log(`❌ 组合配置校验失败：${validation.detail}`)
    console.log('   请执行 `node scripts/install.mjs --revert` 回滚，再排查原因。')
    process.exitCode = 1
  }
}

await main()
