# 调查报告：crew 派工「创建即恢复态」死循环（多 agent 调查结论）

日期：2026-09-26。调查方式：两个并行只读调查 agent + 线上日志/数据库证据。

## 现象

用户 @项目管理 派工，执行创建后 0.14~0.7 秒内即变为 `recovery_required`；点「检查恢复」确认（crew.recovered）后重新派工，又立即进入恢复态，无限循环。

## 证据链（已闭环）

1. `session/create` 成功（sessionId=`agent_crew_<executionId>`，前缀放行修复生效），live 会话在 agent 内存中存活（`liveSessionAtStart: true`）。
2. sendPrompt 前 v4 网关 hydrate 报 `Session not found: agent_crew_...`（`~/.zcode/cli/log/zcode-2026-09-26.jsonl`，scope `v4.hydrate`，phase `loadPersistedEvents`）。gateway 将 hydrate 异常降级为空历史继续，**但 agent 端 sendPrompt 仍查不到该会话** → 抛错。
3. `crewRuntime.ts:157-159` 将该错误（非 workspaceBusy）一律包装为 `crew.recoveryRequired`，且 **catch 无日志**（与线上无错误日志吻合）。
4. **决定性证据**（agent 端 `~/.zcode/cli/db/db.sqlite`）：session 表中 `agent_crew_` 行数为 0，最近一条会话落库停在 **9/25**——9/26 起所有 `createSession`（含 `persistence: 'immediate'`）**均未落库**。普通会话 hydrate 同样报 not found（12:54 `sess_69db8de7...`），**非 crew 独有**。
5. 排除项：lease 残留不是触发器（`agent_crew_workspace_leases` 仅 1 行且是本次派工新 acquire 的，owner 进程存活；workspaceBusy 会走安全失败 `failed` 而非 recovery_required——crewService.ts:381-386 白名单）。迁移状态正常（0024 已应用）。

## 根因结论

**agent 端会话持久化写路径失效**：`createSession` 返回成功但未写入 `db.sqlite`，随后 hydrate/sendPrompt 查库必失败。失效起点与 9/26 重建的 `zcode.cjs`（包含工作区未提交的 session-store 迁移 0023/0024 external_runtime native session）时间吻合——疑似持久化路由/写路径与迁移 0023/0024 的交互问题。

## 次要缺陷（一并修）

- `crewRuntime.ts:157-161`：sendText 的非 workspaceBusy 异常一律包装 recovery_required 且无日志——ACK 前的确定性失败应安全失败（failed）或至少补结构化日志。
- `crewService.ts:386` 兜底分支同样无日志。

## 修复任务

1. **主修**：agent 端 session 持久化写路径（0023/0024 迁移交互）——createSession immediate 持久化必须真正落库；定位写失败被吞的点。
2. **防御**：crewRuntime.ts:157-161 补结构化日志（原始错误、sessionId、phase）；hydrate not found 且 liveSessionAtStart=true（新建会话本无历史）时不应使 sendText 失败。
3. 回归：crew 186/186 基线 + 新增「派工后 session 必须落库」断言。

## 补充（2026-09-26 22:35）：FOREIGN KEY 根因实锤

- 运行时日志：`crew.runtime.ack_failed` — sendPrompt ACK `status=failed`，
  `reasonCode=fault.command.executionFailed`，`message="FOREIGN KEY constraint failed"`。
- 数据库证据：agent 端 `~/.zcode/cli/db/db.sqlite` session 表 `agent_crew_` 行数为 0。
- 机制：crew 派工经 `zcodeAgentService.createSession`（protocol createSession，
  persistence=immediate）→ agent 进程内 deferred/immediate 会话的 **session 行从未 INSERT**；
  sendPrompt 持久化消息/输入时外键 `session_id references session(id)` 失败 → ACK failed →
  crewRuntime 包装为 recovery_required。
- 对照：普通桌面会话的 session 行由 server 进程侧 zcodeSessionService 按正确顺序写入，
  因此不受影响；crew 直连 agent 进程的路径缺 session 行 INSERT。

## 修复任务（派 codex）

agent 端 sendPrompt 的 deferred→immediate 提升点（server-operations.ts ~1955
`record.persistence = "immediate"`）必须在该次消息/输入写入**之前**先把 session 行
INSERT 进 session 表（sessionStore.createSession，字段从 record.app 映射，与
repositories/sessions.ts createSession 的 insert 列一致）。加回归测试：
createSession(deferred→immediate 提升) 后 session 表有行且 sendPrompt 不再 FK 失败。

## 最终定案（2026-09-27 00:1x）：turn 在持久化阶段之前提前终止

决定性证据（agent 日志计数）：
- `turn.phase.started phase=session_persistence`：9/25 = 10 次，**9/26 = 0 次，9/27 = 0 次**
- `session.persistence.started/completed`：三天全部 = 0

结论：9/25 的 turn 能走到「会话持久化」阶段（session 行落库 ✓）；**9/26 起（zcode.cjs 09:50 重建后）所有 turn 在到达该阶段之前就终止**——终止点即 v4 hydrate 的 `Session not found`（deferred 会话无持久化历史，hydrate 失败后 turn 没有继续走到 session_persistence 阶段）。crew 派工的会话是 deferred（首条消息前不落库），因此**每次派工 100% 触发**。

修复点：sendText 的 turn 流程中，hydrate 阶段的「新会话无持久化历史」必须视为正常态并继续推进到 session_persistence 阶段（ensureSessionPersisted 落库 session 行），而不是提前终止。定位入口：agent 日志 9/26 最后一条 turn 的 phase 序列（对比 9/25 的 phase 序列找终止点）。

## 插桩结论（2026-09-27 00:5x）

- `ensureSessionPersisted` 的 entry_check 插桩日志 **0 条**——该函数从未被调用。
- 失败点在它**之前**：V4 sendText 的 hydrate（`Session not found`，gateway 降级空历史）之后，
  ACK 仍 failed（FK），**turn 未推进到 admission/persistence 阶段即终止**。
- 插桩已就位待下轮定位：`crew.runtime.send_failed/ack_failed`（crewRuntime）、
  `session.persistence.entry_check`（events.ts）、`crew.admission.when_quiescent_terminal`（admission）。
- 需要新增插桩：agent 端 V4 sendText 处理器入口（admitInputCommand 前）、hydrate 降级后的 ACK failed 点。

## 插桩第二轮（2026-09-27 08:2x）

- createSession handler 的落库代码已执行（`store_missing` 日志 0 条 = sessionStore 存在），
  INSERT（on conflict upsert）无异常——**但 db.sqlite 的 session 表 crew 行仍为 0**。
- 同时确定性分类已生效：执行状态变为 `failed`（不再 recovery_required 死循环），用户可重试。
- 剩余问题收敛到：agent 进程 createSession 持久化 INSERT 的**可见性/事务**问题
  （WAL 未 checkpoint、事务回滚、或多连接实例分裂）。需要 sqlite 持久化子系统专项调试。
- 结论：本会话到此为止，证据链完整；修复该可见性问题后 crew 派工即通。

## 最终根因（2026-09-27 上午）：zcode.cjs bundle 从未包含修复代码

**"INSERT 执行但不可见"是误判——插桩代码本身就没进构建产物。**

排除过程（本会话 sqlite 专项调试）：
1. WAL 0 字节 + db.sqlite mtime 停在 9/25 20:46 → 9/26 起**无任何进程对该文件写入**（不是可见性/事务问题）。
2. `databaseId = sha256(dbPath)` 日志反推：agent 进程打开的就是 `~/.zcode/cli/db/db.sqlite`（hash 吻合）——不是路径分裂。
3. lsof 证实 agent 进程 fd 指向同一个文件——不是多连接分裂。
4. `session_create.started` 日志 `persistence:"immediate"` 正确传入、logger 正常工作、`store_missing` 0 条。
5. 本地稳定复现：spawn `zcode.cjs agent-server` + NDJSON `session/create(immediate)` → 成功返回但行 MISSING、文件零写。

决定性检查：`grep session.create.store_missing zcode.cjs` = **0**（源码里有、bundle 里没有）。
`session.persistence.entry_check`、`crew.runtime.ack_failed` 同样为 0；而 9/26 09:50 之前的
`agent_crew_` 放行逻辑 = 6 处存在。

**因果链**：
- `zcode.cjs` 由 esbuild 从各 workspace 包的 **dist**（`main: ./dist/index.js`）打包。
- `apps/zcode-cli/packages/bootstrap/dist` 停在 **9/26 09:50**（adapters/core/contracts 更旧，9/23）。
- 9/26 09:50 之后的所有源码修复（createSession INSERT、sendText 提升点 INSERT、插桩、failed 收口）
  只改了 src，从未跑各包 `tsc` build → dist 未更新。
- 昨天多次"zcode.cjs 重建"（07:58、08:18 等）只重打了 bundle，打包的还是旧 dist。
- 于是 agent 进程跑旧代码：createSession/sendText 均无 INSERT → 消息外键 FK 失败 → crew 派工 failed。
- 插桩日志全为 0 的真因：插桩代码不在 bundle 里，"0 条 = sessionStore 存在" 的推论不成立。

**修复**：`pnpm --dir apps/zcode-cli build`（turbo run build，按依赖拓扑重建全部包 dist + bundle），
而非只跑 `@zcode/cli` 的 build。验证：bundle 含 `session.create.store_missing`；probe 复现脚本
（/tmp/zcode-persist-probe.mjs）session/create 后行落库；crew 测试基线 186/186。
