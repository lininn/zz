# 群组多会话实现报告

时间：2026-09-25 17:59（Asia/Shanghai）。类型：Feature / 兼容性修复。项目：ZCode。分支：`feat/web-config`。执行者：Codex。

## 交付语义

- 群组是复用团队，成员引用、群内权限和 workspace 绑定共享；会话是独立任务，消息、sequence、执行、审批、恢复、上下文和原生会话续接隔离。
- 新增 `createConversation` / `listConversations`，`get/send/recover/cancel/respondPermission` 带会话边界。新 UI 显式传 `conversationId`；旧调用省略时固定访问默认会话，不跟随最近选择。
- 同群不同会话允许相同 `messageId`；同会话相同 ID 的不同正文或 mention 仍拒绝。同会话队列串行，不同会话独立调度。
- 全局 workspace 租约仍以 `workspaceIdentity.trim() || workspacePath` 为 key；没有按 conversation 拆锁。不同对话竞争同一工作目录时，沿用明确的 `workspaceBusy` 安全拒绝，不以超时释放未知写者。
- 成员替换、删除群组、重绑目录继续检查全群未决任务。群状态为聚合展示，群板 dispatch/recovery 使用当前会话状态。
- 入口仍是「设置 → Agent 群组 → 群组管理 → 群组详情」。详情展示会话列表和新建对话，每个对话复用群板；切换选择不显示旧投影，草稿、错误、审批与晚到命令结果不串会话。
- 本次不新增归档、自动接力、隔离 worktree 或手机专属运行时；共享 workspace 的文件本身没有变成独立副本。

## 改动文件

| 范围        | 文件                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约        | `packages/shared/src/agent-crew.ts`；`packages/services/src/crew/contract.ts`                                                                                   |
| 存储/迁移   | services `crew/{crewStore,crewConversationStore,crewExecutionStore}.ts`；`session/tasksDatabase/{agent-crew-v6,migrations}.ts`                                  |
| 调度/运行时 | services `crew/{crewService,crewRuntime,crewExternalRuntime,crewRecovery}.ts`；`src/node.ts` 仅替换启动恢复调用                                                 |
| UI          | `packages/ui/src/crew/` 会话列表、会话视图、现有 section/board/composer；`hooks/useCrew.ts` 与会话请求状态 helper；`i18n/locales/{zh-CN,en-US}.ts` 的 Crew 文案 |
| 测试        | services `crewConversation*.test.ts`/fixture 与旧 Crew fixture 的会话字段适配；client `test/crewConversations.test.ts`；UI Crew 回归及 `specs/agent-crew/e2e/`  |
| 规范/报告   | `specs/agent-crew/{SPEC,IMPLEMENTATION,CODEX-REPORT-CREW-CONVERSATIONS}.md`；UI `crew/{SPEC,VERIFICATION}.md`                                                   |

没有修改 `apps/zcode-cli` 源文件，没有依赖新增、Git 提交、merge/rebase 或分支切换。原有大型 `node.ts`/locale 文件只做必要接线/文案增量；Crew 新增及修改的源文件保持不超过 400 行。

### UI 与回归详细清单

- UI 组件：`CrewSection.tsx`、`CrewConversations.tsx`、`CrewConversationView.tsx`、`CrewBoard.tsx`、`CrewComposer.tsx`、`CrewPermissionRequest.tsx`。
- UI helper：`crewUiHelpers.ts`、`crewExternalUi.ts`、`crewErrors.ts`；hooks：`useCrew.ts`、`crewRequestScope.ts`。
- UI 测试：`crewConversation.test.tsx`、`crewSelection.test.ts`、`crewHookHarness.ts`、`crewUiHelpers.test.ts`、`crewRendering.test.tsx`、`crewExternalUi.test.tsx`。
- 服务新增测试/fixture：`crewConversation{Service,Recovery,Runtime,Migration,Store}.test.ts`、`crewConversationFixture.ts`、`crewRecovery.test.ts`；适配既有 `crewServiceMigration.test.ts`、`crewExternalRuntimeFixture.ts`。
- RPC：`packages/client/test/crewConversations.test.ts`。
- E2E：`specs/agent-crew/e2e/` 中的 `fixture.tsx`、`fixture-services.ts`、`fixture-conversations.ts`、`fixture-services.test.ts`、`fixture-delays.ts`、`test-fixture.mjs`、`build-fixture.mjs`、`verify-browser.mjs`、`verify-multiconversation.mjs`、`README.md`。

## v6 迁移策略

1. 由现有 tasks migration 框架在同一个 `BEGIN IMMEDIATE` 事务中执行 `0006_agent_crew_conversations`；checksum 输入包含完整冻结 SQL，v4/v5 输入不变。
2. 为每个已有群组（包括空群）建立唯一默认会话，`conversationId = groupId`，默认标题留空供 UI 本地化。
3. 重建消息/执行表，将历史行带入默认会话。原 `messageId`、sequence、文本、JSON 快照、binding、status、owner、taskId、时间戳原值保留；保持旧 rowid 的相对排序。
4. 消息主键改为 `(groupId, conversationId, messageId)`；sequence 唯一键和执行幂等键同步分区，复合外键保证消息/执行归属于同一个会话。
5. 先复制，再按外键顺序替换旧表与索引。任一阶段失败整体回滚，账本不会标记已完成；重复初始化只校验 checksum，不重迁数据。workspace 租约表不变。
6. 默认会话保留 v5 外部 runtime 原生 session key，避免既有 CLI 的「续接必须同 sessionId」检查拒绝历史任务；新会话把 conversationId 纳入原生 key。启动恢复枚举所有会话，单个恢复失败不会跳过其余会话。

## 验证

最终命令见 `IMPLEMENTATION.md` 的「群组多会话」验证表。

| 验证                            | 本轮结果                                                            |
| ------------------------------- | ------------------------------------------------------------------- |
| 服务 Crew / RPC                 | 97/97 + 8/8；合并执行 105/105                                       |
| UI Crew / 侧栏                  | 57/57 + 81/81；最终合并执行 138/138                                 |
| 离线 fixture                    | 1/1；打包和两个浏览器脚本语法检查通过                               |
| typecheck / lint / architecture | 全部通过；lint 保留 72 条既有 warnings、0 errors；架构 0 violations |
| 定向格式 / diff / 文件上限      | 通过；Crew 源文件最大 383 行                                        |
| 受保护 CLI 未提交文件           | 77 个文件 SHA-256 前后相同                                          |

独立只读后端审查未发现阻断问题，并额外验证了内存数据库 v5→v6 迁移；这不替代下面声明的真机验证缺口。

覆盖：同群两会话消息/执行/sequence/context/resume 隔离；幂等；默认调用兼容；跨会话取消/审批拒绝；queued 重启恢复和 recovery_required 分区；真实 runtime/admission/SQLite 租约互斥；v5 逐字段迁移、回滚、重复初始化与 checksum；UI 切换/晚到响应/草稿和错误分区；旧 Crew 与侧栏回归。

## 真机自测路径

1. 执行 `pnpm dev:desktop:test`，使用隔离的测试数据目录启动桌面开发环境；不要把真实生产库作为测试 fixture。打开「设置 → Agent 群组」，创建或选择一个已有 Agent。
2. 进入「群组管理」，选择同一个群组 A，并绑定一个可写测试目录。打开默认对话发送一条仅群板消息，再 `@` 一个成员派工；记下历史消息与执行。
3. 回到 A 的会话列表，点「新建对话」。新对话初始无消息/执行，但显示同一组成员与绑定。发送不同内容并派工，来回切换确认消息、执行和审批仅属于各自会话。
4. 在对话一输入未发送草稿后切到对话二，确认草稿不被带入；在请求尚未返回时快速切换会话，确认旧结果不会覆盖当前会话、清空当前草稿或把页面导航回旧会话。
5. 对话一运行中，在对话二向同目录派工：不应出现第二个写者；被明确拒绝的任务只影响自身执行记录。停止/完成后可再派工。
6. 制造测试 fixture 中的 queued/running 未决状态后重启，确认两会话都被枚举恢复；无法证明安全停止的执行只在所属会话展示恢复提示。共享目录仍受租约保护。
7. 用包含历史群板的 v5 测试数据库启动新版，默认会话应保留所有历史、状态与审批关联 task；再次重启没有重复行。默认外部会话应能继续原 native session，新建对话不能续接该 native session。
8. 切换中文/英文，在桌面和手机窄屏重复会话列表、新建、切换、发送、审批操作。Web/手机复用已有 Host attachment，不创建额外 Agent。

## 已知验证边界

- freshness 默认 fetch 因 `.git/FETCH_HEAD` 只读失败；`--no-fetch` 检查通过（本地缓存显示相对 origin/main ahead 3 / behind 1），不宣称远端已重新同步。
- 真实浏览器尝试失败：`ego-browser` 无法连接 `ego_cli bootstrap`，沙箱拒绝 NSWorkspace/XPC；没有提权或绕过。浏览器 fixture/场景可构建，但不能把 SSR、hook 测试或脚本检查算成真实点击 E2E 通过。
- 未调用付费模型或真实 vendor CLI，也未完成真机 Desktop/Web 双端 smoke。上述真机路径是可复现的后续人工验收路径，不是已执行证据。
- 全局 worklog 目录在允许写入范围之外；本仓库报告保留本次工作记录，没有越界写入个人目录。
