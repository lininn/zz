# 任务：群组升级为首页一等公民 —— 工作群式界面

用户需求原话：「群组聊天也看不到进度，应该群组聊天放在首页。左侧加个 tab，切换到群组，能看到项目，项目下看到对话。能复制群组。右侧聊天界面就好像群聊能看到相互 @ 的信息，中间有缩短的执行记录，点击能看详细的执行过程。就好像在一个工作群相互交接执行。」

## 现状

- crew 只能从 设置 → Agent 群组 访问；首页侧栏一级视图只有「分组 | 项目」切换（`packages/ui/src/WorkspaceSidebar.tsx` + `taskGroupTogglePresentation.ts`）。
- 主视图路由 `workspaceMainView` 已有 automations / plugin-store 分支（`packages/ui/src/app-shell/WorkspaceShellLayout.tsx`），可扩展。
- 群板/执行记录 UI 在 `packages/ui/src/crew/CrewBoard.tsx`（设置页内嵌）；执行记录只有状态行 + 取消按钮，无详细过程。
- 群组复制已有 RPC（`crew.duplicate`）与设置页按钮「复制为待绑定群」。
- **已知缺陷需一并修**：成员 preflight 在 Web（server 端执行）时把本机已装的 claude/codex CLI 判为「不可用」（用户截图红字）。排查 `crewExternalRuntime.ts` / preflight 的 binary 解析与环境变量——server 由 pnpm 启动 PATH 含 `~/.local/bin`（codex）等，怀疑 preflight 未继承完整 PATH 或 binaryPath 解析过窄。修复后「前端 Codex / 设计 Claude」应显示可用。

## 需求实现

### 1. 侧栏「群组」一级 tab
- 与「分组 | 项目」同级新增「群组」切换项（复用现有一级视图切换机制）。
- 选中后侧栏树：**按 workspace（项目）分组 → 群组 → 会话（对话）**；未绑定目录的群组归入「未绑定」组。
- 每个群组项提供菜单：新建对话、复制为待绑定群、编辑、删除（复用现有 RPC）。
- 点击会话 → 主区打开群聊视图；会话项显示状态徽标（就绪/运行中/待确认恢复/失败）。

### 2. 主区群聊视图（新 `workspaceMainView === "crew"`）
- 布局：上方会话头（群组名/会话名/成员头像行），中间消息流，底部输入框（复用 CrewComposer 的 @ 派工语义）。
- **消息流群聊化**：按发送者分组气泡（你 / 各 Agent / 系统），@ 交接消息有明确「A → B 交接」视觉（成员色 + @ 目标高亮）；Agent 回复消息可折叠长内容。
- **执行记录折叠条**：每条执行一行——成员名、状态徽标、已耗时、（外部 runtime 显示 runtime 名）；**点击展开详细执行过程**：
  - ZCode runtime：复用该执行绑定的 task timeline（V4 会话事件）；
  - 外部 runtime：展示归一化事件流（crewExternalRuntime 事件）；
  - 展开容器用侧滑面板或内联展开，避免跳离群聊上下文。
- 设置页 crew 分区保留（Agent 管理 + 群组管理），首页侧重日常使用。

### 3. 硬约束
- 复用 `useCrew` / `crewRequestScope` 现有数据层，不为首页另建第二套状态。
- 移动端：群组 tab 与群聊视图在窄屏可用（侧栏抽屉机制沿用）。
- i18n zh/en 同步；架构策略；单文件 ≤ 400 行；不动 `apps/zcode-cli` 未提交文件；不 commit。
- 执行详情数据缺失时显示「详细过程不可用（原因）」，不空转不假数据。

### 4. 完成标准
- `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check --changed` 通过。
- 测试：新增侧栏群组树、群聊消息流分组、执行折叠条交互测试；既有 crew（97 服务端 / 57 UI）与侧栏（81）不回退。
- preflight 修复后，本机已装 claude/codex 的成员在 Web 上显示可用（真机验证路径写进报告）。
- 更新 `specs/agent-crew/IMPLEMENTATION.md` + 最终报告（含真机自测路径）。
