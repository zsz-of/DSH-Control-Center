# DSH Control Center

> 把 DSH 里分散的**规则 / 技能 / 记忆 / MCP 服务器 / 备份 / 跨客户端导入**收进同一个图形化控制中心，
> 并在聊天输入框上提供一个「AI 提示词优化」按钮。

开发者：zsz 和 DeepSeek
版本：0.2.0
编写语言：JavaScript（ESM，Node.js 20+，运行时零第三方依赖）
依赖环境：宿主平台 DeepSeek Harness（dsh）0.1.2-rc.1+ 及其 peer 包
（`@deepseek-ai/cordis`、`dsh-agent`、`dsh-fs`、`dsh-host-webserver`、`dsh-llm`、`dsh-mcp-client`、`dsh-skill`），
由 dsh 以链接方式提供，随宿主版本走，不需要额外安装
系统要求：Windows 10 1809+ / macOS 12+ / Linux；DeepSeek Harness（dsh）0.1.2-rc.1+；Node.js 20+

## 安装

本插件安装在 dsh 的某个 profile 下（桌面壳用 `web`）：

```bash
git clone <本仓库> DSH-Control-Center
cd DSH-Control-Center                 # 仓库根就是源码目录
node scripts/install.mjs              # 生成客户端 bundle + 装到 web profile + 组合校验
node scripts/install.mjs --dry-run    # 只看将要做的改动
node scripts/install.mjs --revert     # 回滚安装
```

安装脚本会先 `node scripts/build-client.mjs` 生成 `lib/client.js`，再用
`dsh --profile web --dump-config` 组合一次配置并断言结果——**不启动服务即可确认配置没写坏**。
装完重启 DSH Desktop，从侧边栏底部（「设置」上方）的**控制中心**进入。

### 升级已有安装

host 半侧在 DSH Desktop **启动时**加载，client 半侧由浏览器**按 URL 取**，两者更新时机不同：

1. `node scripts/install.mjs`（自动重新生成客户端 bundle）；
2. **先重启 DSH Desktop**（host 才拿到新的 API 与注入逻辑），再刷新页面。

只刷新页面而没重启时，新客户端会拿到旧 host 的数据：控制中心仍能正常打开
（缺失的分区按空列表处理，见 `lib/client/20-core.js` 的 `withDefaults`），
但记忆 / 导入 / 备份这些新页面会是空的——这是版本错配的表现，不是插件坏了。

## 功能总览

**入口**：侧边栏底部、紧挨着「设置」的**控制中心**按钮，点开是一个**整页**（挂在 `shell.overlay` 上，
覆盖整个窗口而不是设置里的弹窗），因此横向空间比设置分区大得多；页头让开 Windows 窗口按钮那一条，
既不会挡住最小化/最大化/关闭，也不白占空白。

页面分七处：

| 页面 | 能力 |
|---|---|
| **规则** | **全局规则**（`~/.dsh/rules`）、新建 / 编辑 / 删除 / 启停、**强加载**与**普通模式**两种加载方式、搜索、注入占用统计、打开目录 |
| **MCP 服务器** | 图形化增删改启停、stdio 与 streamable-http 两种传输、环境变量与请求头、调用超时、**对 Agent 启用 / 禁用**、每台服务器实时挂载状态与错误原因 |
| **技能** | 新建 / 编辑 / 删除、**对 Agent 启用 / 禁用**、frontmatter（描述 / whenToUse / 手动调用开关）、目录 bundle 与平铺文件两种形态 |
| **记忆** | 跨会话长期记忆：全局 / 项目两种作用域、置顶、标签、逐条启停、注入占用统计 |
| **导入** | 只读扫描本机二十多个 AI 客户端的 MCP 与技能，**勾选**后一次导入 DSH |
| **备份** | 分区可勾选打包；每条历史产物都能**就地还原**或删除；**导入 / 还原都 = 替换当前配置**，动手前把「会覆盖什么、会新建什么」逐项列清楚 |
| **设置** | 提示词优化开关与模型路由、记忆注入开关、备份保留策略、扫描源开关与自定义源 |

**项目规则只在会话里管**：控制中心是全局配置的页面，不掺项目作用域。要改某个工作区的项目规则，
就在那个工作区的会话里点「对话 / **规则** / 轨迹」这一排中的「规则」——工作区由会话自己决定，
不需要手动挑文件夹。

「打开目录 / 打开配置」在打开前会先把目标建出来：`~/.dsh/memory`、`~/.dsh/mcp.json` 这类
「用到才有」的路径首次点击时并不存在，而系统文件管理器对不存在的路径既不报错也不开窗；
要**定位**的那个文件还没建出来时（比如还没写过 MCP 的机器上没有 `mcp.json`），
退回打开它所在的目录——`explorer.exe /select,<不存在的文件>` 会把桌面打开，那等于开错地方；
失败会在右下角浮层里给出原因，不会静默没反应。

**两种「关掉」的含义不同**：MCP 服务器关掉后**不挂载**，它的工具不会出现在任何 agent 的上下文里；
技能关掉后**从技能目录里摘掉**，因此既不注入上下文、也不响应 `/名称` 手动调用，若模型凭旧上下文
再调一次会被明确拒绝并说明原因（`~/.dsh/skills/<名称>/SKILL.md` 里落到 `enabled: false`）。

输入框上还有一处扩展（`conversation.input.*` 插槽）：

- **✨ AI 提示词优化**：点击后把当前草稿交给 DSH 已配置的模型改写，**直接把结果写回输入框**，
  并在旁边给出一次「**撤销**」回到你自己写的原文；
- 优化进行中**只锁文字显示区域**（灰罩 + 从左往右扫过的光效），下排的「+ / 模型 / 发送」按钮照常可用；
- **手机（窄屏 + 触屏）同样可用**：按钮从 27px 高抬到 36px（原来手指按不准），
  320px 宽下也不把发送按钮顶出输入卡片；系统开了「减少动效」时，扫光改成静止的一层柔光。
  失败时那颗按钮**就地**变成红色感叹号，点一下在输入卡片上方弹出失败原因——
  手机上悬停看不到任何提示，所以原因必须点得开；关掉浮层即回到可用的「优化」。

**所有操作结果走右下角浮层提示**，不写进页面正文——页面只呈现「现在的状态」，
不承担「刚才发生了什么」的记录职责。

**三处界面约定**：表单类弹窗统一用 `.dcc-dialog`（宽度 720px 起，宽的用 `.dcc-dialog-wide`），
内容再长也只在弹窗内部滚动，不会被裁掉；**布尔设置项一律是滑块开关**（`Toggle`，原生 checkbox
重绘成 `role="switch"` 的 switch），多选列表用 `PickCard`（整块可点 + 右侧滑块），
但**「从几十条里挑几条」用原生复选框**（备份分区、扫描源是开关；导入页的条目清单是方框）；
不会在选项旁边解释「这个选项是怎么工作的」——选项自己的名字说清楚就够了。

**手机上能点得准、读得到**：触屏（`pointer:coarse`）下按钮抬到 36px 高、悬停效果只在真有指针时
才挂（触屏上 `:hover` 会粘住）、不依赖悬停的提示一律做成「点一下就有」；任何新界面都要保证
**320px 宽不横向溢出**。窄屏的可用宽度很紧：输入框那一行在 320px 下只有 224px，
所以按钮每宽 1px 都会把发送按钮往外顶 1px。

## 让 Agent 自己动手

控制中心里能做的大部分事，Agent 也能通过 `control_center_*` 工具自己做：

| 工具 | 能做什么 | 需要审批 |
|---|---|---|
| `control_center_overview` | 看一眼规则 / 记忆 / MCP / 技能 / 备份的现状 | 否 |
| `control_center_rule_list` | 列规则（可连正文） | 否 |
| **`control_center_rule_write` / `_delete`** | 新建 / 覆盖 / 删除规则 | **是** |
| `control_center_mcp` | MCP 服务器的 list / add / update / remove / enable / disable / reload | 否 |
| `control_center_skill` | 技能的 list / save / remove | 否 |
| `control_center_memory` | 记忆的 list / save / remove / pin / enable / disable | 否 |
| `control_center_import` | 扫描别的客户端并批量导入 | 否 |
| `control_center_settings` | 读写本插件设置 | 否 |
| `control_center_backup` | 备份的 list / sections / create / remove / restore | 否 |

**只有规则写入需要用户点头**：规则是「用户对 AI 的约束」，让 AI 悄悄改自己的约束是唯一不可接受的写入。
这两个工具经 `tools/pre-execute` 返回 `ask`，走平台审批通道在对话里弹确认，用户同意（allowed-once）才落盘。
审批通道受**权限预设**控制：预设里 approval 为 `ask` 时会弹框，为 `never`（如 `danger-full-access`）
时平台会直接拒绝这类调用——那是用户自己关掉的开关，本插件不绕过它。

Agent 改完配置后，host 会 bump 一个版本号；开着的控制中心轮询 `/revision`，发现变化就在几秒内
自动刷新，不会出现「AI 已经改了、界面还显示旧的」的脱节。

## 项目简介

DSH 的规则注入、MCP 挂载、技能发现分别由不同插件承担，各自只有命令行或零散配置文件。
本项目提供一个统一的控制中心（对齐 TRAE 的交互），并明确解决这几件事：

- **规则分两层**。**全局规则**对所有工作区生效；**项目规则**放在工作区自己的 `<工作区>/.dsh/rules` 下，
  只在该工作区的会话里注入。两者格式完全相同，注入时项目规则排在前（预算不够先让位的永远是全局规则），
  索引行会标出`[项目规则 | …]`让模型知道这条是本项目的约定。
- **规则一定能被 AI 读到**。每条规则可选两种加载方式：**强加载**（正文全文注入每个会话）或
  **普通模式**（只注入名称 + 描述 + **绝对路径**，模型按需用 `read` 取正文）。
  超预算时强加载规则**降级为索引行**而不是静默消失，因此两种模式都保证可达。
- **记忆是事实，规则是指令**。记忆按作用域注入：全局记忆每个会话都带上，项目记忆只在
  `cwd` 与登记目录一致时注入。同样有「正文 → 索引行 → 省略说明」的降级阶梯。
- **MCP 改动立即生效**。`~/.dsh/mcp.json` 是唯一真源，插件在启动与每次保存后按它对账
  挂载/卸载 `dsh-mcp-client`，不需要改 profile 配置、不需要重启桌面壳。
  MCP 服务器本体由使用者自行安装，放在哪个目录都可以——这里只登记「怎么启动它」。
- **技能目录与规则目录分开**，由插件注册到技能 registry 的全局层，所有 agent 都能看到。
  每条技能可以**对 Agent 关掉**：关掉后它从技能目录里彻底消失，因此不占注入上下文、`/名称` 也调不到；
  模型若凭旧上下文再调一次，会被明确拒绝并说明是用户关掉的。
- **备份是分区可选的普通 zip**：产物含 `manifest.json`，用资源管理器就能打开；
  **导入即替换**，替换前列出会覆盖/新建哪些文件，并在替换前自动快照当前配置。
- **不重造平台已有的能力**：终端、文件读写、子代理、浏览器自动化、任务清单、目标管理等
  DSH 已经内置（非插件），本项目一概不重复实现，只把「配置与数据」这一类做成界面与工具。

## 目录结构

```
DSH-Control-Center/           ← 仓库根（clone 下来就是源码目录本身）
├── package.json              ← 插件清单：入口、exports、dsh 扩展点、peer 依赖
├── cordis.patch.yml          ← 插件在 profile 里的挂载补丁
├── README.md                 ← 本文档
├── lib/
│   ├── index.js              ← host 插件入口：规则/记忆注入 + 各运行时 + API 接线
│   ├── paths.js              ← ~/.dsh 与 $DSH_HOME 的路径真源、预算与上限常量
│   ├── profile.js            ← frontmatter 读写与文本工具（零第三方依赖）
│   ├── rules.js              ← 规则模型与注入渲染（纯函数，可单测）
│   ├── memory.js             ← 记忆模型、作用域过滤与注入渲染（纯函数，可单测）
│   ├── store.js              ← 规则/技能/MCP 的文件 IO 与校验
│   ├── settings.js           ← 本插件设置（JSON）+ DSH 默认模型读取
│   ├── skills.js             ← ~/.dsh/skills 的技能 provider
│   ├── mcp.js                ← MCP 服务器运行时挂载管理
│   ├── zip.js                ← 极小 zip 读写（存储 + deflate，零依赖）
│   ├── backup.js             ← 备份分区、打包、分析、恢复计划与执行
│   ├── scan.js               ← 跨客户端扫描（JSON/TOML/YAML-ish）与导入
│   ├── optimize.js           ← 提示词优化（复用平台 llm 服务）
│   ├── tools.js              ← 面向模型的 control_center_* 工具 + 规则审批闸门
│   ├── api.js                ← /api/dsh-control-center
│   ├── client/               ← 浏览器侧源码分片（按页面拆分，95-panel 是整页与侧边栏入口）
│   └── client.js             ← 由分片拼接生成的客户端 bundle（勿手改）
├── scripts/
│   ├── build-client.mjs      ← 分片 → lib/client.js（含语法自检、--check 模式）
│   ├── install.mjs           ← 安装/回滚（先构建，再 junction + profile 接线 + 组合校验）
│   └── import-rules.mjs      ← 从既有规则目录批量导入
└── test/                     ← node --test 单元 + 集成测试（133 项）
```

### 为什么客户端是「分片 + 拼接」

DSH 只按 `exports["./client"]` 给插件**一个** URL（`/plugins/<id>/client.js`），浏览器侧拿不到第二个文件，
所以产物必须是单文件；但七个页面全塞进一个文件里改起来是灾难。
折中方案：源码按领域切成 `lib/client/*.js`，用**零依赖的拼接脚本**生成 `lib/client.js`
（没有转译、没有依赖解析，只有 `join`），生成时顺手 `node --check` 一遍语法。
改客户端代码后跑 `node scripts/build-client.mjs`；`install.mjs` 会自动跑它，`--check` 用于校验是否同步。

### 从源码恢复开发环境

```bash
mkdir -p node_modules && ln -s "<DSH_HOME>/profiles/node_modules/@deepseek-ai" node_modules/@deepseek-ai
node --test          # 跑单测（不需要 dsh 在运行）
node scripts/install.mjs
```

`node_modules/@deepseek-ai` 这一层链接是必需的：插件以链接方式装进 profile 后，
Node 会从**真实路径**向上找依赖，只有补齐这一层 `@deepseek-ai/*` 才能解析。
有它的时候，`test/index.test.js`、`test/api.test.js`、`test/tools.test.js`、`test/optimize.test.js`
会用桩上下文把 host 半侧真跑一遍（注入内容、HTTP 端点、工具与审批闸门、优化路由）；
`test/client-render-react.test.js` 用**真实 react-dom** 把每个页面渲染一遍；没有链接则整组跳过。

## 运行方式

插件随 DSH 启动加载，无独立进程、无后台服务：

- host 半侧在 profile 组合时挂载，注册 `agent/pre-step` 注入（全局 + 项目规则、记忆）、HTTP API、
  MCP 运行时、技能 provider、`control_center_*` 工具与规则审批闸门；
- client 半侧由宿主按 `/plugins/dsh-control-center/client.js` 提供给浏览器，注册侧边栏入口、
  控制中心整页、会话「规则」视图与输入框上的优化按钮。

## 配置位置

| 内容 | 路径 |
|---|---|
| 全局规则 | `~/.dsh/rules/<名称>.md` |
| 项目规则 | `<工作区>/.dsh/rules/<名称>.md` |
| 技能 | `~/.dsh/skills/<名称>/SKILL.md` 或 `~/.dsh/skills/<名称>.md` |
| 记忆 | `~/.dsh/memory/<名称>.md` |
| MCP 注册表 | `~/.dsh/mcp.json` |
| 本插件设置 | `~/.dsh/control-center/settings.json` |
| 备份产物 | `~/.dsh/control-center/backups/*.zip` |

规则文件的 frontmatter：

```markdown
---
name: 驾驭工程核心规则
description: 总则：上下文治理、验证闭环、技术债清理
mode: always          # always = 强加载；ondemand = 普通模式（只给名称/描述/路径）
---

正文…
```

记忆文件的 frontmatter：

```markdown
---
name: 本机 Python 用 uv
description: 用户机器上用 uv 管依赖，不要用 pip 直接装
scope: global         # global = 每个会话；workspace = 仅指定项目目录
tags: 项目, 工具链
pinned: false
enabled: true
---

正文…
```

## 界面通信（host ↔ client）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/state?workspace=\|session=` | 一次性返回各分区的数据形状（唯一数据源）；带 `workspace`/`session` 时附带该工作区的项目规则 |
| GET | `/body?section=rule\|skill\|memory&id=&workspace=` | 读取单条正文（规则要带 `workspace` 才是项目规则） |
| GET | `/flags` | 只有输入框按钮需要的开关（极轻量） |
| GET | `/routes` | 可选模型路由列表 + DSH 默认模型 |
| GET | `/scan` | 扫描本机其他客户端（只读） |
| POST | `/upload` | 上传备份包做分析（原始字节，不走 base64） |
| POST | `/optimize` | 优化一段草稿 |
| POST | `/action` | `{ section, op, ... }` 统一写入口；返回最新 `state` |

`section` ∈ `rule | skill | memory | mcp | settings | backup | scan | reveal`。
`reveal` 给 `path`（打开目录）或 `file`（在文件管理器里定位到它），失败会返回 400 与原因。
字段名就是这两个（`path` 优先；旧客户端 bundle 发的 `dir` 仍被接受）；`file` 还不存在时退回打开父目录。
技能分区的 `op` 有 `save | delete | toggle`（`toggle` 改的就是「对 Agent 启用/禁用」）。
备份分区的 `op` 有 `create | delete | inspect | restore`，其中 `inspect` 是**只读**的：
它读备份目录里的一个产物、算出还原计划并返回覆盖/新建清单，界面的「还原」先用它把话说清楚，
用户确认后才发 `restore`（可以只给 `token`（上传的包）或只给 `file`（目录里的产物），
两者都给时以 `file` 为准；`restore` 不传 `sections` 时自动快照按包内全部分区来做）。
**备份产物没有下载端点**——文件就在备份目录里，界面给的是「打开备份目录」。
**所有写操作返回变更后的完整 state**，客户端不做乐观更新。

## 备份与导入

| 分区 | 内容 | 备注 |
|---|---|---|
| 全局规则 / 技能 / 记忆 | `~/.dsh` 下对应目录 | 一条一个文件 |
| 项目规则 | 各工作区的 `<工作区>/.dsh/rules` | 随「规则」分区一起打进包（按绝对路径还原） |
| MCP 服务器 | `~/.dsh/mcp.json` | 含环境变量与密钥，标「含密钥」 |
| 已安装插件清单 | profile 的 `package.json`、`cordis.patch.yml`、`cordis.yml`、`pnpm-lock.yaml` | **不含 `node_modules`**：插件本体可从 npm 重装，版本与依赖声明才是不可再生的 |
| 平台设置 | `$DSH_HOME/settings.yaml` | 默认模型、界面、权限预设 |
| 全局指令 | `$DSH_HOME/AGENTS.md` | |
| 插件数据目录 | `$DSH_HOME` 下各插件自建的目录 | 排除 `profiles` / `sessions` / `attachments` / `storages` / `rewind-snapshots` 等大件 |
| 凭据 | `$DSH_HOME/.credentials.yaml` | **默认不勾选**，含明文密钥 |

**导入备份 / 还原备份 = 替换**：先解析包、列出「每个分区有多少文件、会覆盖多少、会新建多少」，用户确认后才写入；
写入前自动把当前配置另存一份备份（可在设置里关掉）。历史产物有两个操作：**还原**（就地按该包内容覆盖，
走同一套「先看清单再确认」的流程）与**删除**。

「还原」只认备份目录里的普通 `.zip` 文件名：带路径（`..`、子目录、绝对路径）一律 400 拒收，
不靠 `basename` 静默改写成一个别的文件。

打包上限：单文件 32 MiB、单次总量 64 MiB（零依赖的 zip 写入在内存里完成，必须有硬线）；
被跳过的文件会写进 manifest 并在界面提示。

## 扫描的客户端

Codex CLI、Claude Code、CC Switch、Hermes、OpenCode、Gemini CLI、Grok CLI、Kimi CLI、
CodeBuddy、Trae、OpenClaw/Clawdbot、Qoder、WorkBuddy、ZCode、通义灵码、CodeMoss、
GitHub Copilot、Cursor、Windsurf、Cline、Roo Code、Qwen Code，外加**自定义源**
（任意 JSON / TOML 配置文件或技能目录）。扫描全程只读；SSE 传输与非法技能名会被标出并拒绝导入，
而不是写进去让平台静默忽略。

## 与 TRAE 的能力对照

| TRAE 内置能力 | 本项目 | 说明 |
|---|---|---|
| 项目规则 / 用户规则 | ✅ 规则页 + 会话「规则」视图 | 全局规则在控制中心管，项目规则在会话里管；多一个「普通模式」加载方式与预算降级保证 |
| MCP 市场与管理 | ✅ MCP 页 | 含运行时挂载状态与失败原因、对 Agent 启用/禁用；不代装服务器本体 |
| 技能（Skills） | ✅ 技能页 | 目录 bundle 与平铺两种形态，可对 Agent 启用/禁用 |
| 记忆（Memory） | ✅ 记忆页 | 全局 / 项目作用域 + 注入 |
| 配置备份 / 恢复 | ✅ 备份页 | 分区可选、普通 zip、导入与就地还原都是「先列替换清单再动手」（含自动快照） |
| 从其他客户端导入 | ✅ 导入页 | 一次导入，只读扫描 |
| 提示词优化 | ✅ 输入框按钮 | 直接替换 + 撤销 + 只盖文字区的生成动画 |
| Agent 自主配置 | ✅ `control_center_*` 工具 | 配置类免审批；只有改规则需要用户在对话里点头 |
| 终端 / 文件读写 / 检索 | ⛔ 不实现 | DSH 已内置（非插件） |
| 子代理 / 任务清单 / 目标管理 | ⛔ 不实现 | DSH 已内置 |
| 浏览器自动化 / 电脑控制 | ⛔ 不实现 | 已由独立插件提供（`dsh-builtin-browser` 等） |
| IDE 诊断 / 打开文件上下文 | ⛔ 不实现 | 属于 IDE 侧能力，DSH Web 客户端没有对应席位 |

## 开源引用

- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) —— 宿主平台与插件协议
- [dsh-baize-rules](https://github.com/bvcvb/dsh-baize-rules) —— 客户端插件手写 bundle 的写法参考
- [dsh-config-manager](https://www.npmjs.com/package/dsh-config-manager) —— `settings.section` 注册与 host API 的接线参考
- [dsh-agent-sync](https://github.com/kuaiyukuaikuai/dsh-agent-sync) —— 跨客户端扫描的客户端目录约定参考

## 许可证

MIT
