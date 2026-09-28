# P1 CLI/Core/Bootstrap 限定执行报告

日期：2026-09-24。分支：`feat/web-config`。未提交、未派生子代理；保留其他并行工作区改动。

## 实现

- `crew/runtime` 直接懒加载外部 facade，不创建 ZCode session、不选择/调用 ZCode 模型。严格校验共享 command/reply schema；workspaceIdentity 和 remoteSessionId 隔离连接与存储。
- facade 注册 Claude、Codex、OpenCode；按绑定派发，禁止降级。沙箱证明只接受受信 `RunZCodeProtocolAgentOptions.externalRuntime.outerSandboxReady`，缺省 false。probe 同时验证认证、runtime ID 和所需 capabilities，不相信缺能力的 available 标记。
- `crew_ext_*` taskId、Host 给定 sessionId/traceId 原样传递。重复 start 幂等；续跑只使用同 session/runtime/workspace 下最新且成功、settled、有 nativeSessionId 的旧 task。新任务不复用旧 attempt。
- permission 在读取 vendor 流时投影。只有 adapter 实现真实 `respondPermission` 且进程仍活跃才可响应；拒绝和 unsupported approve 取消执行，后者保留 `permission_reply_unsupported` 原因。vendor 已退出但权限仍未决时，保持可见，显式 cancel 清除。
- cancel 等待 task 级 supervision 收敛；启动 handle 尚未注册时，收到 task.started 后补发取消。取消/cleanup 失败保留 recovery_required 和 settled=false。恢复不派发其后的 queued，resume 不能跨过不确定的旧进程。
- 在授权的既有 SQLite repository 内，用 request_json 的严格 `_crewRuntime` 元数据同事务保存 summary/settled/队列暂停与 remote attachment 隔离信息；不新增 migration、不使用 sidecar。旧 request schema 剥离保留字段。scoped load/save 不执行或删除其他 workspace/attachment 的行，保留既有隔离 worktree 归属。
- 已停止失败后的用户重新派工可显式继续；未决 permission/recovery 则拒绝，避免无声积压，也不重放旧任务。

```text
Host 已获租约 → crew/runtime → scoped facade → coordinator → adapter.start
                                              ↑                 │
群板 read ← permission / final summary / settled ← 归一化事件与进程结束
cancel → signal → adapter.cancel → iterator/finally 完成 → settled=true
cleanup 无法证明 → recovery_required + settled=false → 阻塞后续队列
```

## 改动文件

CLI 路径以下均相对于 `apps/zcode-cli/packages/`：

- contracts: `src/interfaces/external-runtime.port.ts`、`external-runtime-queue.port.ts`。
- core: `src/runtime-task/external-runtime-service.ts`、`external-runtime-coordinator.ts`、`crew-runtime-events.ts`。
- bootstrap app: `src/app/external-runtime.ts`、`crew-runtime.ts`、`create-app.ts`、`types.ts`。
- bootstrap protocol: `src/zcode-protocol/crew-runtime.ts`、`server.ts`、`server-types.ts`、`src/zcode-protocol-entrypoint.ts`。
- 授权的最小存储增量：`adapters/src/storage/session-store/repositories/external-runtime-queue.ts`。
- core tests: `test/runtime-task/crew-runtime-fixture.ts`、`crew-runtime.test.ts`、`external-runtime-service.test.ts`、`external-runtime-coordinator.test.ts`。
- bootstrap tests: `test/app/crew-runtime.test.ts`、`crew-runtime-storage.test.ts`、`test/zcode-protocol/crew-runtime.test.ts`。
- 规范：`specs/agent-crew/P1.md` 和本报告；IMPLEMENTATION 链接此报告。

所有本切片新增源文件均小于 400 行；旧超限入口仅做接入点增量，没有重构。

## 验证

| 检查 | 结果 |
| --- | --- |
| CLI core/runtime-task + bootstrap/app + crew protocol + 既有 queue repository tests | **62/62** 通过 |
| `node --import tsx --test packages/services/test/crew*.test.ts` | **55/55** 通过，包含并行 lane 新增用例；P0 不回退 |
| contracts/core/adapters TypeScript 编译、bootstrap `tsc --noEmit` | 通过 |
| 根 `pnpm typecheck` | 通过 |
| 根 `pnpm lint` | 通过，72 warning / 0 error |
| `pnpm architecture:check --changed` | 通过，0 violation / 0 baseline / 0 new |
| 本切片 runtime/contracts/storage 源文件定向 CLI lint | 通过，exit 0 |
| core/bootstrap 包级全量 `pnpm lint` | **未通过**：原有 `agent-runtime`、`turn-tools`、`create-app`、`v4-gateway` 等超 400 行；不越界重构，也不报为通过 |
| workspace freshness | 已尝试，沙箱禁止 `.git/FETCH_HEAD` 写入，未完成远端检查；无 merge/rebase/pull |

测试覆盖 live/settled 权限、supported approve、unsupported approve/deny、过期请求、启动取消窗口、cleanup 失败、结构化 success/failed/cancelled、畸形/跨 attempt 事件、未知能力拒绝、结果重启、scope 隔离、同毫秒事务回滚、成功 resume 与上下文拒绝、恢复不重放。

## CLI 能力探测与边界

此限定切片没有执行真实 vendor `--help` 或联网 smoke。CLI 能力探测与 fake vendor binary 归一化证据由 adapter lane 提供；本切片只注册这些 adapter 并测试 facade/core 契约，不把端口 fixture 当作真机验收。

- 未证明 outer sandbox 时全部外部绑定 fail-closed；部署需要提供真实隔离证明，不能由 RPC 或 workspace 配置自称可信。
- dirty workspace 仍拒绝写入；没有可信独立验证命令的写任务仍进入 needs_verification，不跳过验收来伪造成功。
- 本次没有真实权限回复通道，因此生产 adapter 不应声明 canRespond=true；测试中的 supported approve 使用显式 fake adapter。
- recovery_required 没有新增“强制解锁”接口；无法证明旧进程停止时保持隔离，这是安全边界。
- adapter.start 契约要求正常退出及 protocol/policy 错误前确认 cleanup；无法确认时必须抛 `recovery_required:`。Claude/vendor cleanup 的具体补丁由 adapter owner 集成并验证。
- 未执行 GUI/Electron/mobile E2E。没有 P2 自动交接、接力或并发 worktree 实现。
- 全局 worklog 目录不在可写范围，本报告保留完整本地交接记录。

## 集成复核补丁：跨 Host 只读 facade（2026-09-24）

已实测确认旧构造路径在第二 Host probe 时调用 recover，改写首个 Host 的 running 记录或 pump 旧 queued；观察实例还会缓存过期队列。新增回归修复前为 4 失败 / 1 通过，修复后 **5/5 通过**。

- bootstrap `external-runtime.ts` 新增 `recoverOnCreate`，默认保留 legacy 行为；protocol 入口固定传 false。
- 观察实例的构造、probe/read、cancel/permission 及 shutdown 不恢复/保存/取消/派发别人的 queue。read 直接读取新 scoped snapshot，无法证明本实例监督的未完成记录仅做只读 recovery_required/settled=false 投影，不回写。
- `crew-runtime.ts` 在 Host 已持租约的显式 start 才初始化或刷新恢复；后续交接按下面 A→B→A 补丁刷新空闲快照。service/coordinator 增加 `replayQueued` 恢复选项；protocol 首次激活传 false，旧 queued 保持隔离，不能使用新任务租约重放。
- 测试在 `bootstrap/test/app/crew-runtime-observer.test.ts`：双实例 live 状态不变、queued 不派发、只读关闭不写入、观察到 owner 新完成结果、显式激活不重放、legacy 创建恢复保持兼容。
- 此补丁只修改两处 core runtime-task 文件、两处 bootstrap app 文件及 protocol 入口，新增上述测试；未改 shared schema、Host、adapter 或 storage。保留集成方已改好的共享 `crewRuntimeParamsSchema` 接口。

补丁后完整 CLI/Core/Bootstrap/queue 定向回归 **67/67**；core 编译、bootstrap typecheck、根 typecheck/lint/architecture 均通过。根 lint 仍为 72 warnings / 0 errors；本次目标文件定向 lint 与 git diff --check 通过。未进行真实网络或 UI smoke。


## 同 scope 交接补丁：A→B→A

已用回归复现 taskB 被 A 的旧内存快照删除：修复前实际 durable task IDs 为 `[taskA, taskC]`。采用最小 helper 扩展，不修改 SQLite store 的替换策略：

- coordinator 新增 `refreshFromStoreIfIdle()`：在现有 mutation 串行边界内读取最新 scoped store；active/pump/未决 permission 存在时跳过，读取前后都检查。helper 本身不保存、不派发。
- service 仅转发该 helper；bootstrap `prepareCrewStart` 在每个显式 owned start 前尝试刷新，成功后执行 `replayQueued=false` 恢复。普通 probe/read 没有进入此路径，legacy 原有 facade 创建行为保留。
- A 完成 taskA → B 完成 taskB → A 完成 taskC 后，三个 summary 和 settled 结果都保留，并可由重开后的只读 facade 读取。
- 新增四个回归覆盖 A→B→A、活跃任务重复 start 不刷新/重放、刷新发现外来 queued 时隔离、不丢本地已 settled 的未决权限。修复前新增用例 2 失败 / 2 通过，修复后 observer/handoff **9/9**。

本补丁源文件只有 `core/src/runtime-task/external-runtime-coordinator.ts`、`external-runtime-service.ts`、`bootstrap/src/app/external-runtime.ts`；测试更新 `bootstrap/test/app/crew-runtime-observer.test.ts`。源文件分别 360/335/325 行（包含后续只读 resume 校验修复），没有新增依赖或存储写入路径。

完整限定回归 **71/71**；core 编译、bootstrap typecheck、根 typecheck/lint/architecture 与定向 lint、diff 检查均通过。根 lint 72 warnings / 0 errors。未提交，未运行真实网络 smoke；旧 CLI 包级全量 lint 既有超长文件限制仍按前文保留。


### 同 scope 交接补充：start 前读取 resume 候选

Host 在 prepareStart 之前 read(taskB) 校验 resume。新增该断言后复现 activated-but-idle A 返回 Unknown task，现已修复：

- facade 对本实例正在监督的 active attempt 和已在本地准入的 queued 返回实时投影；其余读取从 scoped durable store 获取最新记录，不刷新/保存 coordinator。
- 已退出但本地仍待用户处理的权限仅在 durable attempt/state/更新时间一致时补充展示，并强制 canRespond=false，不用旧状态覆盖持久化结果。
- A→B→A 回归现实际执行：B 完成后 A read(taskB) → 验证 succeeded/settled/summary/nativeSessionId → 比较数据库未改变 → A start(taskC,resumeTaskId=taskB) → 验证 native resume 参数及三个 durable 结果。另有真实 facade 的 active permission read 测试，确保不会被纯持久化视图吞掉。

最终 observer/handoff **10/10**，完整限定回归 **72/72**；core 编译、bootstrap 类型检查、根 typecheck/lint/architecture、定向 lint 与 diff 检查通过。根 lint 保留 72 warnings / 0 errors。变更仍局限于前述 core/service、bootstrap facade/helper 和对应测试，不修改 Host/shared/storage，不提交。
