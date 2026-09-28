# 任务：修复经中转访问时「建群目录为空」与「保存一直保存中」

用户症状（经 pc.d-1.top 中转访问 ZCode web 时）：新建群组 → 点「选择此目录」目录内容为空；填完表单保存后一直显示「保存中」不结束。

## 已核实的链路与环境（排查基线）

- 链路：手机/网页 → pc.d-1.top（openresty → zcode-relay server :8787，kd1 服务器）→ 按 relay_device cookie 选设备 → connector 隧道 → PC `http://127.0.0.1:3030`（ZCode server，crew RPC 与 fileService 所在）。
- relay 与 connector 的 **WS 握手 cookie 透传已修复并部署**（`specs/agent-crew/patches/relay-ws-application-cookie.patch` 已应用到 relay 仓库并部署 kd1；Mac connector 已重启）。但症状仍在——**说明还有别的断点**。
- kd1 上的 web-dist 是 **今早 09:12 的构建**（不含今天下午的前端修复）；PC 端 server 是最新代码。**存在前后端版本错配的可能**，需要评估哪些 RPC 在旧前端/新后端组合下会挂起。
- 本机 vite dev（5173）曾中断过一段时间，已恢复。
- DirectoryBrowser（`packages/ui/src/DirectoryBrowser.tsx`）依赖 `services.systemService.info()` 取 homedir 起始路径 + `services.fileService.readdir` 列目录；CrewGroupEditor 保存走 `crew.create` RPC。
- 怀疑面（按优先级）：
  1. **经中转时某些 RPC 挂起而非失败**：`/ws` 数据面（proxyPhoneWs）上的请求在 channel 断开/重建时是否永久 pending？前端 runCrewCommand 的 pending 是否依赖 RPC 返回才能复位？「保存中」= crew.create 的 Promise 未 resolve。
  2. **readdir/info 经中转失败被静默吞掉**：DirectoryBrowser 的 catch 只 setError，列表空但 UI 无错误提示——需要经中转时的真实错误。
  3. **新前端 ↔ 旧 server（kd1 web-dist 09:12）组合**的 schema 不匹配（relay settings 字段进 create 参数是后来加的——09:12 构建应已含；需确认）。
  4. DirectoryBrowser 在移动端/中转下 `systemService.info()` 失败后无重试与明确报错。

## 要做的事

1. **扩展端到端集成测试**（承接 `HANDOFF-CREW-E2E.md` 已建的 relay+connector+ZCode server 三件套测试）：
   - 覆盖 `fileService.readdir` 与 `crew.create` 经 relay 转发的真实调用（当前测试只覆盖 crew RPC？补 readdir/info）；
   - 模拟 channel 中途断开（connector 隧道断开）时，HTTP 面与 WS 面的挂起请求必须**快速失败**（有错误返回），不允许永久 pending；
   - 覆盖旧前端（09:12 构建产物语义）调新 server 的 create 参数兼容性（如发现不匹配，决定向前兼容 or 明确版本提示）。
2. **修复**：
   - 「保存中」永不结束：确保 WS/HTTP 转发断开时 crew.create 的 Promise 一定 settle（relay 侧 fast-fail 或前端超时 + 明确错误提示），并给出可重试交互；
   - 「目录为空」：readdir/info 经中转失败时 DirectoryBrowser 必须显示具体错误（区分服务不可达/未登录/权限），不允许无提示空列表；修复实际断点；
   - 前端超时兜底时长与 relay 转发的 fast-fail 时间要协调（避免relay已fail前端还在等）。
3. 移动端 UI 抽查：DirectoryBrowser 与保存按钮在窄屏（<1024px）可用。

## 硬约束

- 复用既有三件套测试设施与 crew 数据层；架构策略；i18n zh/en；不 commit；不动 `apps/zcode-cli`。
- relay 仓库（/Users/lininn/test/zcode-relay）如需改动，改动文件列表单独列出（我会负责部署 kd1 与重启 connector——你的沙箱写不了那个目录）。

## 完成标准

- 新增经中转的 readdir/crew.create 集成测试通过且连续 3 次无 flake；断链 fast-fail 测试通过。
- 既有测试不回退（服务端 crew 186 / UI crew 143 / relay 30）。
- `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 通过；relay 侧 `npm test` 通过。
- 报告（`specs/agent-crew/CODEX-REPORT-RELAY-UI.md`）：根因、修复、我需要执行的部署步骤清单（relay 仓库改动文件 + ZCode web 是否需要重建）。
