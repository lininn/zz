# 外部 Runtime 直接接入 Spec

## 目标

在 ZCode CLI 内核中直接接入外部 Agent Runtime（例如 Claude Code CLI、Codex CLI），做法参考 `claude-code-haha` 的 multi-runtime dispatch，但不复制其 Bun/单包实现。

核心不是新增一个 CLI 命令，而是建立：

- vendor-neutral runtime contract；
- capability preflight；
- 受控进程宿主；
- durable 调度队列；
- 独立验证与证据；
- 恢复与交接语义。

## 非目标

- 不把外部 Runtime 做成插件自有进程；插件只做命令/Skill/只读查询包装。
- 第一阶段不做自动选择 runtime。
- 第一阶段不做并行写任务；写任务默认串行。
- 外部 worker 不得再派发新的 runtime worker。
- 不自动 commit、merge、push。

## 产品规则

1. ZCode 是唯一 leader，拥有任务排序、取消、暂停、恢复、工作区策略和结果消费。
2. 外部 runtime 是有界 worker，只能执行分配的任务并返回归一化事件、权限请求、证据和结构化结果。
3. 请求必须显式声明：
   - `runtimeId`
   - `role`
   - `accessMode`: `read` / `write`
   - `networkProfile`
   - 目标与不可覆盖边界
   - workspace 与 baseline
   - timeout、预算、验证、retention
   - `sessionMode`: `one-shot` / `chat`
   - `executionMode`: `sequential` / `parallel`
   - failover 策略；写任务 failover 固定为 `none`
4. `reviewer`、`researcher`、`explore` 只能只读。
5. 写任务成功必须同时满足：
   - 有效结构化结果；
   - 实际工作区变更；
   - 独立验证全部通过；
   - 无待处理权限或冲突。
6. 写任务无变更时进入 `needs_verification`，不得自动视为成功。
7. 缺少可信验证命令时进入 `needs_verification` 并暂停队列。
8. 失败、权限等待、验证失败、冲突、取消都会暂停队列或进入可恢复状态，不能静默继续。

## 状态所有者

- 输入准入：现有 `CommandInbox` / 命令层。
- 外部 Runtime 任务事实：新增 durable coordinator（SQLite/journal 持久化）。
- 内存投影：现有 `RuntimeTaskRegistry` 只做投影，不做 durable queue。
- 进程执行：复用 `ExecutionPort` 的 argv 路径，新增外部 runtime supervisor 语义。
- 证据存储：复用现有 journal/artifact 存储，不另建第二套 session 事实。
- 身份：继续使用 `workspaceIdentity?.trim() || workspacePath`，不引入第二套 project/checkout 身份。
- UI：只消费事件和发送控制请求，不拥有任务事实。

## 接口

新增 `ExternalRuntimePort`（contracts）：

```text
probe(request) -> RuntimeCapabilityReport
start(request) -> AsyncIterable<RuntimeEventEnvelope>
interrupt(handle)
cancel(handle)
sendMessage(session, message)  // P1 chat
recover(record)                // P1 recovery
```

归一化事件至少包含：

```text
task.started
task.state_changed
assistant.delta
assistant.message
tool.started
tool.progress
tool.completed
permission.requested
permission.resolved
workspace.changed
verification.recorded
warning
error
task.completed
```

未知 vendor 事件必须保留 raw 引用并映射为 `warning`，不得导致解析器崩溃。

## 失败语义

- 缺 binary、版本不支持、认证失败、缺结构化输出、缺权限能力、外层隔离缺失、leaf policy 不完整 → preflight 不通过。
- 写任务自动 failover 被拒绝。
- 递归启动 `zcode`、`claude`、`codex` 等 runtime 入口 → `policy_violation` 并终止进程组。
- 进程重启后只能重连可证明归属且仍存活的 handle；否则进入 `recovery_required`。
- 写任务不自动重放、不自动 failover。

## 安全边界

1. 外部进程环境使用 allowlist，不继承完整宿主环境，不继承敏感凭据。
2. 启动一律使用结构化 argv，不允许 shell 字符串拼接。
3. 外层 sandbox 未验证通过前，不得启用 vendor 内层 bypass。
4. vendor 危险参数只能用于显式受信 profile，不能作为默认配置。
5. 所有持久化与导出路径执行 secret redaction，复用现有脱敏策略。

## 验收场景

1. contract round-trip、未知字段、非法 terminal result、状态映射测试通过。
2. preflight 覆盖 missing binary、版本、认证、能力缺失、leaf policy。
3. fake vendor binary 覆盖 success、malformed、permission、recursive、cancel、restart、dirty conflict。
4. 写任务无 diff 或验证失败时不得推进队列。
5. secret 不进入 env、event、artifact、verification log。
6. `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过。

## 落地状态（2026-09-24）

已实现（fixture 测试覆盖，共 35 项）：

- `ExternalRuntimePort` contract 与状态映射。
- preflight registry 与 fail-closed 探针。
- 进程宿主：argv 启动、env allowlist、递归调用拦截、supervisor。
- `ExternalRuntimeCoordinator`：串行队列、成功门禁、pause/resume（store 可插拔，测试用内存实现）。
- `ClaudeCliAdapter`：stream-json 事件归一化、结构化终态校验、leaf policy、cancel 路由。
- `ExternalRuntimeDispatchService`：preflight → dirty 门禁 → 事件收集/校验 → 权限暂停 → 验证 → 成功门禁。
- `runExternalRuntimeVerification`：argv 独立验证、日志脱敏截断。

尚未实现：

- 混合读写并行的 dispatch-time 不可变快照（当前规则：并行写必须 `--worktree`，只读可直接并行；parallel read 在 facade 层自动创建快照 worktree）。

已实现（fixture 测试覆盖，共 82 项）：

- 上述全部，另加：
- 持久 chat：`--chat <taskId>` 从最近一次带 native session 的 attempt 恢复（`--resume` 已用真机验证 flag 形态）；无可恢复会话时派发直接拒绝。
- `nativeSessionId` 贯穿终态事件 → 调度结果 → 队列记录 → SQLite（migration 0024），重启后仍可恢复会话。
- worktree 集成面：`diff`（baseCommit 对照 + untracked 清单，有界截断）、`cleanup`（仅终态任务，未注册路径拒绝删除）。
- `/delegate cleanup|diff` 子命令与 facade 方法。
- bootstrap facade 测试：真实装配路径（migrated fixture DB），覆盖派发拒绝、chat 缺会话、cancel/cleanup 未知任务、sandbox 未验证 fail-closed。

已实现（fixture 测试覆盖，共 73 项）：

- 上述全部，另加：
- 并行 pump：parallel 波次并发（默认上限 3）、sequential 做 barrier、重启 `recover()` 将中断任务置 `recovery_required` 且不重放、queued 任务恢复推进。
- 并行写派发规则：非隔离工作区直接拒绝（`--worktree` 创建隔离 worktree 后放行）。
- worktree 隔离模块：创建/列举/删除，拒绝非法 taskId 与未注册路径，symlink 父目录用 canonical 比对。
- bootstrap 真实装配（显式 opt-in，默认关闭）：session DB 直连 SQLite store、真进程宿主、系统 preflight runner、Git guard、用户 `--verify` 命令直通验证、启动 recover；装配失败只降级为能力缺席，不破坏启动。
- `ZCodeApp` 三个可选 facade 方法 + CLI `/delegate`、`/claude`、`/codex` 注册与 handler。
- `RuntimeTaskType` 新增 `external_runtime`，service 经 `onUpdate` 向 registry 投影（type/agent/status/completedAt/error），停止仍走专属 cancel 通道。

已实现（fixture 测试覆盖，共 62 项）：

- 上述全部，另加：
- Git workspace baseline：HEAD/branch/status/preimage/committed-hash 捕获，worker 新增判 changed、替换 baseline 脏内容/删除 untracked/移动 HEAD 判 conflict；service 经 `beginWorkspaceGuard` 透出 `apply_conflict`。
- `/delegate`、`/claude`、`/codex` 解析注册与 handler（dispatch/list/cancel，app 能力缺席时回不可用，无静默降级）。
- `CommandCenterApp` 新增三个可选 facade 方法（dispatch/list/cancel），缺席即不可用。
- 真机任务 smoke（claude 2.1.241，只读 reviewer，临时空目录）：`task.started → warning* → task.state_changed → tool.started → tool.completed → task.completed`，终态 `smoke ok / succeeded`，sequence 校验通过。

已验证（2026-09-24，真机只读探针）：

- `claude --version` → 2.1.241；`codex --version` → 0.156.1；两者认证状态均为通过（仅读 exit code，未记录账号信息）。
- claude 具备 `--output-format`、`--json-schema`、`--permission-mode`、`--disallowedTools`、`--disable-slash-commands`、`--strict-mcp-config`、`--max-budget-usd`；**没有 `--max-turns`**，adapter 白名单已移除该 flag。
- codex 具备 `--json`、`--output-schema`、`--sandbox`、`--dangerously-bypass-approvals-and-sandbox`。
- 未执行任何真实任务调用（避免消耗配额与副作用）。

已实现（fixture 测试覆盖，共 49 项）：

- 上述全部，另加：
- migration `0023_external_runtime_queue` 与 `SqliteExternalRuntimeQueueStore`（事务写、损坏 payload 按任务 fail-closed、版本拒绝）。
- `/delegate` 参数解析器：role/access 默认与收紧规则、alias 固定 runtime、未知 flag 与未启用能力一律拒绝。
