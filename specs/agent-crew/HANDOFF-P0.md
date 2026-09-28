# 任务：实现 Agent 群组功能 P0 垂直切片

你是本仓库的实现工程师。先读以下三份材料，再动手：

1. `AGENTS.md` — 仓库工程规范（spec 优先、typecheck/lint 必跑、架构检查、注释用中文说明原因）。
2. `specs/agent-crew/design.html` — 本功能的完整设计文档（交互、并发模式、接力策略、状态所有者、落点、分期）。
3. `apps/zcode-cli/specs/external-runtime-dispatch/SPEC.md` — 外部 runtime 适配层的既有约定（仅参考，P0 不实现外部 runtime）。

## 本期范围（只做 P0，见设计文档第 7 节）

1. `agent_crew` 协议与类型定义（放 `packages/shared`），以及 tasks-index 数据库新 migration（群组、成员、消息、执行记录表；不要复用 `task_groups` 表）。
2. `CrewService`（放 `packages/services`）：群组 CRUD、成员管理、群组复制（只复制配置快照，工作目录绑定为空、无消息/任务，处于待绑定态）、重新绑定工作目录的预检。
3. ZCode 默认 runtime 执行：用户在群内 `@` 单个 Agent → 组装「角色提示词 + 群板最近 N 条 + 本次任务」→ 通过现有 task/session 创建链路执行 → 结果写回群板。
4. 共享目录模式的全局单写者租约（按 workspaceIdentity；跨群、跨普通会话互斥；崩溃后可恢复）。
5. 消息与执行状态持久化 + 进程重启后的恢复（幂等键 `groupId + messageId + memberId`）。
6. 最小 UI：设置或侧栏入口创建群组、选择成员与目录、群聊视图（可先复用 v4 会话视图构件），支持输入 `@` 选择成员（复用 `packages/ui/src/mentions/` 的 provider 模式）。
7. i18n：zh-CN 与 en-US 同步补齐。

## 明确不做（P0 禁止）

- 不实现 Claude/Codex/OpenCode 适配器接入群组（P1）。
- 不实现 Agent→Agent 交接、auto/semi 接力（P2）。
- 不实现独立 worktree 并发模式（P2），表结构可预留字段。
- 不做群板摘要、成本统计（P3）。

## 硬约束

- 当前分支 `feat/web-config` 工作区有大量未提交改动（尤其 `apps/zcode-cli/packages/adapters/src/exec/external-runtime/`、bootstrap、cli command-center）。**绝对不要 revert、覆盖或重构这些文件**；你的改动只新增文件或对必要接入点做最小增量修改。
- 新领域命名统一用 `crew` / `agent_crew` 前缀，避免与现有 `task_groups`、Bots 语义冲突。
- 遵守 `architecture-policy.yaml`：services 层持事实，UI 不直接碰 Repo，跨包走公开入口；单文件 ≤ 400 行。
- 凭证/密钥不得硬编码；UI 文案全部走 i18n。
- 不要 git commit，完成后保留工作区改动即可。

## 完成标准

- `pnpm typecheck` 通过；`pnpm lint` 通过（如失败必须修复，如实报告最终结果）。
- `pnpm architecture:check --changed` 通过。
- 为 CrewService 核心逻辑（建群、复制、租约互斥、恢复幂等）编写可运行的测试并执行通过（参考仓库内现有 vitest/node:test 用法，以目标包实际配置为准）。
- 最后输出一份简短实现报告：改了哪些文件、验证结果、遗留问题。
