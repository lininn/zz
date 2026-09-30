# 实现计划：add-npm-publish-web-launch

## 来源
- 项目配置：openspec/config.yaml
- 当前规格：openspec/specs/（无既有归档规格，本变更为全新能力）
- 提案：openspec/changes/add-npm-publish-web-launch/proposal.md
- 设计：openspec/changes/add-npm-publish-web-launch/design.md
- 规格：openspec/changes/add-npm-publish-web-launch/specs/
- 任务：openspec/changes/add-npm-publish-web-launch/tasks.md

## Project Context

ZCode 是一个 AI 编码助手 CLI 工具，提供终端 TUI、Web 控制台、桌面应用三种交互界面，支持自定义模型 Provider（`--web-config`），以及手机远程控制 PC（通过 kd1 公网中转 relay）。当前版本 v3.14.3，尚未发布到 npm（`npm.publish: false`）。

技术栈：Node.js >= 24，pnpm 10.33.2 workspace monorepo；TypeScript 6.x ESM；CLI 用 esbuild → CJS bundle（`dist/zcode.cjs` + shebang）；server 用 tsup（Hono HTTP/WS）；web 用 Vite（React SPA）；RPC 用自研二进制协议 `@zcode/rpc`。

关键架构：
- `apps/zcode-cli/packages/cli/`：CLI 入口（bin `zcode`），`arguments.ts` 用 Node 内置 `parseArgs` 解析，`run.ts` 路由到 tui/prompt/web-config 等命令
- `packages/server/`：Hono HTTP/WS 服务器（默认 :3030，`PORT` env 可覆盖），`staticRoot` 选项托管 web 静态文件，`/ws` 提供 RPC WebSocket
- `packages/web/`：React SPA，`bootstrapWebApp()` 同源连 `/ws`；Vite dev :5173（仅开发），生产构建输出 `packages/web/dist/`
- `packages/zcode-server-cli/`：常驻守护进程，bin 名 `zcode`（与 CLI 同名，当前都 private 无冲突）
- `packages/shared/src/version.ts`：`__ZCODE_VERSION__` 构建时注入，运行时读 `ZCODE_VERSION`
- `zcode-relay/`：独立仓库（v0.1.0），Docker 部署在 kd1；relay-server（:8787）Express + WS；connector 是 PC 端出站 WS 隧道 → `127.0.0.1:3030`；`web-dist/` 从 `packages/web/dist` rsync 而来，只读挂载

版本一致性链路：`PC 运行 zz vX → connector 上报 version=vX → 手机访问 relay → serve web-dist/vX/ → 页面连 ws://host/ws → 隧道回 PC 127.0.0.1:3030（同版本 server）`。

## Applicable OpenSpec Rules

- 所有新增 CLI 参数必须在 `arguments.ts` 中注册
- CLI bin 名变更需同步更新 `process-name.ts`、`package.json` bin、帮助文档
- 端口配置必须支持环境变量覆盖和自动回退，不硬编码
- web-dist 构建产物路径必须可配置，支持内嵌 npm 包和独立部署两种模式
- 生产模式不用 Vite dev server；web 页面由 server 内嵌 HTTP + staticRoot 托管
- CLI 与 server-cli 的 bin 名不得冲突；npm 发布时只发一个主命令
- kd1 relay 多版本共存方案：web-dist 按版本分目录，relay 根据客户端版本动态路由
- 不新增不必要依赖；CLI 参数解析用 Node 内置 `parseArgs`
- 发布前必须通过 typecheck + lint + 相关 E2E
- 密钥/凭证不硬编码（relay 的 PAIR_TOKEN 等继续走 env）

## Goal

把 ZCode 发布为 npm 包（bin `zz`），新增 `zz --web` 一键启动 Web 聊天页面（生产模式用内嵌 Hono server + staticRoot 托管 web-dist，端口默认 3030 可覆盖且占用自动回退）；kd1 relay 支持多版本 web-dist 共存，根据客户端版本动态路由，实现「本项目运行哪个版本，kd1 远控就哪个版本」；并修复登录页信息泄露问题。

## Non-Goals

- 不改动 RPC 协议本身（`packages/rpc` 不引入协议版本号协商，仅做 web-dist 版本路由）
- 不改动 `--web-config`（模型配置页）现有行为，仅新增并列的 `--web`
- 不重做 relay 的登录/隧道协议（v1 协议保持不变），只在其上层加「多版本 web-dist 路由」
- 不改动 desktop（Electron）与 SEA 打包的既有发布路径
- 不自动清理 kd1 旧版本 web-dist（保留，手动清理）

## Source Coverage

| OpenSpec 来源 | 验收点 | 对应 implementation slice |
|---------------|--------|---------------------------|
| `specs/npm-publish` REQ-NPM-001 | bin 名 `zz`，`zz --version` 可用 | Slice 1 |
| `specs/npm-publish` REQ-NPM-002 | npm 包元数据完整、非 private | Slice 1 |
| `specs/npm-publish` REQ-NPM-003 | web-dist 内嵌，开箱即用 | Slice 1 |
| `specs/npm-publish` REQ-NPM-004 | 与 server-cli bin 不冲突 | Slice 1 |
| `specs/zz-web` REQ-WEB-001 | `--web` / `--web-port` 参数注册 | Slice 2 |
| `specs/zz-web` REQ-WEB-002 | 内嵌 server 托管 web-dist + `/ws` RPC | Slice 2 |
| `specs/zz-web` REQ-WEB-003 | 端口默认 3030 + 自动回退 | Slice 2 |
| `specs/zz-web` REQ-WEB-004 | 自动打开浏览器 | Slice 2 |
| `specs/zz-web` REQ-WEB-005 | 与 `--web-config` 不冲突 | Slice 2 |
| `specs/login-security` REQ-LOGIN-001 | 登录页不显示连接信息/用户名 | Slice 3 |
| `specs/login-security` REQ-LOGIN-002 | `/status` 无 session 不泄露 | Slice 3 |
| `specs/login-security` REQ-LOGIN-003 | 登录后设备状态保留 | Slice 3 |
| `specs/kd1-multiversion` REQ-KD1-001 | connector 上报版本 + unknown 兜底 | Slice 4 |
| `specs/kd1-multiversion` REQ-KD1-002 | relay 按版本路由 web-dist | Slice 5 |
| `specs/kd1-multiversion` REQ-KD1-003 | 版本不匹配提示页 | Slice 5 |
| `specs/kd1-multiversion` REQ-KD1-004 | 多版本共存、rsync 只作用目标版本 | Slice 6 |
| `specs/kd1-multiversion` REQ-KD1-005 | 部署脚本按版本分目录 | Slice 6 |
| `specs/cicd` REQ-CI-001 | tag 触发构建 | Slice 7 |
| `specs/cicd` REQ-CI-002 | 自动发布 npm | Slice 7 |
| `specs/cicd` REQ-CI-003 | 自动部署 web-dist 到 kd1 | Slice 7 |
| `tasks.md` T1-T9 | 全部任务 | Slice 1-7 |

## File Responsibility Map

| 文件 | 操作 | 责任 | 相关 slice |
|------|------|------|------------|
| `apps/zcode-cli/packages/cli/package.json` | modify | bin `zz`、去 private、补 npm 元数据 | Slice 1 |
| `apps/zcode-cli/packages/cli/src/process-name.ts` | modify | `CLI_COMMAND_NAME = "zz"` | Slice 1 |
| `scripts/build-zcode.mjs` | modify | web-dist 内嵌进包 | Slice 1 |
| `packages/zcode-server-cli/package.json` | modify | bin 不与 CLI 冲突（改名或只发 CLI 主命令） | Slice 1 |
| `apps/zcode-cli/packages/cli/src/arguments.ts` | modify | 注册 `--web` / `--web-port` | Slice 2 |
| `apps/zcode-cli/packages/cli/src/run.ts` | modify | `--web` 分支路由 | Slice 2 |
| `apps/zcode-cli/packages/cli/src/web-command.ts` | create | 启动内嵌 server + 托管 web-dist + 打开浏览器 | Slice 2 |
| `apps/zcode-cli/packages/cli/src/web-config/webConfigCommand.ts` | modify | 复用端口探测/打开浏览器逻辑（提取公共函数） | Slice 2 |
| `zcode-relay/public/login.html` | modify | 删除状态展示区 + `fetch('/status')` | Slice 3 |
| `zcode-relay/src/server/index.js` | modify | `/status` 无 session 返回 `{online:false,user:null}` | Slice 3 |
| `zcode-relay/src/connector/index.js` | modify | 上报 `zcodeVersion`，60s 轮询 | Slice 4 |
| `zcode-relay/src/connector/forwarder.js` | modify | bind 帧附加版本 / update-version 帧 | Slice 4 |
| `zcode-relay/src/server/proxy.js` | modify | 按版本 serve web-dist | Slice 5 |
| `zcode-relay/src/server/index.js` | modify | 手机入口按绑定版本路由 | Slice 5 |
| `zcode-relay/src/server/pages.js` | modify | 版本不匹配提示页模板 | Slice 5 |
| `scripts/deploy-web-kd1.sh` | modify | 按版本分目录部署 | Slice 6 |
| `.github/workflows/release.yml` | create | tag 触发构建 + npm publish + kd1 部署 | Slice 7 |

## Implementation Slices

### Slice 1: npm 单体包改造（bin: zz）
- 来源：`tasks.md` T1；`specs/npm-publish` REQ-NPM-001/002/003/004
- 目标：CLI 可发布为 npm 包，用户 `npm install -g <包名>` 后用 `zz` 命令启动，web-dist 内嵌开箱即用
- 依赖：无
- 改动文件：
  - Modify: `apps/zcode-cli/packages/cli/package.json`
  - Modify: `apps/zcode-cli/packages/cli/src/process-name.ts`
  - Modify: `scripts/build-zcode.mjs`
  - Modify: `packages/zcode-server-cli/package.json`
- TDD 计划：
  1. 先写/更新 CLI 的 E2E 测试，断言 `zz --version` 输出、`zz doctor` 的 cli.name 为 `zz`
  2. 改 `package.json` bin 为 `zz`、去 private、补元数据；改 `process-name.ts` 的 `CLI_COMMAND_NAME`
  3. 改 `build-zcode.mjs` 确保 web-dist 复制进包；改 server-cli bin 避免冲突
  4. 运行 `pnpm --filter @zcode/cli build` 验证 bundle 生成，`npm pack` 验证包结构
- 验证命令：
  - `pnpm --filter @zcode/cli build` — bundle 生成成功
  - `npm pack --dry-run` — 包含 `dist/zcode.cjs` + `web/` + bin
  - `pnpm --filter @zcode/cli typecheck` — 类型通过
- 完成标准：
  - `npm pack` 产物包含 `dist/zcode.cjs`、`web/` 目录、`package.json` 的 bin 为 `zz`
  - `zz --version` 输出版本号
- 风险/回滚：
  - 包名 `zz` 可能被 npm 占用 → 改用 `@zcode/zz` 或 `zcode-app`（包名 ≠ bin 名，bin 始终 `zz`）；回滚：git revert 该 slice

### Slice 2: zz --web 命令 + 端口自动回退
- 来源：`tasks.md` T2、T3；`specs/zz-web` REQ-WEB-001/002/003/004/005
- 目标：`zz --web` 一键启动 Web 聊天页面，生产模式用内嵌 Hono server + staticRoot 托管 web-dist，端口默认 3030 可覆盖且占用自动回退
- 依赖：Slice 1
- 改动文件：
  - Modify: `apps/zcode-cli/packages/cli/src/arguments.ts`
  - Modify: `apps/zcode-cli/packages/cli/src/run.ts`
  - Create: `apps/zcode-cli/packages/cli/src/web-command.ts`
  - Modify: `apps/zcode-cli/packages/cli/src/web-config/webConfigCommand.ts`
- TDD 计划：
  1. 先写 E2E 测试：`zz --web` 启动后端口可访问、`--web-port 8080` 生效、端口被占自动回退
  2. 在 `arguments.ts` 注册 `--web` / `--web-port`
  3. 从 `webConfigCommand.ts` 提取端口探测 + 打开浏览器为公共函数，新建 `web-command.ts`：解析 web-dist 路径（`path.join(__dirname, "web")`）、启动内嵌 server + staticRoot、打开浏览器
  4. 在 `run.ts` 加 `--web` 分支，与 `--web-config` 并列
- 验证命令：
  - `pnpm --filter @zcode/cli build` — 编译通过
  - `node dist/zcode.cjs --web` — 启动并打开浏览器，访问 `http://127.0.0.1:3030` 看到聊天页
  - `node dist/zcode.cjs --web --web-port 8080` — 端口生效
  - 手动占用 3030 后运行 — 自动回退到 3031 并提示
- 完成标准：
  - `zz --web` 自动打开浏览器，页面能通过 `/ws` RPC 连通本地 ZCode agent
  - 端口被占时自动回退到下一个可用端口（上限 10 次），终端/页面给出提示
  - `zz --web-config` 行为不变
- 风险/回滚：
  - web-dist 路径解析错误 → 用 `import.meta.url` 定位包内 `web/`；回滚：git revert

### Slice 3: 登录页信息泄露修复（安全）
- 来源：`tasks.md` T9；`specs/login-security` REQ-LOGIN-001/002/003
- 目标：登录页不显示连接信息，防止黑客探测用户名或「relay 背后有 PC 在线」
- 依赖：无（zcode-relay 独立仓库，可与 Slice 1/2 并行）
- 改动文件：
  - Modify: `zcode-relay/public/login.html`
  - Modify: `zcode-relay/src/server/index.js`
- TDD 计划：
  1. 先写 relay 测试：`/status` 无 session 返回 `{online:false,user:null}`，不调 `connectorOnline()`
  2. 改 `login.html` 删除 `.sub` 状态展示区 + `fetch('/status')` JS 块
  3. 改 `/status` 无 session 时返回 `{online:false,user:null}`
  4. 验证登录后 `/relay/devices` 设备状态不受影响
- 验证命令：
  - `cd zcode-relay && npm test` — 相关测试通过
  - 手动：未登录访问 `login.html` 无连接信息；有 session 不显示用户名
- 完成标准：
  - 登录页只显示登录表单，无任何连接信息
  - `/status` 无 session 返回 `{online:false,user:null}`
  - 登录后设备状态正常
- 风险/回滚：
  - 改动小、独立；回滚：git revert

### Slice 4: connector 上报 PC 端 ZCode 版本
- 来源：`tasks.md` T4；`specs/kd1-multiversion` REQ-KD1-001
- 目标：connector 启动时上报 PC 端 ZCode 版本给 relay，失败标记 `unknown` 并 60s 轮询重试
- 依赖：Slice 3（同仓库，先做登录修复避免冲突）；无跨仓库依赖
- 改动文件：
  - Modify: `zcode-relay/src/connector/index.js`
  - Modify: `zcode-relay/src/connector/forwarder.js`
- TDD 计划：
  1. 先写测试：connector 启动 GET `http://127.0.0.1:3030/api/server-info` 读 `version`；失败标记 `unknown`；60s 轮询后发 `update-version`
  2. 实现版本读取 + bind 帧附加 `zcodeVersion`
  3. 实现 60s 轮询 + `update-version` 帧
- 验证命令：
  - `cd zcode-relay && npm test` — connector 版本上报测试通过
  - 手动：启动 connector（server 在线）→ relay 收到版本；server 离线 → 标记 unknown
- 完成标准：
  - connector 启动上报版本，server 未就绪时标记 `unknown` 并 60s 重试
  - 获取版本后发 `update-version` 帧
- 风险/回滚：
  - 轮询间隔可调；回滚：git revert

### Slice 5: relay web-dist 多版本目录 + 路由 + 不匹配提示页
- 来源：`tasks.md` T5、T6；`specs/kd1-multiversion` REQ-KD1-002/003
- 目标：relay 手机入口按绑定版本 serve `web-dist/<version>/`，版本缺失返回不匹配提示页
- 依赖：Slice 4（需要版本上报）
- 改动文件：
  - Modify: `zcode-relay/src/server/proxy.js`
  - Modify: `zcode-relay/src/server/index.js`
  - Modify: `zcode-relay/src/server/pages.js`
- TDD 计划：
  1. 先写测试：手机访问按绑定版本 serve 对应目录；unknown 用最新版本兜底；版本缺失返回提示页
  2. 改 proxy 按版本解析 web-dist 路径
  3. 改 index 手机入口按绑定版本路由
  4. 改 pages.js 增加版本不匹配提示页（readdir 列可用版本 + 最新版本兜底按钮）
- 验证命令：
  - `cd zcode-relay && npm test` — 路由测试通过
  - 手动：手机访问匹配版本正常；缺失版本显示提示页
- 完成标准：
  - relay 按版本 serve web-dist，unknown 用最新版本兜底
  - 版本缺失返回友好提示页，不静默 404
- 风险/回滚：
  - web-dist 目录结构变更影响现有部署 → 先兼容旧单版本目录；回滚：git revert

### Slice 6: deploy-web-kd1.sh 改造（版本分目录部署）
- 来源：`tasks.md` T7；`specs/kd1-multiversion` REQ-KD1-004/005
- 目标：部署脚本按版本分目录同步 web-dist 到 kd1，`rsync --delete` 只作用于目标版本子目录，不误删兄弟版本
- 依赖：Slice 1（web-dist 构建）、Slice 5（目录结构约定）
- 改动文件：
  - Modify: `scripts/deploy-web-kd1.sh`
- TDD 计划：
  1. 先写脚本测试（或 dry-run 验证）：`rsync --delete` 只作用于 `web-dist/<version>/`，不删除兄弟版本
  2. 改脚本：构建 web-dist → rsync 到 `web-dist/<version>/`
  3. 验证旧版本目录保留
- 验证命令：
  - `bash scripts/deploy-web-kd1.sh --dry-run` — 目标路径正确
  - 手动：部署后 kd1 web-dist 出现多版本目录，互不覆盖
- 完成标准：
  - 部署后 kd1 web-dist 出现新版本目录，旧版本保留
  - `rsync --delete` 不误删兄弟版本目录
- 风险/回滚：
  - rsync 目标路径写错会误删 → 先 dry-run 验证；回滚：git revert

### Slice 7: CI/CD 流水线
- 来源：`tasks.md` T8；`specs/cicd` REQ-CI-001/002/003
- 目标：push tag（`v*`）自动构建、发布 npm、同步 web-dist 到 kd1 多版本目录
- 依赖：Slice 1、Slice 6
- 改动文件：
  - Create: `.github/workflows/release.yml`
- TDD 计划：
  1. 先写 CI 配置骨架：`on: push tags: ['v*']`
  2. 步骤：`pnpm install` + `pnpm build:bootstrap` + `npm publish`（npm token 走 secrets）+ 构建 web-dist + rsync 到 kd1（ssh 凭证走 secrets）
  3. 验证 tag 触发全链路
- 验证命令：
  - 推送测试 tag 触发 CI，观察各步骤成功
  - 确认 npm 包发布、kd1 web-dist 出现新版本目录
- 完成标准：
  - push tag 后自动构建 + npm publish + kd1 web-dist 部署
  - 凭证不硬编码，走 CI secrets
- 风险/回滚：
  - CI 凭证缺失 → 需配置 secrets；回滚：删除 workflow 文件

## Verification Plan
- 单元/集成验证：
  - `pnpm --filter @zcode/cli typecheck` — CLI 类型通过
  - `cd zcode-relay && npm test` — relay 版本上报/路由/登录安全测试通过
- 类型/构建验证：
  - `pnpm --filter @zcode/cli build` — CLI bundle 生成
  - `pnpm build:bootstrap` — 全量构建（除 desktop）
  - `npm pack --dry-run` — 包结构正确
- 手动验证：
  - `zz --version` 输出版本号
  - `zz --web` 打开浏览器看到聊天页，RPC 连通
  - `zz --web --web-port 8080` 端口生效；占用 3030 后自动回退
  - 手机访问 relay 按版本 serve web-dist；版本缺失显示提示页
  - 未登录访问登录页无连接信息

## Blockers / Clarifications
- **npm 包名**：`zz` 在 npm 上极大概率已被占用，需确认实际包名（`@zcode/zz`、`zcode-app` 等）。**包名 ≠ bin 名**，bin 始终是 `zz`。此阻塞影响 Slice 1 的 `package.json` name 字段。
- **npm 发布权限**：需要 npm 账号 + token，确认用哪个 org/scope。影响 Slice 7。
- **kd1 部署权限**：rsync/ssh 到 kd1 的凭证需配置在 CI secrets。影响 Slice 7。
- **zcode-relay 仓库的 CI**：relay 是独立仓库，其 connector 改动（Slice 4）和路由改动（Slice 5）也需要 CI。是否本次一起做，或单独在 relay 仓库配置。

## Superpowers Handoff
- `writing-plans` 必须基于本文件生成 `docs/superpowers/plans/YYYY-MM-DD-add-npm-publish-web-launch.md`
- 详细实现计划必须把本文件的 `## Project Context` 与 `## Applicable OpenSpec Rules` 复制/压缩到 plan header 或专门的 Project Rules 章节，使后续 `executing-plans` 不需要重新读取 OpenSpec 也能遵守项目规范
- 详细实现计划必须遵循 `openspec/config.yaml` 的 `language.artifacts: zh-CN`：自然语言标题、段落、任务名和步骤说明使用中文；将 Superpowers 模板骨架中文化（`Goal`→`目标`、`Architecture`→`架构`、`Tech Stack`→`技术栈`、`File Structure`→`文件结构`、`Project Rules`→`项目规则`、`Task`→`任务`、`Step`→`步骤`、`Self-Review`→`自检`），但代码标识符、路径、命令、事件名、OpenSpec schema 标题和协议关键字保持原文
- 详细实现计划必须包含 Superpowers plan header 对应信息：目标、架构、技术栈，并包含文件结构、2-5 分钟 checkbox 步骤、RED-GREEN-REFACTOR 测试节奏、精确验证命令和自检
- 详细实现计划不得出现 TBD/TODO/"适当处理"/"类似上一步"等占位话术
- 详细实现计划必须使用 checkbox，并把每个 slice 展开为 2-5 分钟步骤
- 详细实现计划不得省略 Source Coverage 中的任何验收点
