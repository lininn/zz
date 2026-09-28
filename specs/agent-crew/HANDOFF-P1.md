# 任务：实现 Agent 群组功能 P1 —— 外部 Runtime 接入群组

延续你刚完成的 P0（Agent Crew 垂直切片，已在工作区，未 commit）。本次做 P1。先读以下材料再动手：

1. `AGENTS.md` — 仓库工程规范。
2. `specs/agent-crew/design.html` — 完整设计（重点第 3、6、7 节）。
3. `specs/agent-crew/IMPLEMENTATION.md` + `packages/services/src/crew/` + `packages/services/test/crew*.test.ts` — 你自己 P0 的实现，P1 必须沿用其接口形状与命名。
4. `apps/zcode-cli/packages/contracts/src/interfaces/external-runtime.port.ts` + `apps/zcode-cli/packages/adapters/src/exec/external-runtime/`（claude-adapter/claude-events/preflight/process-host）+ `apps/zcode-cli/packages/bootstrap/src/app/external-runtime.ts` — 既有外部 runtime 体系。

## 本期范围（只做 P1，见设计文档第 7 节）

1. **Claude CLI 接入群组执行路径**：crew 成员绑定 `claude` runtime 时，经既有 `ExternalRuntimeDispatchService` / facade 派发，而不是 ZCode 自身执行。多轮对话用既有 `resumeNativeSessionId` 续跑语义（该接口目前只有 probe/start/interrupt/cancel，不要虚构流式 sendMessage）。
2. **新增 Codex CLI adapter 与 OpenCode CLI adapter**：仿照 `ClaudeCliAdapter` / `claude-events.ts` 模式实现——
   - capability probe（binary 存在、版本、认证）；
   - 事件归一化到 `ExternalRuntimeEventEnvelope`（未知 vendor 事件映射为 warning，不崩）；
   - interrupt/cancel；结构化最终输出；
   - 各自 CLI 的非交互 JSON 事件流以 `--help` 实测为准，探测结果写进实现报告；不确定的能力按不可用处理。
3. **runtime binding 在 crew 中生效**：成员执行时按其绑定走对应 adapter；preflight 不通过的绑定 → 成员/群内显示明确「不可用」状态与原因，**禁止静默降级到 ZCode**。
4. **权限请求**：外部 runtime 的 `permission.requested` 事件接入 crew 群板现有交互链路（可展示、可批准/拒绝、拒绝即取消或失败，语义与 P0 取消一致）。
5. **测试**：沿用 fake vendor binary fixture 模式，覆盖 success / malformed / permission / cancel / restart-recovery / preflight-fail；provider 不可用时 crew admission 的明确拒绝路径。

## 明确不做（P1 禁止）

- 不实现 Agent→Agent 交接与 auto/semi/manual 接力（P2）。
- 不实现独立 worktree 并发模式（P2）。
- 不做真实网络依赖的联调验收；真机 smoke 可选，做了就如实记录，没做就说明。

## 硬约束

- `apps/zcode-cli/packages/adapters/src/exec/external-runtime/`、`bootstrap`、`cli/src/command-center/` 下既有未提交文件**只允许最小增量修改**（如注册新 adapter 的接入点），禁止重构、改名或回滚既有实现。
- 命名沿用 P0：`crew` 前缀；runtime id 沿用 contracts 既有 `ExternalRuntimeIdSchema`（如需扩枚举，属于最小增量修改）。
- 遵守 `architecture-policy.yaml`；单文件 ≤ 400 行；UI 文案走 i18n（zh/en 同步）；凭证不硬编码。
- 不要 git commit，完成后保留工作区改动。

## 完成标准

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
- 新增 fixture 测试全部通过，既有 `crew*.test.ts` 不回退（40/40 基线）。
- 更新 `specs/agent-crew/IMPLEMENTATION.md`（P1 章节）与最终报告：改动文件、探测到的 CLI 能力、验证结果、遗留问题。
