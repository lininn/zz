# 设计：发布 npm（zz）+ zz --web + kd1 多版本共存

## 1. 目标架构

```
用户机器 (npm install -g zz)
  zz --web
    ├─ 内嵌 Hono HTTP server（默认 :3030，--port 覆盖，占用自动回退）
    │    ├─ staticRoot → 内嵌 web-dist（聊天页面）
    │    └─ /ws → RPC WebSocket（连接本地 ZCode agent）
    └─ 自动打开浏览器 http://127.0.0.1:<port>

kd1 (relay 单版本部署)
  web-dist/
    ├─ v3.14.3/   ← 从 ZCode packages/web/dist 构建
    ├─ v3.15.0/
    └─ ...
  relay 手机入口 → 按设备绑定版本 serve web-dist/<version>/
```

## 2. 关键决策

### 2.1 npm 单体包（bin: zz）
- `apps/zcode-cli/packages/cli/package.json`：`"bin": {"zz": "./dist/zcode.cjs"}`，去 `private`，补 npm 元数据
- `CLI_COMMAND_NAME = "zz"`（`process-name.ts`）
- web-dist 通过 `build-zcode.mjs` 内嵌进包（复用现有 `cp(webDist, packageRoot/web)` 逻辑）
- 包名待定（`zz` 可能被占用，用 `@zcode/zz` 或 `zcode-app`），**包名 ≠ bin 名**

### 2.2 zz --web 命令
- `arguments.ts` 注册 `--web`（boolean）+ `--web-port`（string）
- `run.ts` 新增分支：`--web` → 启动内嵌 server + 托管 web-dist + 打开浏览器
- 复用 `webConfigCommand.ts` 的端口探测 + 打开浏览器逻辑

### 2.3 端口策略
- 默认 3030（与 server 端口一致）
- `--web-port` 覆盖
- 端口被占 → 自动向后探测可用端口（上限 10 次）
- 5173 是**开发模式** Vite 端口，生产不走 Vite，无影响

### 2.4 kd1 多版本 web-dist 路由（relay 单版本）
- web-dist 按版本分目录：`web-dist/<version>/`
- connector 启动时 GET `http://127.0.0.1:3030/api/server-info` 读 `version`，上报 relay
- 失败标记 `unknown`，每 60s 轮询重试
- relay 手机入口按绑定版本 serve 对应目录
- 版本目录缺失 → 版本不匹配提示页（复用 `sendDeviceError`，readdir 列可用版本 + 最新版本兜底）
- 旧版本不自动清理，`rsync --delete` 只作用于目标版本子目录

### 2.5 登录页信息泄露修复（安全）
- `public/login.html`：删除状态展示区 + `fetch('/status')`，只留纯登录表单
- `/status` 接口：无 session 时返回 `{online: false, user: null}`，不再调 `connectorOnline()`

## 3. 端口清单

| 端口 | 用途 | 生产 | 可配置 |
|------|------|------|--------|
| 3030 | ZCode server / zz --web | ✅ | `--web-port` / `PORT` |
| 3210 | --web-config 配置页 | ✅ | `--web-port`（web-config 专用） |
| 5173 | Vite dev（开发） | ❌ | vite.config.ts |
| 8787 | relay-server | ✅ | relay config |
| 3789 | connector admin | ✅ | - |

## 4. 版本一致性链路

```
PC 运行 zz v3.14.3
  → connector 上报 version=v3.14.3 给 relay
  → 手机访问 relay → 按绑定版本 serve web-dist/v3.14.3/
  → web-dist/v3.14.3 的 bootstrapWebApp 连 ws://host/ws
  → connector 隧道 → 127.0.0.1:3030（同版本 server）
```

版本不匹配（web-dist 缺失）→ 提示页 + 最新版本兜底，不静默 404。
