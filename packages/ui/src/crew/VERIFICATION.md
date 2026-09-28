# Agent Crew P0 UI verification

Date: 2026-09-24 (Asia/Shanghai). Lane: executor; no delegation, service/shared edits or commit.

## Delivered

- Lazy Settings entry; create/edit/delete/duplicate crew with full custom role snapshots and read/write access.
- Separate directory binding/rebinding via platform hook or existing workspace; identity/session preserved; unsupported remote errors localized, never converted to local paths.
- Persisted board and execution views; explicit zero/one-member provider selection; plain text @ has no scheduling semantics.
- Stable message IDs for unchanged retries, reset on content/recipient changes; stale/foreign recipient fails closed.
- Explicit recovery and safe cancellation, including recovery_required without taskId. Missing task references have their own blocking hint, without disabling verification.
- Activity-only projection polling; no list polling while editing/viewing a crew, no detail polling while editing, no hidden-document/offline polling. No accepted queue or execution state synthesized in UI.

## Executed checks

| Check                                                                                                | Result                                                                       |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*` | 14 passed: 7 helper/provider tests and 7 actual React server-rendering tests |
| `pnpm typecheck`                                                                                     | Exit 0, root project graph                                                   |
| `pnpm lint`                                                                                          | Exit 0: 72 warnings, 0 errors; warnings outside Crew changes                 |
| Targeted `oxlint` for crew, useCrew hooks and provider                                               | 0 warnings, 0 errors                                                         |
| `pnpm architecture:check --changed`                                                                  | 0 violations / 0 baseline / 0 new                                            |
| `git diff --check`                                                                                   | Passed                                                                       |
| Targeted `oxfmt --check`                                                                             | Crew files/hooks/provider and Settings/navigation/config passed              |
| New file length                                                                                      | Each under 400 lines                                                         |

Translation key/placeholder parity is exercised by the rendering tests. The added Crew locale blocks are formatted. Full locale-file formatting still flags unrelated pre-existing `webRemoteControl.relay` line wrapping (two English entries and one Chinese entry), intentionally left untouched.

## Explicit gaps

- Browser/Electron E2E was NOT executed. React SSR checks verify rendered labels, disabled controls, status/cancellation affordances and safe text output, not hydration, click/keyboard interaction, popup focus, network execution or visual mobile layout.
- No new DOM/test-renderer/browser dependency was installed. The executable browser scenarios are recorded in `SPEC.md` for the integrated running app.
- Canonical local path/identity validation, remote capability rejection, runtime ownership and safe cancellation are service/runtime responsibilities; UI tests do not claim to verify those backend guarantees.
- Workspace freshness check could not fetch because `.git/FETCH_HEAD` is read-only. No merge/rebase/branch change was attempted.
- The plain `tsx` executable could not create its IPC socket in this sandbox; Node's `--import tsx --test` path executed successfully instead.

## P1 UI slice — 2026-09-24

时间：2026-09-24 22:58（Asia/Shanghai）。类型：Feature / Bugfix。项目：ZCode；分支：`feat/web-config`；执行者：Codex executor。此节仅记录 UI 接入，不代表整个 P1 后端/CLI 已验收。

### Changes and ownership

- Fixed the P0 snapshot helper's forced `runtime: "zcode"`. Runtime is preserved on save/copy; a runtime-only edit advances configVersion while preserving member identity. A regression test first failed on the old forced fallback, then passed after the fix.
- Added four-runtime selection in `CrewGroupEditor`. External members show their CLI-managed model hint rather than ZCode's default model.
- Added `CrewRuntimeStatus` + pure `crewExternalUi` helpers. Member summary, picker and recipient view read `detail.runtimeAvailability` by memberId + runtimeId. Missing/mismatched/negative probes block external dispatch; board-only posts remain possible. No extra probe store or fallback path.
- Added `CrewPermissionRequest`. Only current running/task-backed requests expose controls; unsupported approval is disabled and explained, while deny remains available. Pending commands disable both actions. Terminal/recovery records cannot approve stale requests.
- Wired `CrewSection` → `useCrew.respondPermission` → `ICrewService.respondPermission` with exact group/execution/request IDs. Existing hook command locking and projection refresh are reused; failed admission/permission commands also refresh stale projections. No optimistic resolution or lease release.
- zh/en Crew keys and placeholders match. Unknown provider reasons/descriptions render as escaped text; service-side diagnostic sanitization remains the owner's responsibility.

### Changed files in this slice

- Added: `CrewRuntimeStatus.tsx`, `CrewPermissionRequest.tsx`, `crewExternalUi.ts`, `crewExternalUi.test.tsx` under this directory.
- Updated: `CrewGroupEditor.tsx`, `CrewBoard.tsx`, `CrewComposer.tsx`, `CrewSection.tsx`, `crewUiHelpers.ts`, `crewErrors.ts`, `crewUiHelpers.test.ts`, `crewRendering.test.tsx` under this directory.
- Updated: `../hooks/useCrew.ts`, Crew keys only in `../i18n/locales/{en-US,zh-CN}.ts`; this directory's `SPEC.md`/`VERIFICATION.md`; P1 UI subsection in `specs/agent-crew/IMPLEMENTATION.md`.
- No shared/services/CLI source edits, dependencies, subagents, commits or branch operations in this slice. Existing uncommitted work was preserved. Simplification: removed the obsolete ZCode-only runtime label and reused the existing hook/service command path.

### Fresh verification

| Check                                                                   | Result                                                                      |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| UI SSR/helper command above                                             | 29/29 passed (P0 14 retained/updated for runtime selection + 15 P1 cases)   |
| `pnpm typecheck`                                                        | Exit 0                                                                      |
| `pnpm lint`                                                             | Exit 0; 72 warnings / 0 errors                                              |
| Targeted `oxlint packages/ui/src/crew packages/ui/src/hooks/useCrew.ts` | 0 warnings / 0 errors                                                       |
| `pnpm architecture:check --changed`                                     | 0 violations / 0 baseline / 0 new, before and after implementation          |
| Targeted `oxfmt --check`                                                | Passed; locale Crew blocks formatted separately to preserve unrelated edits |
| `git diff --check`                                                      | Passed                                                                      |
| File length                                                             | All UI Crew source/test files below 400 lines; largest new file 266 lines   |

### Not executed / remaining integration work

- Browser/Electron click, keyboard, popup focus, mobile layout and reconnect E2E were not executed. Six P1 scenarios and the event-order diagram are in `SPEC.md`. SSR verifies markup/guards, not interactive state transitions or service transport.
- This UI slice did not probe real CLI binaries, call vendor networks, run true model smoke tests, or rerun backend vendor/restart-recovery fixtures. Adapter capability evidence and backend fixture results belong to their implementation lanes; the original P0 40/40 result above is historical, not a fresh P1 backend claim.
- Workspace freshness was attempted and blocked by read-only `.git/FETCH_HEAD`. Global worklog location is outside writable roots; this scoped report records the work without writing outside the workspace.

## P0.1 UI catalog/reference split

时间：2026-09-25 01:25（Host local, Asia/Shanghai）。类型：Feature / Bugfix。项目：ZCode；分支：`feat/web-config`；执行者：Codex bounded executor。此节仅记录指定 UI slice，不代表后端、RPC、CLI 或浏览器 E2E 验收。

### Changes and ownership

- Added independent Agent management / Group management tabs. Catalog CRUD goes through the optional `ICrewAgentCatalogService` via `useCrewAgentCatalog`; missing catalog/model services have localized, explicit limitations.
- Independent agent form supports systemPrompt, four runtimes, default access, Host ZCode model/reasoning and optional tool allowlist. External models remain CLI-managed and unsupported ZCode controls are hidden. Updates clear optional fields using JSON `null`; an explicit empty allowlist remains `[]`.
- Replaced group-inline definition editing with catalog multi-selection and inherited/narrowed reference permissions. Payloads contain only memberId/agentId/accessMode. Duplicate/missing references and read-to-write escalation are rejected.
- Reconciled catalog write→read downgrades: the editor derives effective read drafts from old write references, allowing rename/save without mutating input objects or catalog. Persisted reference identity remains stable.
- Reused a single workspace field for create/edit and binding. Save commits the group before optional bind; a bind failure preserves the saved group and error rather than prompting another create.
- Board/composer/mention provider now consume `resolvedMembers`. Current cards show current names/runtime/configVersion/access; historical execution labels use immutable memberSnapshot. P1 probes, permission approval/denial/cancel and draft idempotency remain intact.
- Catalog writes refresh the catalog and current detail. Read errors after successful writes cannot become rejected writes. No local accepted queue, persistent agent definition store or new execution owner.

### Files in this slice

- Added under this directory: `CrewAgentCatalog.tsx`, `CrewAgentEditor.tsx`, `CrewAgentModelField.tsx`, `CrewWorkspaceField.tsx`, `crewCatalogUi.ts`, `crewCatalogUi.test.ts`.
- Updated under this directory: `CrewSection.tsx`, `CrewGroupEditor.tsx`, `CrewBindingControl.tsx`, `CrewBoard.tsx`, `CrewComposer.tsx`, `CrewRuntimeStatus.tsx`, `crewExternalUi.ts`, `crewUiHelpers.ts`, `crewErrors.ts`, existing three test files, `SPEC.md`, `VERIFICATION.md`.
- Added hooks: `../hooks/useCrewAgentCatalog.ts`, `../hooks/useCrewAgentModels.ts`.
- Updated `../mentions/providers/crewMentionProvider.ts` and Crew keys only in `../i18n/locales/{en-US,zh-CN}.ts`.
- No shared/services/client/RPC/specs/CLI/fixture edits, added dependencies, subagents, commits or branch integration. Existing unrelated work was retained. Removed obsolete snapshot/role-construction helpers and stale inline-editor translations.

### Fresh verification

| Check                                                                                                | Result                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*` | **41/41 passed**, including catalog/reference, downgrade reconciliation, latest-versus-historical definitions and retained P1 scenarios |
| `pnpm typecheck`                                                                                     | Exit 0                                                                                                                                  |
| `pnpm lint`                                                                                          | Exit 0; 72 warnings / 0 errors                                                                                                          |
| Targeted `oxlint` for crew, useCrew hooks and mention provider                                       | 0 warnings / 0 errors                                                                                                                   |
| `pnpm architecture:check --changed`                                                                  | 0 violations / 0 baseline / 0 new before and after                                                                                      |
| Targeted `oxfmt --check`                                                                             | Passed; only Crew locale blocks formatted to preserve unrelated edits                                                                   |
| `git diff --check`                                                                                   | Passed                                                                                                                                  |
| Source/test size                                                                                     | All touched Crew source/tests under 400 lines; largest 319 lines                                                                        |

The pre-change 29 P0/P1 tests passed. New catalog tests and downgrade tests were added before the respective helpers, failed on missing implementation, then passed. A separate post-edit review checked service boundaries, strict reference payloads, explicit clearing, partial create/bind failure and P1 projection handling; no additional owner or dependency was introduced.

### Validation gaps / coordination

- Workspace freshness was attempted but `git fetch origin --prune` cannot write `.git/FETCH_HEAD` in this sandbox. No merge/rebase/pull or Git write workaround was attempted.
- Parent owns `specs/agent-crew/e2e/` offline fixture and its build/run instructions. Parent reported fixture compilation successful, but real browser reconnection became blocked by ego_cli bootstrap sandbox restrictions; localhost listening is also denied. This lane did **not** complete browser clicks, mobile visual/keyboard checks or live model/CLI smoke tests. SSR/helper tests are not E2E evidence.
- Parent reported backend 73/73, P1 CLI 173/173 and client/schema 5/5 passing; these are coordination reports, not independently executed results of this UI lane.
- The global worklog directory is outside the assigned writable scope. This local verification entry records the work without writing outside scope; parent owns final `specs/agent-crew/IMPLEMENTATION.md` integration.

## Multiconversation UI slice — 2026-09-25

时间：2026-09-25 17:47（Asia/Shanghai）。类型：Feature / Bugfix。项目：ZCode；分支：`feat/web-config`；执行者：Codex bounded executor；无子代理、依赖新增或 commit。

### Delivered / changed paths

- UI SPEC first: `crew/SPEC.md`; group selection/list/new-conversation in `CrewSection.tsx`, `CrewConversations.tsx`; selected board/composer in `CrewConversationView.tsx`, `CrewBoard.tsx`, `CrewComposer.tsx`.
- `hooks/useCrew.ts` + `hooks/crewRequestScope.ts`: owner/group/conversation cache keys, explicit IDs, selection-generation command guards, captured-key refresh, scoped pending/errors and stale navigation prevention. No accepted queue or persisted state ownership moved into UI.
- `crewUiHelpers.ts`, `crewExternalUi.ts`, `CrewPermissionRequest.tsx`, `crewErrors.ts`: explicit send/approval IDs, foreign projection filtering, localized missing-conversation errors. Shared binding/member controls still follow aggregate group status; dispatch follows selected conversation status.
- Empty nondefault names display numbered zh/en titles using authoritative creation order (named entries retain slots); list and board share the helper, and locale text is never persisted. Only crew keys changed in `i18n/locales/en-US.ts` and `zh-CN.ts`.
- Existing `crewUiHelpers.test.ts`, `crewRendering.test.tsx`, `crewExternalUi.test.tsx` fixtures migrated. New `crewConversation.test.tsx`, `crewSelection.test.ts`, `crewHookHarness.ts` cover selection/cache/late commands, titles and recovery isolation.
- `specs/agent-crew/e2e/`: updated existing fixture/services/build/browser scenario; added conversation store, explicit delay barriers, multiconversation browser scenario and bundled Node fixture test runner. README records execution boundaries.

### Fresh validation

| Check                                  | Result                                                           |
| -------------------------------------- | ---------------------------------------------------------------- |
| Crew UI Node tests                     | **57/57 passed**: original 41 plus 16 new regressions            |
| Offline fixture service test           | **1/1 passed**, via `node specs/agent-crew/e2e/test-fixture.mjs` |
| Fixture build                          | Passed; `/tmp/crew-p01-browser/index.html`                       |
| Both browser scripts `node --check`    | Passed; syntax only                                              |
| Root `pnpm typecheck`                  | Passed, exit 0                                                   |
| Root `pnpm lint`                       | 0 errors, 72 existing warnings outside this slice                |
| Targeted lint                          | 0 warnings, 0 errors                                             |
| Changed architecture                   | 0 violations / 0 baseline / 0 new                                |
| Targeted format and `git diff --check` | Passed                                                           |
| Crew source size                       | Every `.ts`/`.tsx` <=400 lines; maximum 340                      |

The hook harness executes the actual hook against controlled hooks/cache; SSR tests render actual components. Neither is a substitute for browser clicks. The standalone fixture source is bundled with UI workspace dependency resolution; invoking its TS test directly from the repository-root specs directory cannot resolve `@zcode/shared`, so use the provided runner.

### Remaining gaps / scope

- **Browser click E2E unexecuted.** Leader reported `ego_cli bootstrap / NSWorkspace XPC Connection invalid` in the sandbox. Per instruction, no retry, Full Access or bypass was attempted. Runnable scripts are `verify-browser.mjs` and `verify-multiconversation.mjs`.
- No production CSS/mobile touch/real Host/SQLite/runtime E2E claim. Backend/client/sidebar results reported by leader are not counted as this executor's checks.
- Workspace freshness could not fetch because `.git/FETCH_HEAD` is read-only. No merge, rebase, branch mutation or commit was attempted.
- Worklog retained here within the assigned writable scope; external shared-memory location was not written. Existing uncommitted/untracked work was retained; its prior contents are not counted as new implementation lines for this slice.

## 受控接力 UI — 2026-09-26

时间：2026-09-26 08:47（Asia/Shanghai）。

类型：Feature / Bugfix。项目：ZCode；分支：`feat/web-config`；执行者：Codex bounded UI executor。相关规范：`specs/agent-crew/RELAY.md`、本目录 `SPEC.md`。仅 UI / hook / zh-en / relay E2E 所有权范围，无 CLI 或服务实现改动、无依赖新增、无 commit。

### 本轮交付与边界

- `CrewRelayCard/Plans/Settings/Control.tsx`、`crewRelayUi.ts`：根计划置顶审批、普通交接、自动 A→B 标识、固定原因文案、模式/K/时间预算及 busy 暂停。编辑器保存沿原 create/update 路径。
- `useCrew.ts` 增加显式会话 scope 的 respondRelay，保留原缓存刷新和晚到响应隔离；UI 不解析标签派工、不持有接力队列。
- 预算输入的中英提示明确“修改只适用于新请求，已有接力链保留原预算”；新增双语渲染和 aria-describedby 断言，不重算 execution.relayBudgetMinutes。
- `CrewStatus` 支持 awaiting_user_approval；`crewErrors` 与两种 locale 增加固定错误/状态文本；仅成员回复展示移除完整标签。
- `CrewChatView/ConversationView/MessageStream/ExecutionRow/Board/GroupEditor` 接入。`crewChatPresentation` 依据同群/会话/epoch/messageId 的 hop>0 execution 将生成输入展示为系统，不改变持久化 sender=user。
- 审批恢复检查只作用当前会话；其他会话导致的群级 recovery 汇总不阻止审批。两项集成回归先运行得到3项预期失败，再实现并全量通过。
- 审批可用性 SSR 断言仅匹配实际 `disabled=""` 属性，不再误匹配 `disabled:pointer-events-none` 样式类；最终合集日志 `/tmp/crew-ui-final-tests.log`。
- `crewRelay*.test.*` 覆盖真实组件回调、设置提交及边界、暂停/恢复、作用域、固定原因双语、置顶/自动标识和系统发送者。旧 `crewChatComponents.test.tsx` 断言补 `confirm:true`，原实现不变。

### Fresh evidence

| 验证 | 真实结果 |
| --- | --- |
| 开始前 UI 基线 | 129 tests，128 pass / 1 fail；既有 recovery 断言遗漏 confirm:true，不是本轮回归 |
| UI 全集 | `TSX_TSCONFIG_PATH=packages/ui/tsconfig.json node --import tsx --test packages/ui/src/crew/*.test.*`：143/143，exit 0 |
| 类型检查 | `pnpm typecheck`：exit 0 |
| 全仓 lint | `pnpm lint`：exit 0，73 warnings / 0 errors；警告在本轮文件外 |
| 本轮源文件 lint | 26 文件 targeted oxlint：0 warnings / 0 errors |
| 架构前后 | `pnpm architecture:check --changed`：0 violations / 0 baseline / 0 new；UI context 当前 unmanaged，无新增跨模块入口 |
| 格式/静态 | 26 文件 oxfmt --check、git diff --check 通过；本轮非 locale 源文件均 <=400 行，既有大 locale 仅插入文案块 |
| 内存 fixture | `node specs/agent-crew/e2e/test-fixture.mjs`：2/2 |
| Relay E2E 语法 | `node --check specs/agent-crew/e2e/verify-relay.mjs`：exit 0 |
| 浏览器 fixture 打包 | `CREW_E2E_HOME=1 node specs/agent-crew/e2e/build-fixture.mjs /tmp/crew-relay-browser`：exit 0，产物 `/tmp/crew-relay-browser/index.html`；既有 fileDisplay.tsx import.meta/IIFE warning |

### E2E 交接与明确缺口

- 可复现场景：`specs/agent-crew/e2e/verify-relay.mjs`。命令、fixture 范围和人工入口见该目录 `README.md` 接力章节。
- 实际浏览器测试**未执行**：leader 一次连接尝试遇到 `ego_cli bootstrap / NSWorkspace XPC Connection invalid`。executor 未重试、未启用其他浏览器/HTTP 绕过。不把 SSR/Node 回调/打包视为浏览器、生产 CSS、手机或 runtime/Host 验收。
- workspace freshness 的 git fetch 被 `.git/FETCH_HEAD` 只读权限阻断；没有 merge/rebase/分支操作。
- 全局 worklog 目录在允许写入范围外；本轮证据保存在本地此节，未绕过沙箱或修改所有权范围外文件。
