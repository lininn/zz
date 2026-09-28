# 任务：P0.1 修正 —— Agent 与群组解耦（用户测试反馈）

用户实际测试后反馈当前实现不符合预期：**Agent 和群组必须是分离的两个实体**。当前实现把 Agent 定义与群组耦合在一起，需要重构。

## 目标交互模型（以本条为准，冲突处覆盖设计文档早期表述）

1. **独立的 Agent 资产库（catalog）**：
   - 全局入口管理 Agent，与群组无关；可创建任意多个 Agent。
   - 每个 Agent 独立配置：名称、角色提示词（systemPrompt）、模型选择（ModelSelection）、runtime 绑定（zcode / claude / codex / opencode）、能力与权限。
   - 独立 CRUD：创建、编辑、删除、列表。删除前检查是否被群组引用，被引用时明确提示。
2. **群组只引用，不拥有 Agent**：
   - 创建/编辑群组时，从已有 Agent catalog 中**挑选**成员加入；不提供在群内新建 Agent 的路径。
   - 群成员记录 `agentId` 引用 + 群内级覆写（如该群内的读写权限）；同一个 Agent 可同时加入多个群组。
   - Agent 定义更新后，引用它的群组在下次执行时使用最新定义（不做快照冻结；若 P0 已实现 configVersion 快照，改为显式显示当前定义版本即可，不阻塞）。
3. **UI**：
   - Agent 管理独立入口（参考 `packages/ui/src/settings/SubagentsSection.tsx` 的表单交互模式，但这是 crew 的 agent catalog，不是 runtime subagents）。
   - 建群/编辑群 = 选目录 + 选人（从 catalog 多选）+ 群策略；成员卡片显示引用的 Agent 名称/runtime，不内嵌编辑表单。

## 改动范围

- `packages/shared/src/agent-crew.ts`：拆分 Agent catalog 类型与 crew 群组/成员类型；成员仅存引用。
- `packages/services/src/crew/`：CrewService 拆出 AgentCatalogService（或同 service 内清晰分域）；建群/编辑校验改为「引用必须存在」。
- migration：若 P0 把 Agent 定义内嵌在群组成员表中，新增迁移把定义抽到独立表；工作区未发布，允许调整 schema 声明，但必须走本仓库 migration 体系并更新对应 checksum 输入。
- UI：`packages/ui/src/crew/` 重构为「Agent 管理 + 群组管理」两个视图；`useCrew*` hooks 对应拆分；i18n zh/en 同步。
- 测试：现有 `crew*.test.ts` 全部按新模型更新；新增 catalog CRUD、引用校验、多群共享同一 Agent、删除被引用 Agent 的拒绝路径测试。

## 硬约束

- P1 已落地的外部 runtime 接入（adapters/contracts/bootstrap 下的改动）保持不动，仅在成员引用结构变化处做适配。
- 不 revert、不重构 `apps/zcode-cli` 下用户未提交的 external-runtime 既有文件。
- 命名、架构策略、i18n、400 行上限等约束同 `HANDOFF-P0.md`。
- 不要 git commit，完成后保留工作区改动。

## 完成标准

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
- 更新后全部 crew 测试通过（含 P1 新增的 runtime fixture 测试，不得回退）。
- 更新 `specs/agent-crew/IMPLEMENTATION.md`（P0.1 章节）与最终报告。
