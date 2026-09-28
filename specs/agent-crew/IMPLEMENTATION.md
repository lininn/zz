# Agent Crew P0 / P1 实现报告

最新接力增量：[RELAY.md](./RELAY.md) / [CODEX-REPORT-CREW-RELAY.md](./CODEX-REPORT-CREW-RELAY.md)；下方历史阶段限制不覆盖接力增量。

日期：2026-09-24。分支：`feat/web-config`。未提交 Git，未恢复/覆盖原有 CLI external-runtime、bootstrap、command-center 改动。

## 已实现

- `agent-crew` strict Zod 类型及服务 RPC descriptor；`0004_agent_crew` checksum migration 新建群组、独立成员、消息、执行、全局租约五张表，不复用 `task_groups`。
- CrewService：CRUD、成员配置快照、事务复制、待绑定、目录预检与新绑定纪元；消息/执行原子入队，`groupId + messageId + memberId` 幂等与跨连接 CAS。
- 默认 ZCode 执行：预存 taskId → 既有 SessionService 创建 → V4 sendText → 真实 session 状态读取 → 群板原子回复；角色/最近 20 条有界群板/本次任务组合，历史纪元不混入新目录。
- 共用 AgentService 准入：按 identity/path SQLite 单写租约隔离多群、普通桌面会话和 replayable 输入。要求本次 inputId/sourceCommandId 的权威执行行，并用 ACK 后新独立订阅的初始快照建立读取屏障；检查前后台工作、队列和目标，防止旧 idle、晚到帧、取消和关闭竞态提前解锁。
- 安全恢复：queued 可恢复派发；归属不明或未知 ACK 保留 `recovery_required`，不重放已启动写任务。Unix 同时核验 Host 与 runtime 进程组；fencing token 防止旧持有者释放新租约。
- 设置页 Crew 入口：角色编辑、绑定/复制、群板、执行状态、安全取消；直接键入独立 `@` 或按钮打开成员选择，正文/粘贴不派工。通过 hooks 与既有 mention provider 数据模型接入，zh-CN/en-US 配套。

## 文件范围

| 范围             | 文件                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 规范/报告        | `specs/agent-crew/SPEC.md`、本报告；UI `crew/SPEC.md`、`crew/VERIFICATION.md`                                                                                          |
| 共享协议         | `packages/shared/src/agent-crew.ts`、`channels.ts`、`index.ts`、`zcode-protocol/index.ts`                                                                              |
| 业务与存储       | `packages/services/src/crew/{contract,crewService,crewStore,crewExecutionStore}.ts`                                                                                    |
| 执行与准入       | `packages/services/src/crew/{crewRuntime,crewLease,crewAdmission,crewAdmissionMonitor}.ts`                                                                             |
| Migration        | `packages/services/src/session/tasksDatabase/{agent-crew-v4,migrations}.ts`                                                                                            |
| 必要装配点       | services 的 `node.ts`、`index.ts`、`accessor.ts`、`zcode-agent/{zcodeAgent,zcodeAgentService}.ts`、`zcode-session/zcodeSession.ts`；client 的 `remoteServiceAccess.ts` |
| UI               | `packages/ui/src/crew/*`、`hooks/useCrew*.ts`、`mentions/providers/crewMentionProvider.ts`                                                                             |
| UI 入口/文案增量 | `SettingsPage.tsx`、`settings/settingsPageConfig.ts`、`lib/settingsNavigation.ts`、两份 locale                                                                         |
| 后端测试         | `packages/services/test/crew*.test.ts`、`crewAdmissionFixture.ts`                                                                                                      |

所有本次新增源文件/测试均不超过 400 行；已有大型装配文件只作必要增量修改。未新增依赖，未接入外部 runtime、自动交接、worktree、摘要或成本统计。

## 验证

| 命令/检查                                                                                            | 结果                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm typecheck`                                                                                     | 通过                                                        |
| `pnpm lint`                                                                                          | 通过：0 errors；72 条既有 warnings（Crew 定向 lint 为 0/0） |
| `pnpm architecture:check --changed`                                                                  | 通过：0 violations / 0 baseline / 0 new                     |
| `node --import tsx --test packages/services/test/crew*.test.ts`                                      | 40/40 通过                                                  |
| `TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*` | 14/14 通过：helper/provider/真实 React SSR                  |
| importedClaudeRecovery、providerConfigMigration 既有回归                                             | 5/5 通过                                                    |
| 定向格式与 `git diff --check`                                                                        | 通过                                                        |

后端测试包括完整的 CrewService → runtime port → 既有 session/V4 → wire monitor → 群板 fixture 链路；没有调用付费模型或真实用户工作目录。测试使用 Node `--import tsx`，绕开本沙箱禁止创建 tsx CLI IPC socket 的限制。

## 边界与未验证项

- 未执行浏览器/Electron 点击、键盘、移动端视觉 E2E，也未做真实模型 smoke；SSR 与 fixture 不等价于这些验证。可执行人工场景在 UI `SPEC.md`。
- P0 本地目录执行；远端 binding 明确报不可用，不解释为本机路径，不拉起额外远程 Agent。桌面与手机共用准入语义已做 fixture 验证，手机全链路未联调。
- 只读成员仅开放 Read/Glob/Grep，但 P0 也保守占用共享租约，不提供并行读/快照基线。跨群租约冲突持久化为可解释失败，需用户重新派工。
- Windows 缺少可恢复的进程树归属证明时，崩溃租约保持隔离；缺可信 taskId/原进程仍存活时没有强制清除入口。这些情况保留 `recovery_required`，不冒险自动抢锁。
- workspace freshness 命令已尝试，但沙箱禁止写 `.git/FETCH_HEAD`，未完成远端基线同步；没有 merge/rebase/pull。
- 全局 worklog 目录在当前只读范围，本次变更摘要保留于本报告，没有向工作区外写入记录。

## P1 — UI 接入分片（2026-09-24）

本节仅记录 UI executor 的交付与验证，不把它视为整个 P1 的 CLI/后端验收。

- 成员编辑支持 contracts runtime ID：`zcode`、`claude-cli`、`codex-cli`、`opencode-cli`。移除 P0 保存时强制改写 ZCode 的行为；运行时变化更新 configVersion，未变化保留版本，历史快照不变。
- 按 `detail.runtimeAvailability` 的 memberId + runtimeId 展示可用性、版本与不可用原因。缺失/不匹配的能力按未验证处理；所选外部成员不可用时阻止派工，禁止静默降级，清除成员后仍能仅发布群板消息。
- 权限卡片经 `useCrew.respondPermission` 调用 `service.respondPermission`，携带 groupId/executionId/requestId/approved。不支持权限回复时禁用批准并说明原因；拒绝交由服务执行安全取消。pending 禁止重复操作，terminal/recovery 不显示过期审批，UI 不乐观标记完成或解锁。
- 改动文件：UI `crew/{CrewGroupEditor,CrewBoard,CrewComposer,CrewSection,CrewRuntimeStatus,CrewPermissionRequest}.tsx`、`crew/{crewUiHelpers,crewExternalUi,crewErrors}.ts`、三份 `crew*.test.*`、`hooks/useCrew.ts`、zh/en Crew 文案及 UI `SPEC.md`/`VERIFICATION.md`。未修改 shared/services/CLI 源码、未加依赖、未 commit。
- 新鲜验证：UI SSR/helpers **29/29**；`pnpm typecheck` 通过；`pnpm lint` 72 warnings / 0 errors（Crew 定向 0/0）；`pnpm architecture:check --changed` 0/0/0；定向格式、`git diff --check` 通过。新增 UI 源码/测试均 ≤400 行。
- 本分片未执行浏览器/Electron E2E、真实 CLI help/probe 或模型 smoke，也未代验后端 fixture。E2E 场景、状态所有者与事件顺序、完整文件清单见 `packages/ui/src/crew/{SPEC,VERIFICATION}.md`；CLI 能力与后端验收应由对应实现报告补充。

## P1 — CLI/Core/Bootstrap 限定切片（2026-09-24）

已接通独立 `crew/runtime` → 外部 facade/dispatch，不创建 ZCode session；新增实时权限、可信 settled/cancel/recovery、成功历史 resume 和 SQLite 同事务结果元数据与 workspace/attachment 隔离。Claude/Codex/OpenCode 注册沿用既有 adapter；未验证 sandbox 明确不可用。

本切片回归 62/62；services crew 当前 55/55；根 typecheck/lint/architecture 通过。CLI 包级全量 lint 有原有超长文件失败，定向改动文件 lint 通过；没有把这些失败隐藏为通过。改动文件、命令、协议边界及剩余限制见 `P1-CLI-CORE-REPORT.md`。真实 CLI 能力探测与 adapter fixture 报告由对应 lane 汇总，本切片不宣称真机 smoke 或 UI E2E。

### P1 集成补丁：跨 Host 预检只读

Protocol facade 现在以 `recoverOnCreate=false` 创建；probe/read 与观察实例关闭不会改写首个 Host 的运行态或派发 queued。恢复/刷新仅由已获租约的显式 start 触发，且禁止重放旧 queued；legacy 默认恢复行为不变。新增双实例回归 5/5，完整限定回归提升为 67/67，根 typecheck/lint/architecture 通过。详见 `P1-CLI-CORE-REPORT.md` 的集成复核补丁章节。

### P1 集成交接补丁：A→B→A

每次显式 owned start 在 coordinator 空闲时刷新 scoped durable snapshot，保留其他 Host 新完成的结果；本地 active/pump/未决权限阻止刷新，query/probe 仍零写入。新增 A→B→A 等四个回归后，observer/handoff 9/9、完整限定回归 71/71；根 typecheck/lint/architecture 及 CLI 类型/定向 lint 通过。未修改 storage，详见 `P1-CLI-CORE-REPORT.md` 同 scope 交接章节。

## P1 — 合并验收汇总

本节汇总 P1 接入；上面的各 lane 测试数是各自交付时的快照，不相加作为最终验收数。P0 未提交内容保留；本次没有 commit、merge、rebase 或恢复其他工作区改动。

### 完成的接入

- 成员按 `zcode` / `claude-cli` / `codex-cli` / `opencode-cli` 分派。外部成员只走 `CrewService → crew/runtime → ExternalRuntimeFacade → ExternalRuntimeDispatchService → adapter`，不创建 ZCode 模型会话、不静默降级。
- group/member/epoch/完整配置快照构成外部 session 关联；只有同上下文的已停止成功任务且确实存在 native session ID 才传 `resumeNativeSessionId`。无 native ID 时开新的同 vendor 单次执行，仍携带有界群板，不发无效 resume。
- 外部与普通会话共享原 SQLite 写租约。外部 start 使用内部 fencing-token 入口；公开 start、普通输入借用外部 ID、外部输入借用普通 session 租约都被拒绝。未知 ACK、cleanup 失败、失联保持 `recovery_required`，不提前解锁。
- 外部预检失败：成员显示不可用原因，输入 admission 明确拒绝；接受后能力失效明确失败。复制/重绑/配置改变不串用旧 native 上下文。
- 实时 `permission.requested` 投影到群板审批卡片；严格关联 execution/request，拒绝走 P0 的安全取消。即使 vendor 已退出，未决审批仍保留到显式处理。没有经过验证的权限回复能力时禁用批准，绝不显示虚假批准成功。
- Codex/OpenCode 有独立 JSON 事件转换、能力探测、结构化结果、interrupt/cancel、重启/续跑 fixture。未知或畸形事件 warning；stderr 不能伪造结果。
- Claude 只补必要安全增量：真正应用已探测的 leaf/只读工具约束；分离 stdout/stderr；非零退出及 vendor 明确错误不能伪装成功；异常或提前关闭迭代器必须停止进程，取消返回结构化 cancelled，无法确认清理时保留恢复隔离。
- 沿用 contracts 的 objective 8000 字符上限：先移除旧群板历史，不截断角色/当前任务；仍超限则在 task/租约前明确失败，zh/en 同步。
- 外部结果在既有 SQLite request_json 的受校验保留字段内同事务保存，没有新增 migration 或第二份队列。跨 workspace/remote attachment 隔离；仅查询/探测的 Host 不恢复或派发别的 Host 的任务。

### P1 改动文件

| 范围                        | 文件（目录内列出 P1 增量，不包含无关既有脏文件）                                                                                                                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享协议                    | `packages/shared/src/{agent-crew,crew-external-runtime,index}.ts`、`zcode-protocol/index.ts`                                                                                                                                                  |
| Crew 业务                   | `packages/services/src/crew/{contract,crewRuntime,crewExternalRuntime,crewAdmission,crewService}.ts`                                                                                                                                          |
| Host RPC 接口               | `packages/services/src/zcode-agent/{zcodeAgent,zcodeAgentService}.ts`                                                                                                                                                                         |
| Host 测试                   | `packages/services/test/crewExternal{Runtime,Prompt}.test.ts`、`crewExternalRuntimeFixture.ts`                                                                                                                                                |
| CLI adapters                | `apps/zcode-cli/packages/adapters/src/exec/external-runtime/{codex-adapter,codex-events,opencode-adapter,opencode-events,vendor-cli-support,vendor-runtime-sessions}.ts`；`claude-adapter.ts`、`claude-events.ts` 和 `exec/index.ts` 最小增量 |
| CLI core / contracts / 存储 | 两份 external-runtime contract、core `external-runtime-service.ts` / `external-runtime-coordinator.ts` / `crew-runtime-events.ts`、SQLite `repositories/external-runtime-queue.ts`                                                            |
| CLI bootstrap / 协议        | `app/{external-runtime,crew-runtime,create-app,types}.ts`、`zcode-protocol/{crew-runtime,server,server-types}.ts`、`zcode-protocol-entrypoint.ts`                                                                                             |
| CLI fixtures / 测试         | adapters `vendor*.test.ts` / `vendor-fixture.ts` / `fixtures/vendor-binary.mjs` / `crew-claude.test.ts` / `fixtures/crew-claude-binary.mjs`；core 与 bootstrap 的 `crew-runtime*`；相关既有 service/coordinator 回归断言                      |
| UI                          | `crew/{CrewGroupEditor,CrewBoard,CrewComposer,CrewSection,CrewRuntimeStatus,CrewPermissionRequest}.tsx`、`crew/{crewUiHelpers,crewExternalUi,crewErrors}.ts`、测试、`hooks/useCrew.ts`、zh-CN/en-US locale                                    |
| 规范 / 证据                 | `P1.md`、本报告、`P1-ADAPTERS.md`、`P1-CLI-CORE-REPORT.md`、UI `SPEC.md` / `VERIFICATION.md`                                                                                                                                                  |

新增文件均不超过 400 行。既有大型装配/协议入口只加必要接口与注册点，没有重构、重命名或回滚旧实现。未新增依赖、未扩展 P2 的接力/worktree 功能。

### 实机 CLI 能力（只读探测，不是联网 smoke）

| CLI      | 本机版本与探测                                                                                                                                                                              | 保守边界                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Claude   | `2.1.241`；`--print`、`--output-format stream-json`、`--json-schema`、`--resume`、`--tools`、`--disallowedTools`、`--disable-slash-commands`、`--permission-mode manual` 在实际 help 中存在 | 没有确认可回传审批决定的非交互 CLI 通道；批准不可用，展示/拒绝可用。认证仍在实际 probe 中重新校验           |
| Codex    | `0.156.1`；`exec --json --output-schema`、`exec resume`、stdin、sandbox/feature flags；`login status` 已认证                                                                                | capability probe 通过仍要求受信外层隔离证明；`permissionReplies=false`                                      |
| OpenCode | `1.18.30`；`run --format json`、`--session`、`--pure`、`--model`                                                                                                                            | auth list 因当前环境文件访问失败；未证明 schema/leaf/权限回复能力，绑定明确不可用，不用危险 `--auto` 或降级 |

更详细命令证据见 `P1-ADAPTERS.md`。没有记录原始认证输出、凭据或用户路径。

### 合并后的验证

| 检查                                                                       | 最终结果                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                           | 通过                                                                                  |
| `pnpm lint`                                                                | 通过：0 errors，72 条既有 warnings                                                    |
| `pnpm architecture:check --changed`                                        | 通过：0 violations / 0 baseline / 0 new                                               |
| CLI contracts/core/adapters `build` + bootstrap `typecheck`                | 通过，显式覆盖根 typecheck 未包含的 CLI 子树                                          |
| `node --import tsx --test packages/services/test/crew*.test.ts`            | **60/60 通过**：P0 40 个未回退，P1 新增 20 个                                         |
| UI Crew SSR/helpers                                                        | **29/29 通过**                                                                        |
| CLI 相关 contracts/adapters/core/bootstrap/command-center 全部定向 fixture | **173/173 通过**，包含新 vendor 46 个、Claude 新 9 个及跨 Host observer/handoff 10 个 |
| 新增/修改范围的定向格式检查、Claude 定向 lint、`git diff --check`          | 通过；不为格式化重写既有大型 CLI 入口                                                 |
| 新增源文件/测试行数                                                        | 均 ≤400；未修改的既有超长文件不计入本次新增合规声明                                   |

离线 CLI 回归命令（从根执行）：

```sh
node --import tsx --test \
  apps/zcode-cli/packages/contracts/test/external-runtime.port.test.ts \
  apps/zcode-cli/packages/adapters/test/external-runtime/*.test.ts \
  apps/zcode-cli/packages/adapters/test/storage/external-runtime-queue.test.ts \
  apps/zcode-cli/packages/core/test/runtime-task/*.test.ts \
  apps/zcode-cli/packages/bootstrap/test/app/*.test.ts \
  apps/zcode-cli/packages/bootstrap/test/zcode-protocol/crew-runtime.test.ts \
  apps/zcode-cli/packages/cli/test/command-center/delegate.test.ts

TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*
```

最后一次合并验收覆盖：三种外部路由、provider 不可用准入、native ID 缺失、配置/纪元隔离、双向租约借用攻击、取消/启动竞态、异常 cleanup、不重放恢复、已退出的权限等待、8k 输入边界、跨 workspace/attachment 存储隔离和 A→B→A 只读/执行交接。

### 未执行与保留边界

- 未做真实模型/网络联调或付费调用；未执行浏览器/Electron 点击与移动端视觉 E2E。UI 的 SSR/交互参数测试与已记录的 E2E 场景不等价于真实浏览器验证。
- 生产外部隔离证明默认 false。只有受信启动配置才能开启；不能通过 RPC、成员配置或提示词声明已沙箱化。缺少该证明即明确不可用。
- 保留既有 dirty workspace 与独立 verification 安全门槛；本期没有新增 worktree 或群板 verification 命令配置，不把未验证写入标成成功。
- 当前三个实际 CLI 没有已验证的权限回复通道；支持批准的语义通过可回应 fake adapter 验证，不声称真机批准已支持。
- Windows/Linux 未做真实 CLI/信号 smoke；无法证明进程树已停止时保持租约隔离。
- 根要求的 typecheck/lint/architecture 是验收门槛；额外 CLI 包级全量 lint 的既有超长文件违规未被隐藏为通过，也没有为清理它们越界重构。
- workspace freshness 已执行但 `.git/FETCH_HEAD` 只读，未能完成远端检查；没有用 merge/rebase/pull 规避。
- 全局 worklog 位于允许写入根之外，未尝试绕过权限；本报告为本次可写工作区中的实现记录。

### P1 交接读路径补充：resume 候选无需等到 start 刷新

activated 但空闲的 facade 现在直接读取 scoped durable 最新结果，Host 可在新 start 前验证其他 Host 完成的 taskB；本地 active/queued 保留实时投影，已退出未决权限只补入匹配的持久化 attempt。A read(taskB)→resume taskC 的零写入校验和 active permission read 已纳入回归：observer/handoff 10/10、完整限定回归 72/72；根 typecheck/lint/architecture 与 CLI 类型/定向 lint 通过。

## P0.1：Agent 与群组解耦

### 交付结果

- Agent catalog 与群组分为独立类型、服务/RPC channel、数据库实体和 UI 视图。catalog 负责 name/systemPrompt/runtime/ModelSelection/accessMode/toolAllowlist，服务生成 agentId/configVersion。
- 群成员只持有 memberId、agentId 和可选 accessMode；建群/编辑只能从 catalog 选人。同一 Agent 可跨群复用，引用存在性及删除保护在数据库事务和外键中保证。
- catalog 更新不改群引用、不阻塞运行中的任务。当前群详情显示实时定义和版本；每次新派工读取最新定义，已接受执行的审计快照及重复消息/恢复保持不变。补充了两群同时引用同一 Agent 后下一次派工均使用新定义的实际服务回归。
- v5 `0005_agent_crew_catalog` 迁移新增 catalog、抽取旧内嵌定义、改写引用表；冻结 v4 checksum，新 checksum 包括 v5 SQL 与抽取语义版本。同 ID 不同定义及历史同群重复成员无损拆分，历史执行 JSON 不改写。
- 权限覆写不能超过资产上限；Agent 从 write 降为 read 后既有引用有效权限收敛为 read。重命名不重写成员；复制和编辑草稿安全归一化历史 write 覆写。ZCode 工具白名单与只读工具集取交集。
- 新建/编辑群组包含选目录、catalog 多选和群内权限；成员卡片只展示当前定义，不内嵌定义表单。Agent 管理提供独立 CRUD、明确的引用删除拒绝，以及 zh/en 文案。

### 改动文件

| 范围          | 本次文件                                                                                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共享契约/RPC  | `packages/shared/src/{agent-crew,channels}.ts`；services `crew/{contract,agentCatalogContract}.ts`、`{accessor,index,node}.ts`；client `src/remoteServiceAccess.ts`                                                                    |
| 服务/持久化   | `crew/{agentCatalogService,agentCatalogStore,crewService,crewStore,crewRuntime}.ts`；`session/tasksDatabase/{agent-crew-v5,migrations}.ts`                                                                                             |
| UI            | 新增 `CrewAgentCatalog`、`CrewAgentEditor`、`CrewAgentModelField`、`CrewWorkspaceField`；重构 group/board/composer/runtime 与 catalog helpers；拆分 `useCrewAgentCatalog`、`useCrewAgentModels`；更新 mention provider 与 zh/en locale |
| 回归          | services `crew*.test.ts`/fixture 按引用模型更新，新增 catalog/probe/shared execution；client `test/crewAgentCatalog.test.ts`；UI catalog/rendering/helpers/runtime 测试                                                                |
| 规范/交互场景 | 根与 UI `SPEC.md`、UI `VERIFICATION.md`、`e2e/` 离线组件夹具与脚本、本章、`CODEX-REPORT-P0.1.md`                                                                                                                                       |

P1 adapters/contracts/bootstrap 的执行实现未修改：开工时记录的 **569 个 CLI 源文件哈希最终全部一致**。无依赖新增、无 git commit，原有未提交改动保留。所有 crew 相关源文件/测试均不超过 400 行。P0 文件开工时已大量未跟踪，未将相对 HEAD 的工作区总差异误报为本次净增行数。

### 最终验证

| 命令/范围                                                                                                     | 结果                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `pnpm typecheck`                                                                                              | 通过                                  |
| `pnpm lint`                                                                                                   | 通过：0 errors，72 条既有 warnings    |
| `pnpm architecture:check --changed`                                                                           | 0 violations / 0 baseline / 0 new     |
| `node --import tsx --test packages/services/test/crew*.test.ts packages/client/test/crewAgentCatalog.test.ts` | **79/79**（服务 74 + RPC/共享契约 5） |
| `TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*`          | **41/41**                             |
| 上文 P1 CLI contracts/adapters/core/bootstrap/command-center 完整定向回归命令                                 | **173/173**，无跳过                   |
| importedClaudeRecovery + providerConfigMigration                                                              | **5/5**                               |
| 定向格式、`git diff --check`、400 行核验                                                                      | 通过                                  |
| `node specs/agent-crew/e2e/build-fixture.mjs`、browser 脚本语法检查                                           | 通过；不等于浏览器执行通过            |

全部已执行测试合计 **298/298**。原始日志位于 `/tmp/crew-p01-{services,ui,cli,typecheck,lint,architecture}-final.log` 和 `/tmp/crew-p01-migration-regression.log`。

### 验证缺口与保留边界

- 浏览器最初连接成功，但更新实现后重新连接被沙箱的 ego_cli bootstrap 限制拒绝；本地 HTTP listen 也被 EPERM 拒绝。因此未完成 P0.1 浏览器点击、完整 Web/Electron 和移动端视觉 E2E。已提供可复现离线真实组件/内存服务夹具与场景，明确不替代真实 Host/SQLite E2E。
- freshness 脚本已运行，因 `.git/FETCH_HEAD` 不可写，远端基线校验未完成；未 merge/rebase/pull 或绕过权限。
- 外部 runtime 模型仍使用 P1 原有 vendor CLI 配置；catalog UI 明示模型/细粒度 ZCode 工具控制的适用范围。没有为了增加外部模型控制而改写 P1 adapters/contracts/bootstrap。未进行真实模型调用、付费测试或额外平台 smoke。
- 全局工作记忆目录在允许写入根之外，未绕过权限；本章及最终报告是本次工作区内的持久记录。

格式边界：完整 zh/en locale 的 oxfmt 检查仍指出用户既有 `webRemoteControl.relay` 段的三处长行；已与格式化临时副本比较，所有差异均在该无关段，Crew 改动段一致。为保留无关工作区改动未重排这些行，未将完整 locale 格式检查写为通过。

## 群组多会话：共享团队、隔离任务（2026-09-25）

### 当前交付

- `CrewConversation` 成为任务边界。群组继续共享成员引用、权限与 workspaceBinding/epoch；会话独立持有消息 sequence、执行、审批、恢复、上下文和原生会话续接。
- 新增 `createConversation` / `listConversations`；`get/send/recover/cancel/respondPermission` 支持 `conversationId`。群组列表 `list({})` 保持团队列表语义。新 UI 显式传 ID；旧调用省略时固定访问默认会话，不跟随最近访问。
- v6 `0006_agent_crew_conversations` 在既有 migration 事务中建默认会话并重建复合键/FK；每群旧历史迁入 `conversationId=groupId`，消息/执行字段逐值保留，workspace 租约不变。冻结 SQL 纳入 checksumInput，v4/v5 checksum 不改。
- 队列 claim、调度、恢复及 runtime resume 候选均按会话分区；启动恢复枚举全部会话，部分失败不漏掉其余任务。默认会话保留 v5 vendor 原生 session key，通过未修改 CLI 的同 sessionId 续接校验；其他会话加入 conversationId，不能复用默认会话原生历史。
- 租约仍按 workspaceIdentity 全局互斥；成员替换、群组删除/重绑仍检查全群未决执行。不同对话争用同目录沿用 `workspaceBusy` 明确拒绝语义，不引入超时回收。
- UI 入口保持设置 → Agent 群组 → 群组管理 → 群组详情。新增会话列表/创建/选择，未命名会话以创建顺序编号并本地化。group+conversation 缓存、投影校验、请求作用域及组件 key 隔离草稿/审批/错误/晚到结果。
- 无新增依赖、归档、自动接力、工作目录副本或手机专属运行时。完整改动范围、迁移步骤与真机路径见 `CODEX-REPORT-CREW-CONVERSATIONS.md`。

### 本轮最终验证

| 命令/检查                                                                                            | 结果                                                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `node --import tsx --test packages/services/test/crew*.test.ts packages/client/test/crew*.test.ts`   | **105/105**：服务 97（原 74 + 新增 23），RPC/共享契约 8 |
| `TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*` | **57/57**（原 41 + 新增 16）                            |
| 侧栏/设置回归（下方命令）                                                                            | **81/81**（包含原 73 与额外 focus 回归）                |
| `node specs/agent-crew/e2e/test-fixture.mjs`                                                         | **1/1**，离线 fixture 服务，不是浏览器 E2E              |
| `pnpm typecheck`                                                                                     | 通过                                                    |
| `pnpm lint`                                                                                          | 通过：0 errors；72 条既有 warnings 未掩盖为零           |
| `pnpm architecture:check --changed`                                                                  | 通过：0 violations / baseline / new                     |
| fixture 打包、两个浏览器脚本语法检查                                                                 | 通过；实际点击 E2E 未执行                               |
| Crew 源文件行数、定向格式检查、`git diff --check`                                                    | 通过；本次 Crew 源文件 ≤400 行                          |

```sh
TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test \
  packages/ui/src/app-shell/WorkspaceSidebarPanel*.test.tsx \
  packages/ui/src/hooks/useWorkspaceSidebar.test.tsx \
  packages/ui/src/settings/SettingsPageLayout.test.tsx \
  packages/ui/src/settings/useSettingsSidebarRail.test.tsx \
  packages/ui/test/settingsSidebarNavigation.test.ts \
  packages/ui/test/workspaceSidebarNavigation.test.ts
```

新增覆盖包括：同群两会话消息/执行/context/resume 隔离、会话幂等键、默认兼容、迁移全字段保留与失败回滚、跨会话租约互斥、重启 queued 与 recovery_required 隔离、跨会话取消/审批拒绝、同一 Agent 最新定义共享、旧执行快照不变、迟到 UI 结果不串数据。

### 验证边界与工作记录

- 真实浏览器连接已尝试，但 `ego_cli bootstrap / NSWorkspace XPC` 被沙箱拒绝；没有提权或使用其他入口绕过。未执行真机 Desktop/Web/手机点击、真实 vendor CLI/付费模型 smoke，不把 SSR/hook harness/fixture 打包写成这些检查通过。
- freshness 默认 fetch 因 `.git/FETCH_HEAD` 只读失败；`--no-fetch` 基于已有远端缓存检查通过，不保证远端实时新鲜度。
- `apps/zcode-cli` 77 个原有未提交文件的 SHA-256 前后相同；没有 Git commit、merge/rebase 或分支切换。既有 `node.ts` 和 locale 大文件只做接线/文案增量，不将已有超长文件当成本次新增 Crew 文件。
- 类型：Feature / 兼容性修复；项目：ZCode；分支：feat/web-config；执行者：Codex。全局 worklog 位于沙箱外，工作记录保留在本仓库报告中。

## 2026-09-25：群组首页 / 工作群式界面

完整交付报告与真机路径：`CODEX-REPORT-CREW-HOME.md`。本轮未提交，不修改 `apps/zcode-cli`。

### 本轮落地

- 首页侧栏一级 `分组 | 项目 | 群组`；项目 identity 分组 → 群组 → 对话，未绑定独立归组。群菜单新建对话、复制待绑定群、编辑与确认删除；窄屏沿用原抽屉，打开对话后关闭抽屉。
- `workspaceMainView=crew`：会话标题、成员首字头像、发送者连续分组、结构化 @ 交接、长 Agent 回复折叠、系统执行折叠条、原 CrewComposer / 取消 / 权限 / 恢复。设置页仍保留管理入口。
- 同一 CrewService 实例共用 SWR scope；选中项只存 UI 导航，组级修改刷新相关会话，迟到结果不能劫持选择。可见 idle 投影 5s 刷新、active 2.5s；隐藏页面/抽屉停止对应读投影。
- `crew.readExecution` 校验 group/conversation/execution，读取执行时的 binding。ZCode 只借用同连接已有 V4 projection + 只读 timeline；不存在则明确不可用，不执行查询/订阅/冷恢复或 SessionStart 钩子。父级终态触发最终详情读取。
- 会话 failed 徽标从最新执行派生，未决恢复/运行优先；不新增数据库状态、不改变租约/admission。
- Web 开发 `--agent-source` 避免误用不含 crew/runtime 的陈旧 CLI bundle；保留显式命令覆盖与原 PATH。运行时版本/隔离异常有明确中文/英文说明。

### 最终验证

| 验证                                | 结果                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| `pnpm typecheck`                    | 通过                                                    |
| `pnpm lint`                         | 0 errors；72 条既有 warnings                            |
| `pnpm architecture:check --changed` | 0 violations / baseline / new                           |
| 服务 + client 契约 + Web 启动测试   | 116/116：services 105、client 8、server 3               |
| UI crew + 新首页导航 + 原侧栏/设置  | 199/199：crew 114、新导航 4、原侧栏/设置 81             |
| 离线 fixture 服务测试               | 1/1；首页 fixture 打包、脚本语法检查通过                |
| `git diff --check` / 新增文件行数   | 通过；新增源码/测试 ≤400 行，既有大型装配文件仅增量接线 |

### 尚未满足的验收与证据

1. **完整执行过程读取**：ZCode 仅能显示当前连接已有的 V4 窗口；现有历史查询会冷恢复并运行钩子，故未启用，缺失时明确不可用。**外部逐步执行事件**：当前 CLI bridge 只有 state/summary，没有事件 query；遵守不改 CLI，显示真实摘要和“详细过程不可用（接口未提供逐步事件）”，不伪造执行过程。
2. **Claude/Codex 在 Web 上显示可用**：除了已修的旧 bundle 选择，真实 facade probe 还因 `outer_isolation_missing` 拒绝全部 read/write。当前 CLI run 未传可信外层隔离；不能为变绿伪设安全标记。这一验收仍阻塞。
3. **真机 UI / 完整 Web 链路**：Ego bootstrap、localhost 连接以及 stdio 启动所需 Unix socket 均被沙箱拒绝；未声称浏览器点击、移动端触摸或 Web preflight 成功。真实二进制版本探测成功不等于完整可用。
4. Freshness fetch 无法写 `.git/FETCH_HEAD`。基于当前检出源码验证，未 merge/pull/rebase；全局 worklog 路径不在可写范围，记录保留于本报告。

## 侧栏会话打开：选中与详情可用性分离

- 实现前补充 `SESSION-OPEN.md`。已选中但无有效详情不再落入未选择空态；useCrew 对结构和群组/会话归属进行读边界校验，错误可明确提示并刷新。
- 待确认恢复执行的取消按钮与运行计时状态解耦，复用既有安全取消命令；恢复、V4 被动详情和外部摘要保持原有数据层。
- 新增 15 项回归，UI/导航/原侧栏设置 **214/214**，后端/契约/server **116/116**，typecheck/lint/architecture 通过；CLI 开工快照 1512 个文件哈希一致，无 commit。
- 浏览器及本机页面访问仍受沙箱阻断，原 localhost 现场的具体 RPC 触发原因和手机真机验收未闭环。完整证据、改动及自测路径见 `CODEX-REPORT-CREW-OPEN.md`；不将 Node/SSR 成功视为浏览器通过。

## 2026-09-26：PM 计划确认与受控自动接力

- v7在原群组/执行表增加模式、K、时长、暂停、root/hop、交接决策及取消意图；旧群manual、K=2、30分钟，前六个迁移checksum保持冻结。行读取拆为crewStoreRows，保持原公开readExecution入口。
- 用户初始点名成员的根执行输出交接即为计划，必须批准；成员回传规划者汇总不是新计划。当前目录没有PM角色字段，不扫描成员名字或systemPrompt猜测角色。标签一次只声明下一站，多个取最后一个，不建立并行分配列表。
- CrewRelay负责计划/交接决策，复用CrewStore.enqueue和现有claim/runtime、owner/lease及workspace identity。最终回复提案与finish同事务；批准/拒绝、重复审批、异步probe期间配置/暂停/恢复变更均有锁内复查。
- 群模式manual/semi/auto；K按根hop0之后的跳数计算，最大8。标准化目标指纹按群/会话/root/成员唯一，墙钟预算包括计划等待；活动任务到deadline走现有安全cancel，无法证明停止则隔离恢复。
- 取消意图先于runtime.cancel持久化，防止取消等待中finish产生下一跳。暂停阻止后继claim及enqueue；恢复开关仅继续已接受未建task的队列，绝不自动批准旧提案或重放已有task输入。
- native runtime只返回最后assistant正文，不拼接中途回复；外部runtime继续读取已验证终态summary。prompt注入成员白名单与最终标签约定，外部JSON协议放在summary字符串，不修改CLI。
- UI经useCrew发respondRelay及群设置命令；计划卡置顶、普通交接卡、A→B自动派工标识、固定熔断原因、暂停开关和zh/en同步。原权限请求保持人工审批。
- 真机路径：建群选择auto并绑定目录 → @项目管理提需求 → 看到计划且成员未执行 → 批准并开始 → 观察成员和回PM接力 → 测试暂停、拒绝和取消。实际执行的自动化结果与浏览器限制见接力报告。

独立复核增量：待审批提案增加持久化admissionRevision，暂停/恢复及恢复隔离处理使在途准入失效；批准/拒绝竞争返回明确冲突。v7增加根预算快照，群预算修改仅影响新根请求，活动timer与后继准入统一读取快照。

最终验证：服务端crew 186/186、UI crew 143/143；pnpm typecheck / pnpm lint / pnpm architecture:check --changed均通过（lint 73个工作区warning、0错误）。离线fixture 2/2、打包与脚本语法通过；浏览器连接受限未作真机通过声明。
