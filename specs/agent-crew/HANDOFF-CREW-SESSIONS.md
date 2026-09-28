# 任务：群组多会话 —— 群组可复用，成员共享、对话内容隔离

用户需求原话：「每个群组我可以复用。假如说我用 A 群组打开了一个聊天对话，我也可以用 A 群组再创建个对话。两个不受影响。就好像两个任务。但是人员共享。工作内容不共享。」

## 目标模型

- **群组（crew group）= 可复用团队**：成员（agentId 引用）、群内权限、并发/接力策略、workspace 绑定。群组本身不再绑定单一消息流。
- **群组对话（crew conversation）= 一次任务实例**：属于某个群组；拥有独立的群板（消息）、执行历史、审批状态。同一群组可同时存在多个对话，互不可见对方消息。
- 类比：群组像「项目团队」，对话像「任务」。

## 现状与差距

- 当前 `crew_message` / `crew_execution` 直接挂在 `group_id` 下；一个群组只有一条隐式消息流（见 `packages/services/src/crew/crewStore.ts`、`crewAdmission.ts`）。
- 幂等键 `groupId + messageId + memberId` 需升级为会话维度。
- UI（`packages/ui/src/crew/CrewBoard.tsx`、`CrewSection.tsx`）默认把群组当聊天面板，无会话列表/新建对话入口。

## 改动范围

1. **协议**（`packages/shared/src/agent-crew.ts`）：新增 conversation 实体与参数（创建会话、会话列表、按会话取消息/执行）；`crewListParams` / `crewSendParams` 等带上 conversationId。
2. **存储**：新增 migration（v6），`agent_crew_messages` / `agent_crew_executions` 增加 `conversation_id` 列；旧数据迁移到每群首个默认会话，保证不丢历史。幂等键相应升级。
3. **服务**（`packages/services/src/crew/`）：CrewService 增加会话生命周期（创建/列表/归档可选）；派工、执行、恢复、租约全部以 `(groupId, conversationId)` 为界；**租约仍按 workspaceIdentity 全局互斥**（不同对话写同一目录依旧单写者）。
4. **UI**（`packages/ui/src/crew/`）：群组详情 = 会话列表 + 「新建对话」；每个对话一个群板视图（复用现有 CrewBoard），切换对话互串数据为零。入口沿用「设置 → Agent 群组 → 群组管理 → 群组详情」。
5. **i18n** zh/en 同步。

## 硬约束

- 旧数据零丢失（迁移到默认会话）；迁移走本仓库 migration 体系并更新 checksum 输入。
- 幂等与恢复语义按会话维度重验：重启后队列恢复、recovery_required 均不串会话。
- 不动 `apps/zcode-cli` 下未提交文件；不 git commit。
- 架构策略、单文件 ≤ 400 行、UI 文案走 i18n。

## 完成标准

- `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。
- 新增测试：同群组两会话消息隔离、执行互不可见、幂等键会话维度、迁移保留旧消息、租约跨会话互斥。
- 既有测试不回退（服务端 crew 74、UI crew 41、侧栏 73）。
- 更新 `specs/agent-crew/IMPLEMENTATION.md` 并输出报告：改动文件、迁移策略、真机自测路径。
