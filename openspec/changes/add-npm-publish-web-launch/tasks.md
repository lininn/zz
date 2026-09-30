# 任务清单：发布 npm（zz）+ zz --web + kd1 多版本共存

## T1: npm 单体包改造（bin: zz）
- **仓库**: ZCode
- **文件**: `apps/zcode-cli/packages/cli/package.json`, `process-name.ts`, `build-zcode.mjs`
- **内容**:
  - `"bin": {"zz": "./dist/zcode.cjs"}`
  - 去 `private: true`，补 name/description/repository/license
  - `CLI_COMMAND_NAME = "zz"`
  - web-dist 内嵌（复用 `cp(webDist, packageRoot/web)`）
  - server-cli bin 不冲突（改名或只发 CLI 主命令）
- **验收**: `npm pack` 结构正确，`zz --version` 可用

## T2: 新增 --web / --web-port 参数与命令处理
- **仓库**: ZCode
- **文件**: `arguments.ts`, `run.ts`, 新增 `web-command.ts`
- **内容**:
  - 注册 `--web`（boolean）+ `--web-port`（string）
  - `run.ts` 新增 `--web` 分支
  - 启动内嵌 server + 托管 web-dist + 打开浏览器
  - 复用 `webConfigCommand.ts` 的端口探测 + 打开浏览器逻辑
- **验收**: `zz --web` 启动并打开浏览器，页面 RPC 连通

## T3: 端口默认 3030 + 自动回退
- **仓库**: ZCode
- **文件**: 复用 `webConfigCommand.ts` 的 `tryListen` 模式
- **内容**:
  - 默认 3030，`--web-port` 覆盖
  - 端口被占自动向后探测（上限 10 次）
  - 终端/页面给出实际端口提示
- **验收**: 端口被占时自动回退并提示

## T4: connector 上报 PC 端 ZCode 版本
- **仓库**: zcode-relay
- **文件**: `connector/index.js`, `connector/forwarder.js`
- **内容**:
  - 启动时 GET `http://127.0.0.1:3030/api/server-info` 读 `version`
  - bind 帧附加 `zcodeVersion`
  - 失败标记 `unknown`，每 60s 轮询重试
  - 获取后发 `update-version` 帧
- **验收**: relay 能读到设备版本，unknown 时兜底

## T5: relay web-dist 多版本目录 + 路由
- **仓库**: zcode-relay
- **文件**: `server/proxy.js`, `server/index.js`
- **内容**:
  - web-dist 按版本分目录
  - 手机入口按绑定版本 serve 对应目录
  - unknown 用最新版本兜底
  - 版本缺失 → 版本不匹配提示页
- **验收**: relay 按版本路由，缺失时提示不静默 404

## T6: relay 版本不匹配提示页
- **仓库**: zcode-relay
- **文件**: 新增 `public/version-mismatch.html`（或复用 pages.js 模板）
- **内容**:
  - 显示 PC 运行版本 + 可用版本列表 + 最新版本兜底按钮 + 升级/降级指引
- **验收**: 版本缺失时返回友好提示页

## T7: deploy-web-kd1.sh 改造（版本分目录部署）
- **仓库**: ZCode
- **文件**: `scripts/deploy-web-kd1.sh`
- **内容**:
  - 构建 web-dist → rsync 到 `web-dist/<version>/`
  - `rsync --delete` 只作用于目标版本子目录
  - 旧版本不清理
- **验收**: 部署后 kd1 web-dist 出现多版本目录，互不覆盖

## T8: CI/CD 流水线
- **仓库**: ZCode
- **文件**: `.github/workflows/` 或 CI 配置
- **内容**:
  - push tag（`v*`）触发
  - `pnpm install` + `pnpm build:bootstrap`
  - `npm publish`
  - 构建 web-dist → rsync 到 kd1
- **验收**: tag 触发后全链路自动完成

## T9: 登录页信息泄露修复（安全）
- **仓库**: zcode-relay
- **文件**: `public/login.html`, `src/server/index.js`
- **内容**:
  - 删除登录页状态展示区 + `fetch('/status')`
  - `/status` 无 session 返回 `{online: false, user: null}`
- **验收**: 登录页不显示连接信息，/status 不泄露全局在线状态
