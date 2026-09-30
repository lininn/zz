# Proposal: 发布 npm（zz 命令）+ zz --web 启动 + kd1 多版本共存

## 需求概述

把 ZCode 发布为 npm 包，用户安装后用 `zz` 命令启动；新增 `zz --web` 一键启动 Web 聊天页面；kd1（relay 中转）支持多版本 web-dist 共存，根据客户端版本动态路由，解决「本项目运行哪个版本，kd1 远控就哪个版本」的版本一致性问题。

## 背景与调研结论

### 现状

1. **CLI bin 名是 `zcode`，不是 `zz`**：`apps/zcode-cli/packages/cli/package.json` 的 `"bin": { "zcode": "./dist/zcode.cjs" }`，`CLI_COMMAND_NAME = "zcode"`（`process-name.ts:1`）。`packages/zcode-server-cli/package.json` 的 bin 也注册了同名 `zcode`（当前都是 private，无实际冲突）。
2. **当前没有 `--web` 参数**：只有 `--web-config`（模型配置页，端口 3210，`webConfigCommand.ts`）。`http://127.0.0.1:5173` 只是**开发模式**的 Vite dev server，生产不可用。
3. **端口 5173 硬编码**：`packages/web/vite.config.ts:57` 的 `server.port: 5173`，无回退逻辑，仅开发用。
4. **生产模式已有正确路径**：`packages/server`（Hono）已支持 `staticRoot` 托管静态文件（`http.ts:449`），默认端口 3030（`entry-http.ts:19`，可用 `PORT` env 覆盖），web-dist 由 `packages/web` 构建输出到 `packages/web/dist/`。
5. **版本完全解耦**：ZCode 仓库 v3.14.3（git tag），zcode-relay 仓库 v0.1.0。relay 只做隧道透传，web-dist 用 `scripts/deploy-web-kd1.sh` rsync 手动同步到 kd1，无版本绑定、无协议版本协商、无多版本路由。
6. **版本注入**：`__ZCODE_VERSION__` / `__ZCODE_COMMIT__` / `__ZCODE_BUILD_TIME__` 由 esbuild/tsup 构建时 define 注入（`packages/shared/src/version.ts`），运行时读 `ZCODE_VERSION`。
7. **发布现状**：`.release-it.mjs` 和 `apps/zcode-cli/.release-it.json` 都是 `npm.publish: false`，只发 git tag 不发 npm。

### 关键架构链路（kd1 远程控制）

```
手机浏览器 → pc.d-1.top(openresty) → relay-server(kd1, :8787)
  → connector(家里PC) → 127.0.0.1:3030(ZCode server, Hono)
```

web 页面（`bootstrapWebApp`）无 OAuth gate，直接同源连 `ws(s)://host/ws`（`packages/web/src/main.tsx:355-364`），所以 relay 托管 web-dist + 隧道转发 `/ws` 即完整链路。

## 确认的决策

| 决策点 | 选择 |
|--------|------|
| 完成标准 | 完整生产体验（MVP + 端口冲突自动回退 + kd1 版本检测 + 不匹配提示升级 + 错误处理完善） |
| 端口策略 | 默认 3030 + 自动回退（端口被占自动向后找可用端口），支持 `--port` 覆盖 |
| kd1 多版本 | relay 单版本 + web-dist 多版本（web-dist 按版本分目录，relay 根据客户端版本动态路由） |
| npm 发布形式 | 单体包（`zz` 命令 + web-dist 内嵌），npm install 后开箱即用 |
| 变更范围 | 全链路含 CI/CD（代码 + npm 发布配置 + CI/CD 流水线 + kd1 部署脚本） |

## 成功标准（验收条件）

1. `npm install -g <包名>` 后，`zz --version` 能输出版本号。
2. `zz --web` 启动后自动打开浏览器，访问本机 web 聊天页面，能与 PC 本地 ZCode server 正常交互（RPC 连通）。
3. `zz --web` 默认端口 3030；端口被占用时自动回退到下一个可用端口，并在终端/页面给出明确端口提示。
4. kd1 relay 上同时部署多个版本的 web-dist（如 v3.14.3、v3.15.0），手机访问时 relay 能根据绑定的 PC 客户端版本路由到匹配的 web-dist 版本；版本不匹配时给出明确提示（升级/降级引导），不静默出错。
5. CI/CD：push tag 后自动构建、发布 npm、同步 web-dist 到 kd1 的多版本目录。

## 边界（不在范围内）

- 不改动 RPC 协议本身（`packages/rpc` 无版本协商机制，本次不引入协议版本号协商，仅做 web-dist 版本路由）。
- 不改动 `--web-config`（模型配置页）现有行为，仅新增并列的 `--web`。
- 不重做 relay 的登录/隧道协议（v1 协议保持不变），只在其上层加「多版本 web-dist 路由」。
- 不改动 desktop（Electron）与 SEA 打包的既有发布路径（可共存，不冲突）。

## 现有约束

- Node.js >= 24（根 `package.json` engines）。
- 不新增不必要依赖；CLI 参数解析用 Node 内置 `parseArgs`。
- 生产模式不用 Vite dev server；web 页面由 server 内嵌 HTTP + staticRoot 托管。
- CLI 与 server-cli 的 bin 名不得冲突；npm 发布时只发一个主命令 `zz`。
- 发布前必须通过 typecheck + lint + 相关 E2E。
- 密钥/凭证不硬编码（relay 的 PAIR_TOKEN 等继续走 env）。
- pnpm 全局版本锁定 7.4.0（用户记忆）。

## 待拆解的任务方向（供 spec 阶段细化）

1. **npm 单体包改造**：改 bin 名为 `zz`、去 private、补 npm 元数据、把 web-dist 内嵌进 CLI 包。
2. **zz --web 命令**：在 `arguments.ts` 注册 `--web` / `--web-port`，新增命令处理，启动 server + 托管 web-dist + 打开浏览器。
3. **端口自动回退**：默认 3030 + `--port` 覆盖 + 占用自动向后探测。
4. **kd1 多版本 web-dist 路由**：relay 侧按版本分目录托管 + 根据客户端版本路由 + 版本不匹配提示。
5. **CI/CD**：tag 触发构建、npm 发布、web-dist 多版本同步部署。

## grill-me 决策记录

### Q1: connector 上报 PC 端 ZCode 版本的时机与兜底策略

**问题**：connector 与 ZCode server 是独立进程，connector 可能比 server 先启动。此时 `/api/server-info` 不可用，relay 该用哪个版本的 web-dist？

**推荐**：connector 启动时立即 GET `http://127.0.0.1:3030/api/server-info` 读取 `version` 字段；成功则 bind 帧附加 `zcodeVersion` 上报 relay；失败则标记 `version: "unknown"`，此后每 60s 轮询重试。relay 遇到 `unknown` 时用最新可用版本 web-dist 兜底，并在页面顶部显示提示。connector 获取到版本后发 `update-version` 帧给 relay，relay 更新映射，手机刷新后自动切到正确版本。

**用户回答**：可以（同意推荐方案）。

**结论**：
- connector 启动时尝试读 `/api/server-info` → 失败标记 `unknown`
- relay 对 `unknown` 设备用最新 web-dist 兜底 + 页面提示
- connector 每 60s 轮询，获取版本后 update-version 帧同步 relay
- 已有手机 session 不断开，刷新后切到正确版本
- server 已暴露 `version: ZCODE_VERSION`（`http.ts:175`），无需改 server 代码

### Q2: 版本不匹配时的降级策略

**问题**：手机访问 relay 时，relay 查到 PC 版本（如 v3.15.0），但 kd1 上 `web-dist/v3.15.0/` 目录不存在（CI 部署滞后或用户跑 custom build `0.0.0-dev`），relay 应返回什么？

**推荐**：返回版本不匹配提示页（复用 `pages.js` 的 `sendDeviceError` 中文 HTML 模式），包含：PC 正在运行的版本号、kd1 上所有可用版本列表（从 `web-dist/` 子目录 readdir 扫描，可点选）、「使用最新版本」兜底按钮（标注"可能与本地版本存在差异"）、PC 升级/降级指引。不静默返回 404，不盲跳最新版本。

**用户回答**：可以（同意推荐方案）。

**结论**：
- relay 手机入口按绑定版本 serve `web-dist/<version>/`
- 版本目录缺失 → 返回版本不匹配提示页（复用 sendDeviceError 模板，readdir 列可用版本 + 最新版本兜底按钮）
- 不静默 404、不盲跳

### Q3: 旧版本 web-dist 的清理策略

**问题**：改多版本目录后，`web-dist/` 下会累积 `v3.14.3/`、`v3.15.0/`、`v3.16.0/`... 旧版本何时清理？

**推荐**：不自动清理。每个版本 web-dist 体积小（Vite 产物，通常 <5MB），磁盘无压力；保留旧版本保证旧客户端总能匹配。需要时手动 `ssh kd1 rm -rf web-dist/<old-version>/`。CI 部署脚本在版本子目录内执行 `rsync --delete`，不误删兄弟版本目录。

**用户回答**：可以（同意推荐方案）。

**结论**：
- web-dist 按版本分目录，旧版本不自动清理
- CI 部署用 `rsync --delete` 只作用于目标版本子目录内，不删除兄弟版本
- 手动清理通过 ssh 命令

### Q4: 登录页信息泄露（安全）

**问题**：用户指出登录页（`login.html`）显示了连接信息（PC 在线状态 + 已登录用户名），可能被黑客探测到用户名或「relay 背后有 PC 在线」。

**代码事实核查**：
- `login.html` 加载时 `fetch('/status')`，展示 PC 在线状态和「已登录：用户名」
- `/status` 接口（`src/server/index.js:21-29`）无 session 时返回 `online: connectorOnline()`（**全局**在线状态），有 session 时返回 `user: session.u`（用户名）
- 风险 1：未登录访问者能探测「relay 背后是否有 PC 在线」（侦察信息泄露）
- 风险 2：有 session cookie 时用户名直接显示在登录页

**用户回答**：登录页不能显示连接信息，否则被黑客知道用户名有危险。

**结论**：
- `public/login.html`：删除状态展示区（`.sub` 的 dot + pcState）和 `fetch('/status')` JS 块，登录页只留纯登录表单
- `src/server/index.js` 的 `/status`：无 session 时返回 `{ online: false, user: null }`（不再调 `connectorOnline()`），或删除该接口（当前仅 login.html 使用）
- 保留：登录后设备在线状态在 `/relay/devices`（auth gate 后）正常展示
