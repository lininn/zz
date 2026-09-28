# P1 外部 CLI adapter — 规格与实现记录

日期：2026-09-24。范围仅限 adapters/exec 新增 Codex/OpenCode adapter、事件转换、fixture 测试及公共导出。

## 行为契约（实现前）

- 沿用 `ExternalRuntimePort.probe/start/interrupt/cancel`，runtime id 为 `codex-cli` / `opencode-cli`；不扩展端口，不虚构 sendMessage/权限回复方法。
- bootstrap 可用与 Claude 相同形状的 options 注册（processHost、outerSandboxReady、binaryPath、defaultModel、outputSchema、configuredArgs、版本策略、preflightRunner、now/eventId）。
- 调度器持有 admission、租约、持久任务/原生会话；adapter 只持有本进程当前 attempt 的句柄和解析状态。重启不会自动复活/重放任务；显式 `resumeNativeSessionId` 才生成 vendor resume 参数。旧 attempt 不能取消新 attempt。
- `stdout` 按 JSONL 分帧，`stderr` 独立转 warning；畸形/未知 vendor 事件 warning，不混入最终结果。只有结构化输出、vendor 终态和成功退出均成立才成功；中断/取消不误报协议成功。
- permission 事件可归一化并展示；没有实测权限回复能力时 `permissionReplies=false`，不会写入 stdin 假回复、添加自动批准/绕过沙箱标志。待审批不能凭 vendor 的后续成功文本转成功。
- probe 使用既有 preflight + 实测 CLI flags；未知 required capability 明确 unavailable，无文本 fallback、无 ZCode fallback。未证明 leaf/结构化终态能力的 OpenCode 绑定不可准入。原始认证输出不写日志/报告。
- 可直接用 fake process host 测试协议转换；这些测试不是对生产 capability 的证明。生产必须经已有 dispatch preflight admission。

```text
crew/dispatch（唯一 admission/持久 owner）
  -> adapter.probe -> 不可用及原因 / 已准入
  -> adapter.start(taskId, attemptId, resumeNativeSessionId?)
  -> 已有 ProcessHost（进程/限额/终止 owner）
  -> stdout JSONL -> vendor 事件转换 -> 同 attempt 单调 envelope
  -> permission.requested -> crew 审批投影（无回复能力不得伪批准）
  -> 已确认进程退出 + 结构化终态 -> dispatch 持久化结果
重启：dispatch 决定 recovery_required；adapter 无存储、无后台重放。
```

## 本机只读探测证据

- `codex --version` → `codex-cli 0.156.1`。
- `codex exec --help` → `--json`（stdout JSONL）、`--output-schema <FILE>`、stdin `-`、`--sandbox`、`--disable`、`--ignore-user-config`；`exec resume --help` →显式 SESSION_ID、stdin `-`、`--json`、`--output-schema`。未调用模型。
- `codex login status` → exit 0，已有认证；不记录包含凭据提示的原始输出。`codex features list` 可读（feature 状态只作为 leaf 能力证据）。
- `opencode --version` → `1.18.30`；`opencode run --help` → `--format json`、`--session`、`--pure`、`--model`；没有 JSON schema/权限回复 flags。危险 `--auto` 不使用。
- `opencode auth --help` → `auth list`；实际 `opencode auth list` exit 1，初始化 FileSystem.open 失败，认证能力未证明。不会绕过沙箱读取/改写凭据。
- 文档工具未返回可读正文；本期 flags 以本机帮助为证，不声称真实网络 smoke。

## 验收计划（实施前）

Fixture 覆盖 success / malformed / unknown / permission / cancel / interrupt / restart-resume / preflight-fail / stderr 分流 / 非零退出 / stale attempt / unsafe args。

- 架构基线：`pnpm architecture:check --changed` 通过，0 violations。
- freshness：沙箱禁止 `.git/FETCH_HEAD` 写入，未完成；没有执行 merge/rebase/pull。

## 实现结果（2026-09-24 23:42，Asia/Shanghai）

- `CodexCliAdapter`：`codex --ask-for-approval never --sandbox <read-only|workspace-write> exec`，JSONL stdout、临时 JSON schema 文件、显式 native session resume；关闭实测存在的 `multi_agent` / `multi_agent_v2` / `plugins` / `hooks`，不继承用户 config/rules。`--ask-for-approval never` 是拒绝交互式提权，不是自动批准。
- `OpenCodeCliAdapter`：已实现 `run --pure --format json --session` 参数组装与独立事件归一化；未证明生产安全前，preflight 明确拒绝。传入 outputSchema 时不静默忽略，直接报告未验证能力。fixture 直接调用 start 仅验证已准入端口的协议实现，不使该绑定在真实调度器中可用。
- 公共 options 与 Claude 对齐；新 exports 为 `CodexCliAdapter/CODEX_RUNTIME_ID/CodexCliAdapterOptions` 和 `OpenCodeCliAdapter/OPENCODE_RUNTIME_ID/OpenCodeCliAdapterOptions`。
- 共享新实现负责按 attempt 持有进程句柄、JSONL 分帧、stdout/stderr 隔离、受限输出、结构化终态、取消与早退收敛。没有修改既有 Claude、preflight、process-host、bootstrap、core、shared 或 UI。
- 清理阶段 cancel 或 completed 拒绝时抛出 **`recovery_required: external runtime cleanup could not confirm process exit`**，保留句柄与互斥，禁止新 attempt 越过未确认的旧进程。Codex 临时 schema 清理错误不能覆盖该异常；需由上层保留 Crew 租约。
- 未知事件/畸形 JSON 仅发 warning；stderr 不落原文，避免认证提示泄漏。成功必须同时有 vendor 终态、合法最终对象与成功退出。已出现未解决权限请求时，不接受后续“成功”作为批准；对外没有权限回复方法。

### 补充实测

- 组合实际启动 argv 后追加 `--help`，验证 Codex 的全套安全 flags 与 `exec resume <显式ID> --json --output-schema <FILE> -` 一起通过 CLI 参数解析（exit 0）；没有启动模型，也没有读取该占位 schema 文件。
- `codex features list` 实测上述 4 个 feature 均存在；probe 只接受完整 feature 名且排除 removed/deprecated 行，不能因 `multi_agent_v2` 前缀误判 `multi_agent` 可用。
- 用新增 adapter 的实际 `probe()` 读取本机 CLI：在**调用方声明 outerSandboxReady=true**时，Codex `0.156.1` → `available=true`、认证/JSONL/schema/permissionMode/leaf profile/resume 已过本地 gate，`permissionReplies=false`。这不是对 OS 外部隔离本身的独立证明。
- OpenCode `1.18.30` → `available=false`，原因 `authentication_failed`、`structured_terminal_result_missing`、`leaf_enforcement_incomplete`；`permissionReplies=false`、安全 resume=false。即使以后认证命令返回非空凭据列表，这两个尚未证明的安全/终态能力仍阻止准入。
- 认证探测只表明本地配置/状态，不证明网络可达或密钥仍有效。未运行真实网络/付费模型 smoke。

## 本次写入文件

| 路径（均在仓库内） | 变化 |
| --- | --- |
| `apps/zcode-cli/packages/adapters/src/exec/external-runtime/codex-adapter.ts` | 新建 Codex port / probe / argv / schema 生命周期 |
| `apps/zcode-cli/packages/adapters/src/exec/external-runtime/codex-events.ts` | 新建 Codex 事件转换 |
| `apps/zcode-cli/packages/adapters/src/exec/external-runtime/opencode-adapter.ts` | 新建 OpenCode port / probe / argv |
| `apps/zcode-cli/packages/adapters/src/exec/external-runtime/opencode-events.ts` | 新建 OpenCode 事件转换 |
| `apps/zcode-cli/packages/adapters/src/exec/external-runtime/vendor-cli-support.ts` | 新建共用 options、strict final schema、参数校验、capability 适配 |
| `apps/zcode-cli/packages/adapters/src/exec/external-runtime/vendor-runtime-sessions.ts` | 新建当前 attempt 的进程/流/终态收敛 |
| `apps/zcode-cli/packages/adapters/src/exec/index.ts` | 仅追加两组新 adapter exports，保留原有未提交 exports |
| `apps/zcode-cli/packages/adapters/test/external-runtime/vendor-adapters.test.ts` | 新增端口/真实离线子进程测试 |
| `apps/zcode-cli/packages/adapters/test/external-runtime/vendor-preflight.test.ts` | 新增 CLI/认证/缺能力/feature 精确探测测试 |
| `apps/zcode-cli/packages/adapters/test/external-runtime/vendor-safety.test.ts` | 新增隔离、事件分帧、早退、清理失败测试 |
| `apps/zcode-cli/packages/adapters/test/external-runtime/vendor-fixture.ts` | 新增离线宿主 fixture |
| `apps/zcode-cli/packages/adapters/test/external-runtime/fixtures/vendor-binary.mjs` | 新增离线 fake vendor binary，无网络、模型、凭据 |
| `specs/agent-crew/P1-ADAPTERS.md` | 本文，先规格后实现/验证回填 |

所有新增源文件、测试、fixture 均 ≤400 行。无新增依赖，无 commit。其余 Agent 的并行改动未回滚。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 新增 `vendor*.test.ts` | **46/46 通过**（包括 Codex/OpenCode 各自 cancel 与 completed 清理失败的 4 条回归） |
| 新增 + 既有 Claude/preflight/process-host tests | **65/65 通过** |
| `pnpm typecheck` | 通过 |
| `pnpm --filter @zcode/adapters typecheck` | 通过；根 typecheck 不含此 CLI 子包，故单独执行 |
| 3 份 vendor test 及其导入的 fixture 独立 `tsc --noEmit`（NodeNext / ES2023） | 通过 |
| `pnpm lint` | 通过：0 errors / 72 条已有 warnings；根 lint 排除了 CLI 子树 |
| 新增 adapter/test 定向 oxlint（根规则副本去掉 ignorePatterns、`--deny-warnings`） | 通过：0 errors / 0 warnings |
| `pnpm architecture:check --changed` | 通过：0 violations / 0 baseline / 0 new |
| 新增 adapter/test/fixture 使用 CLI formatter 配置定向检查 | 通过 |
| `git diff --check` | 通过 |

运行新增测试：

```sh
node --import tsx --test apps/zcode-cli/packages/adapters/test/external-runtime/vendor*.test.ts
```

## 遗留边界 / 交接

- OpenCode 真实绑定仍不可用，不能通过假造 capability、忽略 schema、`--auto` 或 ZCode fallback 放行；需后续有可验证的结构化终态及 leaf 约束方案。
- 两个非交互 CLI 均未证明权限回复接口；`permissionReplies` 为 false。群板批准/拒绝与外层租约恢复由现有 crew/facade owner 接管，本子任务不新增 UI 或 IPC 方法。
- 重启测试证明新 adapter 实例不会隐式执行且显式 resume 保留 native id；业务队列/租约 restart-recovery 由 dispatch/crew 测试覆盖，不在 adapter 重建第二份事实源。
- 只在当前 macOS/Node 24.14.0 沙箱执行离线 fixture；Windows/Linux 真实 CLI 与信号行为未做真机验收。继续使用既有 ProcessHost，不另建进程模型。
- 独立 worktree、Agent→Agent、自动接力均未实现。
- freshness 的远端 fetch 受 `.git/FETCH_HEAD` 写保护限制；全局 worklog 位于允许写入根之外，未写入，变更记录保留于本报告。
