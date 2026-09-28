# 任务：修复 agent 端会话持久化写路径失效（crew 派工死循环真根因）

先读调查报告：`specs/agent-crew/INVESTIGATION-RECOVERY-LOOP.md`（两个并行调查 agent 的完整证据链）。你的任务是修报告里的「主修」与「防御」两项。

## 已确认事实（不要重新调查，直接从这里开始）

1. agent 进程（`apps/zcode-cli/packages/cli/dist/zcode.cjs`，09:50 重建，含工作区未提交的 session-store 迁移 0023/0024）中 `createSession` 返回成功，但 `~/.zcode/cli/db/db.sqlite` 的 session 表 **没有对应行**（9/26 起所有会话均未落库，`persistence: 'immediate'` 也一样）。
2. 随后 sendPrompt 前的 v4 hydrate（`v4-bridge.ts` `loadPersistedEvents` → `resolveConversationBackingRecord` → server-operations.ts:1452/1710 `Session not found`）降级为空历史；sendPrompt 仍因会话不存在失败。
3. `packages/services/src/crew/crewRuntime.ts:157-161` 把该错误包装为 `crew.recoveryRequired` 且无日志。

## 任务

1. **主修**：定位 createSession 的持久化写路径为何不落库（0023_external_runtime_native_session / 0024 迁移与写路径的交互；persistence 'immediate' 的执行点；写失败是否被吞）。修复为：createSession 成功返回 ⇒ session 行必然已持久化。**注意**：0023/0024 是工作区未提交改动，修它们的 bug 而不是回滚迁移；改动最小化并保留迁移语义（external runtime native session 的设计意图见迁移文件头注释）。
2. **防御**：
   - `v4-bridge.ts` loadPersistedEvents：会话不存在（Session not found）且 live 会话存活时，视为「新会话无历史」正常态（返回空事件），不视为错误路径（现在的 catch 已降级，但 sendPrompt 仍会查不到——需要让 sendPrompt 对「live 存活 + 无持久化」的会话放行，与 createSession 后立即 sendPrompt 的时序兼容）。
   - `crewRuntime.ts:157-161`：补结构化日志（serviceLogger，含原始错误消息/sessionId/phase）；「会话不存在且未投递任何输入」的确定性失败改为 failed（安全失败），不得进入 recovery_required 死循环。
3. **测试**：
   - 新增：createSession(immediate) 后 db.sqlite 必有 session 行；
   - 新增：createSession 后立即 sendPrompt 成功（不因 hydrate not found 失败）；
   - crew 基线 186/186 不回退；bootstrap 既有测试不回退。

## 硬约束

- 不回滚/不改写 0023/0024 的迁移语义（external runtime native session 是既有设计）；修交互 bug。
- 不动 `packages/services` 之外 crew 层今天已有的修复（confirmRecovery/confirm 语义/心跳等）。
- 架构策略；不 commit；`pnpm typecheck` / `pnpm lint` 通过。
- 重建 `apps/zcode-cli/packages/cli/dist/zcode.cjs`（`pnpm --dir apps/zcode-cli/packages/cli build`）作为交付物之一。

## 完成标准

- 全部门禁通过 + 新增测试通过 + zcode.cjs 重建完成。
- 报告（`specs/agent-crew/CODEX-REPORT-PERSISTENCE.md`）：持久化失效的确切根因（文件:行号）、修复、验证证据。
