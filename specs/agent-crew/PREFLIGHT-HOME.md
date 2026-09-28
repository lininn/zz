# Web 群组首页 Preflight：启动版本与真实能力

日期：2026-09-25。范围：services 外部 runtime probe、HTTP Web 开发启动；不改 CLI、共享协议或 UI。

## 已确认原因与证据边界

- 3030 server 的启动日志指向仓库 `apps/zcode-cli/packages/cli/dist/zcode.cjs`，而非当前源码。该 bundle 的时间为 2026-09-24 11:49:38（Asia/Shanghai），没有 `crew/runtime` / `createCrewRuntimeFacade`；现有默认 resolver 优先 dist。
- 运行中的 server bundle 同样没有 `crew/runtime`。不能仅修 PATH，或以宿主已安装 vendor binary 替代 Agent 实际 probe。
- `probeMember` 将缺失 bridge / 协议异常全部折叠为 `crew.runtimeUnavailable`，隐藏了部署版本不匹配。
- 沙箱看得到 3030 / 5173 listener，但无法连接；无实时 RPC 错误证据。以上是启动日志、bundle 与源码的交叉证据，不宣称端到端已通过。

## 产品规则与所有者

- 只有显式 HTTP 开发启动参数 `--agent-source` 使用当前 CLI 源码；默认生产、桌面、远程部署选择不变。开发脚本负责携带该参数。
- 沿用 `createLocalServices.zcodeAgentCommandResolver` 注入，不新增协议、不修改默认全平台 resolver。显式 `ZCODE_AGENT_SERVER_COMMAND` 覆盖优先，交回既有 resolver（保留参数/cwd 覆盖）。
- 使用当前 Node + 已安装 tsx loader 启动源码，绝对路径定位，不依赖 shell/新依赖；保持工作区 cwd。缺源码/loader 时失败，不静默回退旧 bundle。
- 不重写 PATH、HOME 或 vendor 配置，不读取凭据；版本选择由启动层拥有，实际可用性仍完全由 Agent runtime 的 probe 返回。
- 缺失 bridge 或协议方法不存在使用固定、无敏感信息的诊断原因；其他未知异常仍安全归一。不得将任意异常正文/堆栈回传 UI。版本/认证/隔离失败仍按 runtime 原报告 fail-closed。

## 时序与不变量

```text
Web dev --agent-source → HTTP bootstrap → 既有 command resolver 注入
  → Node + tsx + 当前 CLI source（或显式部署覆盖）→ 原 workspace-scoped Agent
Web crew.get → CrewService → 本地 binding 校验 → Agent crew/runtime probe
  → 原 facade / adapter / binary version/capability probe → 原报告 → UI 只读投影
```

不新增 Agent owner、任务队列、lease 或缓存；不改变 start/read/cancel、desktop continuous 或 mobile replayable 语义。启动命令更换仅影响下一次正常启动，不自动杀死现有 runtime，不重放任务。

## 验收

1. 回归：旧 dist 与源码并存时，Web 开发 resolver 选择源码；显式部署覆盖不被替换；缺源码 fail-closed；workspace identity/cwd 保留。
2. 回归：缺 bridge、`-32601`、未知异常、真实 negative probe、positive probe；所有 probe 不触发 start，不申请执行 lease。
3. 实际允许的本地 `claude --version` / `codex --version` 仅证明相应 binary 可执行，不证明 Web RPC/认证/隔离通过。
4. 执行 targeted tests、typecheck、lint、architecture changed；记录未验证的真实 Web 路径，由主线程浏览器验收。

## 本轮验证记录

- 实际本机 `~/.local/bin/claude --version`：退出 0，`2.1.241 (Claude Code)`。
- 实际本机 `~/.local/bin/codex --version`：退出 0，`codex-cli 0.156.1`；附带无法在沙箱创建 PATH alias 的警告，不据此修改 PATH。
- 新 resolver 生成 `node --import <absolute tsx loader URL> <CLI source> --version`：隔离临时 HOME/XDG 目录，仅继承 PATH，退出 0、输出源码默认版本 `0.0.0`。未启动 app-server 或执行 runtime 任务。
- `node --import tsx --test packages/services/test/crew*.test.ts packages/server/test/developmentAgentCommand.test.ts`：108/108 通过（含原有 102 项服务回归、新增 3 项服务 / 3 项启动测试）。
- `pnpm typecheck`：退出 0。`pnpm lint`：退出 0，72 warnings、0 errors。`pnpm architecture:check --changed`：violations / baseline / new 均 0。
- 基线 freshness 脚本受沙箱限制：`git fetch origin --prune` 无法写 `.git/FETCH_HEAD`。未进行 merge / pull / rebase。
- 未重启或终止现有 3030 server；其已运行内存仍是旧代码。新启动选择在下一次正常 `pnpm dev:web` / server dev 启动时生效。
- **未验证**：真实 Web RPC、当前源码 facade 初始化、vendor 完整认证/隔离能力。二进制版本和源码版本命令成功不等同于这些能力通过。缺 bridge 的直接端口测试与 `-32601` 的服务链测试分开；若上游包装器仅抛未知 TypeError，仍保留安全的通用不可用原因。

## 主线程追加真实 probe（2026-09-25）

- `verify-local-preflight.mjs` 用隔离 HOME/临时工作区启动真实源码 stdio，仅发四次 probe。进程在协议启动前被沙箱拒绝 Unix socket `listen EPERM`，没有收到 RPC 响应；不是 Web 验收通过。
- 为区分 socket 限制与 runtime 能力，`verify-runtime-adapters.mts` 直接调用真实 `createExternalRuntimeFacade` 的同一 `crewRuntime(probe)`。未声明外层隔离（与 CLI `run.ts` 当前传入选项一致），Claude/Codex 的 read/write **全部明确返回 `outer_isolation_missing`**；未启动任务、未发送模型请求。
- 当前 `run.ts` 调用 `runZCodeProtocolAgent` 未传 `externalRuntime.outerSandboxReady`，bootstrap 以 `=== true` 验证；core 在 vendor binary probe 前拒绝。这是旧 bundle 之外的第二个阻断，不是 PATH 问题。
- 本任务禁止修改 CLI，且没有部署方提供的可信外层隔离证明。因此不得把该标记伪设为 true，也不能承诺源码启动后成员必然可用。首页/设置会显示本地化的真实隔离原因。达到“前端 Codex / 设计 Claude 可用”的验收仍受此边界阻塞。

## 只读详情安全复核

复核确认普通 V4 subscribe 与 rows/range 都可能冷恢复 session；即使 Host 选择 existing-only，CLI 的 `ensureColdReadyPublisher` 仍会追加 resume 事件并运行 `SessionStart` 钩子。不能把“没有新进程”误当作“无执行副作用”。最终详情不调用这两类接口，只 peek 同 service/endpoint/task 的已存在 V4 projection 并订阅其本地变更；不存在、失效或历史窗口未加载时明确不可用，绝不补发查询或恢复。为此撤回了本轮临时添加的 rows/range runtimePolicy 接口，不改 CLI。
