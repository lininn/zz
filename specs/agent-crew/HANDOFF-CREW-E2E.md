# 任务：crew 派工经中转链路的端到端集成测试与修复

用户经手机 → pc.d-1.top（zcode-relay 中转）→ PC 的 ZCode server 派工时，「指派项目经理干活」不生效。线上日志显示：手机 WS 通道正常、Mac connector 已绑定在线（多设备新代码已部署到 relay 与本机 connector）、但 **PC 的 ZCode server 没有收到 crew.send RPC**。需要端到端集成测试把断点测出来并修复。

## 链路拓扑（已核实）

```
手机浏览器 ──HTTPS/WSS──> pc.d-1.top (openresty, kd1 服务器)
  ──> zcode-relay server (:8787, 登录 gate + 设备选择 + web-dist 静态)
  ──按 relay_device cookie 选设备──> connector 数据隧道（Mac, /connector + /ws）
  ──> Mac 本机 http://127.0.0.1:3030（ZCode server，crew RPC 所在）
```

- relay 仓库：`/Users/lininn/test/zcode-relay`（server 监听 8787；多设备注册表刚上线；`LOCAL_TARGET` 默认 `http://127.0.0.1:3030`）
- 本 PC connector 已用多设备代码运行（deviceId 已上报，管理端口 3789）
- ZCode server：`packages/server`（crew.* RPC；crew 派工创建 `agent_crew_<executionId>` sessionId 的会话——bootstrap 端 `session/create` 已放行该前缀）
- 手机登录：blog 账号（server/auth.js blogAuth/blogVerify）

## 要做的事

1. **端到端集成测试**（放 `packages/services/test/` 或新建 `packages/server/test/`，以仓库现有测试设施为准）：
   - 真实起 zcode-relay server（子进程，随机端口，`node /Users/lininn/test/zcode-relay/src/server/index.js` + 环境变量指向临时 data 目录与测试端口）
   - 真实起一个 connector 子进程连上它（`LOCAL_TARGET` 指向测试用的 ZCode server 端口）
   - 测试客户端模拟手机：blog 登录（mock blog API——`server/auth.js` 的 blogAuth/blogVerify 走 `BLOG_API_BASE` 之类环境变量的话用测试 HTTP stub；若无注入点则加一个）→ 拿 session cookie → 选择设备（若有多设备选择页流程）→ 发起 crew.create/send RPC（经 relay 转发到 PC server）
   - 断言：crew RPC 穿透 relay 到达 ZCode server 并返回；消息/执行落库；WS 通道（/ws 数据面）同样穿透
2. **发现的问题就修**（重点怀疑面）：
   - relay 转发对 **长连接/大 payload/RPC 超时**的处理（crew.get 首次 3s+；执行轮询长连接）
   - 设备选择页/cookie 流程对新老 session 的兼容（旧 session 无 deviceId cookie 时的默认路由）
   - ZCode server 在经转发时的 Host/Origin/CORS 校验、secure cookie（经 https 中转访问但 PC 端是 http——cookie 的 Secure/SameSite 是否导致手机登录态丢失或 crew 请求 401）
   - crew 派工的 `session/create` 在 agent 端放行后，PC server → agent 进程链路（zcode.cjs 已重建）是否真正走通——必要时补一条 server→agent 的直接测试
3. 修复后重跑全部新增/既有测试。

## 硬约束

- 测试里起子进程用随机端口与临时目录；测试结束清理子进程与临时文件。
- 不改 relay/ZCode 的线上部署（本机开发环境可自由起进程）；不动 `apps/zcode-cli` 既有未提交文件。
- 架构策略、i18n、不 commit 等约束同前。

## 完成标准

- 新增端到端测试通过且稳定（连续跑 3 次无 flake）。
- 既有测试不回退（服务端 crew 186 / UI crew 143 / relay 30）。
- `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 通过。
- 报告（`specs/agent-crew/CODEX-REPORT-CREW-E2E.md`）：测出的断点根因、修复内容、以及若仍需线上验证的步骤清单。
