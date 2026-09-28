# Crew P0.1/P1 shared UI

## Contract and ownership

- Settings → Agent Crew is shared by Desktop and Web, including narrow screens.
- CrewAgentCatalogService owns reusable Agent definitions; CrewService owns persisted groups, member references, bindings, messages and execution audit snapshots. UI owns only selection, editor fields and unsent drafts; it never reconstructs an accepted queue.
- `useCrew` accesses group facts and `useCrewAgentCatalog` accesses catalog facts through separate host-provided service descriptors. Reads refresh the projection; refresh failure after a successful command must not make that command look rejected.
- Creation saves the group name and selected catalog references first. Binding is a separate command. Copies open with the service-returned unbound state, without UI copying messages or execution references.
- Independent catalog assets store generated agentId/configVersion, name, systemPrompt, default access and optional model/tool configuration. Runtime is `zcode`, `claude-cli`, `codex-cli` or `opencode-cli`. Group members store only agentId and group access overrides; no inline definition creation or editing.
- Directory selection uses IPlatformService or an existing workspace tab. Existing bindings retain workspaceIdentity and remoteSessionId, never reconstructed from path alone. Remote capability rejection remains explicit at the service boundary.

## Ordering and safety

```text
form/draft → hook command → CrewService (single owner) → durable projection
                                      ↓
                       hook read refresh → group board / execution status
Desktop continuous and Web replayable session delivery stay owned by the existing Host.
The board only reads persisted Crew projections; it does not add another runtime or replay path.
```

- Only explicit selection from the Crew mention provider yields zero/one memberId. Typed/pasted @, role names, markdown links and agent output cannot schedule work.
- Directly typing a standalone `@` opens the member picker; a chip is assigned only after explicit selection. Email/IME/paste do not create mentions.
- A draft keeps messageId across unchanged retries, and rotates it when text/recipient changes. Submission disables editing until the result is known. Changing group/epoch resets the composer.
- Running, queued and recovery-required groups disable edits/rebind/delete. Recover is an explicit action; UI does not replay executions. Recovery-required executions still expose Cancel, including records without taskId; a separate hint explains that only the service/runtime can verify safe release.
- Labels/errors/statuses use zh-CN/en-US translations. Destructive deletion requires confirmation. Mutation failures preserve drafts/forms.

## Acceptance / E2E scenario (runtime validation required)

1. At 390px and desktop width, open Settings → Crew → Agent management, create two catalog agents including duplicate display names; inspect prompts and default permissions, then select those assets in Group management.
2. Create unbound; choose a directory; binding error stays visible and does not recreate the group. Existing remote workspace identity/session must survive selection unchanged.
3. Type `@Reviewer` and send without selection: board-only message. Pick one same-name member from the searchable provider: exactly its memberId in send params; clear chip: no assignment.
4. On accepted dispatch, inspect queued/running/terminal text and resulting board reply; refresh/reopen shows persisted facts. Network failure retains draft; retry unchanged sends the same messageId.
5. While active/recovery-required, rebind and edit are unavailable; invoke cancel or explicit recover and refresh owner status.
6. Duplicate: new group opens unbound with independent member IDs referencing the same catalog agents and no history. Bind elsewhere; old-epoch history never becomes dispatch context.
7. Verify keyboard-only member picker, localized errors, long names, dark/light themes and mobile wrapping.

Node tests cover provider identity, plain-text non-dispatch, draft idempotency and reference/current-version rules and execution audit snapshots. E2E scenarios above must be reported as unexecuted until a wired running app/browser is available.

## P1 external runtime UI contract

- The catalog editor saves the selected runtime without substitution; definition updates receive a service-generated configVersion. Group edits do not change Agent versions. ZCode is only the explicit default for a new catalog agent, never a failed-provider fallback. External runtimes use their own model configuration, not the ZCode model hint.
- `detail.runtimeAvailability` is the service-owned availability projection. Match both memberId and runtimeId (not runtime alone: two members may have different access policies). Missing/mismatched probes are unverified and block external dispatch. A false probe displays Unavailable and its reason as text; known crew error codes are localized. The server owns sanitizing provider diagnostic text.
- Availability appears on collapsed member summaries, in the member picker and beside the selected recipient. An unavailable selected recipient cannot be dispatched; clearing the selection still permits a board-only message. Refresh may update availability; UI never changes the member runtime or creates a local probe cache.
- `execution.permission` supplies requestId, toolName, description and canRespond. Only a running execution with a taskId exposes current permission controls. The approval button is disabled with an explanation when canRespond is false; denial remains possible. Queued, terminal and recovery-required records must not expose stale permission controls.
- Permission actions go through `useCrew.respondPermission` → `service.respondPermission({ groupId, executionId, requestId, approved })`. Denial uses that same command with approved=false, delegating safe cancel/failure semantics to the service. No optimistic permission resolution, completion or lease release; service errors retain the projection until a read refresh. The existing hook's command lock prevents repeated submissions.

```text
catalog editor → useCrewAgentCatalog.update → Agent definition (runtime + configVersion)
group selector → useCrew.update → member references only
CrewService.get → runtimeAvailability/member + execution.permission → board/composer
approve/deny → hook command lock → service.respondPermission (validate current request)
  → adapter response OR safe cancellation → owner projection → hook revalidation
Desktop + mobile Web → same service commands/projection, no extra runtime or replay owner
```

### P1 E2E scenarios (not yet executed)

1. In zh/en, desktop and 390px Web, create/edit catalog agents for all four runtimes, then select them in crews. Save/reopen and copy; references resolve current runtime/version and copied crew is unbound. External runtime never displays the ZCode default model as effective configuration.
2. Bind a workspace with a missing/unauthenticated provider. Collapsed member summary and picker show Unavailable and reason; select it: dispatch stays blocked and draft/recipient remain. Clear recipient: board-only post remains possible. Repair provider and Refresh: the new service probe enables dispatch, without changing runtime.
3. Give same-runtime members different access policies/probes; only the unavailable member is blocked. Omit or mismatch a member probe: it stays unverified, not implicitly available. Race a capability failure after the UI probe: service admission rejects visibly without fallback; refresh obtains the current reason.
4. Feed a current running permission request. Approve sends exact group/execution/request IDs and approved=true; Deny sends approved=false. While the command is pending, both controls are disabled. A rejection keeps the error visible; no optimistic success/cancel state.
5. With canRespond=false, approval is disabled and explained; Deny and the existing Cancel execution remain available. On safe stop the service projection becomes cancelled/failed. A terminal or recovery-required execution with an old permission payload exposes no stale approval/denial actions. Reconnect/refresh only reads the owner state, never automatically approves or restarts.
6. Render long reasons/tool descriptions and literal HTML as plain text; check keyboard focus, labels, light/dark colors and mobile wrapping. Verify no provider credential is present in service-provided diagnostics.

SSR/helper tests do not count as browser interaction, backend vendor fixture, restart-recovery or real CLI smoke validation.

## Catalog/reference editing details

- Agent management and Group management are independent tabs. Catalog agents are Host-owned assets,
  not runtime subagents. `useCrewAgentCatalog` is the only catalog command/read path; `useCrew`
  remains the group/board owner projection. Missing optional services show a localized limitation.
- Agent CRUD edits name, systemPrompt, runtime and default read/write policy. ZCode may select a
  configured Host model and optional tool allowlist (inherit versus explicit list, including empty).
  External runtimes explicitly use vendor CLI model/capability configuration; changing to external
  clears unsupported fields. Update uses JSON `null` to clear modelSelection/toolAllowlist.
- Group create/edit chooses a directory and existing catalog agents; no inline agent definition
  creation/editing. Members persist only agentId, existing memberId and optional accessMode override.
  Duplicate references and missing agents are rejected; read-only catalog defaults cannot be
  elevated to write. Inherited policy follows the current catalog default. Limit remains 32 members.
- Bind remains a separate owner command after create/update. If it fails, keep the saved group and
  expose the binding error; never retry creation automatically. Copies remain unbound.
- Group cards, member picker and board use service `resolvedMembers` (live name/runtime/version).
  Execution labels use their historical memberSnapshot. Preserve P1 runtime probes, fail-closed
  dispatch, approval/deny/cancel and original messageId retry semantics.
- Catalog changes refresh its list and current group detail. Read-refresh failure after a committed
  write is a read error, not a rejected write. Cache keys are service-owner scoped; no accepted
  queue, definition persistence or execution owner is introduced in UI.

```text
Agent form -> useCrewAgentCatalog -> catalog owner command -> commit
                                   -> refresh catalog + current group detail
Group form -> useCrew -> group owner reference validation -> commit -> optional bind
Board/composer <- detail.resolvedMembers + original P1 probes/permissions
Execution history <- immutable execution.memberSnapshot
Desktop continuous / mobile replayable -> same Host/RPC owners and existing admission
```

### P0.1 verification / interaction scenario

1. Create two catalog agents independently (ZCode model/tools and external CLI); reopen edits.
2. Create group A, choose directory, select both agents and narrow a writer to read. No role/model
   controls appear in the group editor. A reader cannot be elevated to write.
3. Create group B selecting the same catalog agent. Rename/change runtime in Agent management;
   reopen A/B and see latest definition/version; old executions keep their original snapshots.
4. Delete the referenced agent: localized agentInUse, no optimistic removal. Remove references
   from both groups, then delete successfully. Group deletion never deletes catalog assets.
5. Clear ZCode optional model/tools, save and reopen; clearing survives JSON transport. External
   runtime never offers fake ZCode model/tool control. Preserve P1 availability/permission scenarios.
6. Verify narrow layout, keyboard tabs/selectors and zh/en labels. SSR/helper tests prove rendering,
   strict reference payloads, permission guards and clear semantics, not browser E2E or real CLI IO.

Cleanup plan: first retain/run the 29 P0/P1 rendering/helper regressions; replace obsolete snapshot
assertions with catalog/reference regression cases before replacing the helper. Separate catalog
forms from group reference selection, reuse binding/model primitives, then run tests, typecheck,
lint, formatting and architecture checks. No dependencies or edits outside the assigned UI scope.

### P0.1 downgrade reconciliation

A catalog writer may be downgraded to read while old group references still contain `accessMode:
write`. Backend resolves that reference as read. The group editor derives a read-only draft
projection from the current catalog for both controls and submission; a name-only edit remains
saveable. Neither the original group reference object nor the catalog definition is mutated.
Direct read-to-write input still fails validation. Saving the projected editor draft narrows the
persisted group override to read, preserving memberId/agentId.

## Group multiconversation UI (2026-09-25)

- Group detail owns the shared team/binding controls and displays a conversation list with a new
  conversation action. Opening a conversation reuses CrewBoard and CrewComposer. Empty names use
  localized default/numbered titles; isDefault identifies the legacy conversation (not list order).
  Unnamed nondefault titles are Conversation {number} / 会话 {number}; number is their 1-based
  position among nondefault conversations in the service creation-order list (createdAt + row order).
  Named conversations still occupy a position. List and board use the same helper, with
  detail.conversations on the board; no locale text is persisted and updatedAt/status never renumbers.
- CrewService remains the sole persisted owner. `useCrew` reads listConversations to discover the
  default and always supplies an explicit conversationId to get/send/recover/cancel/respondPermission.
  UI caches are scoped by service owner, groupId and conversationId. Missing/foreign conversations
  show localized conversationNotFound; never fall back to another conversation's history.
- UI selection is CrewSection-local. Request state is scoped to the exact selection generation;
  switching immediately hides the previous projection, pending state, errors and approvals. Drafts
  live only in the mounted conversation composer and reset on leaving it. No accepted queue or
  server state is duplicated. Returning may reuse only that conversation's own SWR read cache.
- Late reads fill only their original cache key. Late commands may refresh their original keys but
  cannot expose errors/pending state in, clear the draft of, or navigate a newer selection. Group
  create/copy/delete and conversation-create continuations also check selection freshness. Refresh
  failures after accepted commands remain read failures, not a second command/retry path.
- Dispatch and recover controls use selected conversation.status. Shared binding/member/delete
  restrictions still use aggregate group status, including unresolved work in other conversations.
  Approve/deny/cancel carry the displayed conversationId; they cannot target another conversation.
- Existing desktop continuous and mobile replayable transport semantics and global workspace lease
  admission remain service/runtime responsibilities; UI does not invent a per-conversation lock.

```text
select(group, conversation) -> new UI selection generation -> hide prior projection + draft
                           -> SWR(owner, group, conversation) -> explicit service.get -> board
command -> capture generation + explicit IDs -> CrewService owner -> commit
        -> refresh captured keys -> only current generation may show result or navigate
other conversation recovery -> aggregate group edit/bind lock (not selected board dispatch gate)
```

### Multiconversation acceptance

1. Retain the 41 existing UI regressions with explicit conversation fields in fixtures/payloads.
2. Localized default/empty titles, shared members/binding, independent history and recovery gate.
3. A -> B while A get/send/create is pending: no A history, draft, approval, error or navigation in
   B; resolve A last and verify B stays selected. Return to A to see only its committed history.
4. Offline browser fixture supports creating two conversations, text messages, deferred reads and
   commands; old catalog/reference scenario opens the default conversation explicitly where needed.
5. Run UI tests, fixture build, typecheck/lint and architecture checks. Leader runs real browser
   scenarios separately; fixture/SSR checks are not full Host/storage/runtime E2E evidence.

## 受控接力 UI（RELAY.md 接入）

- CrewService 是 relay 设置、审批和会话状态的唯一所有者；UI 草稿只在编辑器内，提交沿 `useCrew.update/respondRelay → service → SWR 原 scope 刷新`，不生成执行、不解析标签派工。
- 编辑器支持 manual/semi/auto、K=0..8（默认2）、分钟预算=1..1440（默认30），显示固定最大8跳。群聊/群板直接展示设置摘要及暂停/恢复按钮；busy 不阻止暂停，pending 命令阻止重复点击。恢复只更新开关，不审批、不重放。
- 当前群/会话的根 hop0 `kind=plan` 待批准卡置于消息流顶部，展示最终回复摘要、下一站、objective/context，按钮为“批准并开始”/“拒绝”。hop>0 即便返回规划者也不展示根计划入口。普通 handoff 卡跟随执行记录；自动 dispatched 显示来源 → 目标标识。
- 同一 projection 中的失效 epoch、当前会话恢复未决、非成功执行及暂停状态不允许批准；其他会话导致的群级恢复汇总不阻止本会话审批。审批始终携带 groupId/conversationId/executionId/approved，不沿用权限 requestId。未决/已派发/拒绝/阻断状态只读服务投影。
- reason 只显示固定白名单中英文本，未知原因显示通用错误，不展示异常原文。成员回复可移除 crew-handoff 标签用于展示，用户文本保持原样。

```text
点击批准/拒绝 → useCrew 捕获当前 scope → CrewService.respondRelay
                                      → 刷新原 group/conversation 投影
切换会话后晚到返回 → 只刷新捕获的旧 scope，不更新新会话
暂停/恢复 → group update(relayPaused) → 同一 owner 的 Desktop continuous / Web replayable 投影
```

验收：真实 React 回调验证批准/拒绝/pending/失效 scope、设置保存和 busy 暂停；SSR 验证置顶/普通交接/自动标识/双语固定原因；离线浏览器 fixture 验证实际按钮与 hook 命令，不宣称 runtime 或 Host E2E。

- 接力输入复用服务端 sender=user 存储，但 UI 按同群/会话/epoch、messageId 关联 execution.hop>0 显示“系统”。普通用户根消息仍显示“你”，不依据文本、成员名或 ID 格式猜测来源。

- 时间预算在根请求创建时冻结为 execution.relayBudgetMinutes；群预算修改只影响新根请求。预算输入旁必须有中英提示，已有接力链保留原预算，不在 UI 重算或改写执行快照。

## 首页创建编辑器与目录草稿回填（2026-09-26）

- 侧栏「创建群组」是独立的 `onCreate` 导航入口；「管理」仍打开设置，不能共用动作。
- `useCrewHomeNavigation` 唯一拥有首页选择意图：新建为 `groupId=null / conversationId=null / editing=true`；编辑已存在群组继续使用 `edit(groupId)`，不改变会话打开规则。
- 新建无需群组、默认会话或详情读取成功即可渲染 `CrewGroupEditor`。点击入口不创建持久群组；取消不发送 create/update/bind。
- Shell 先设置新建意图，再切换 `workspaceMainView=crew`，最后仅在移动抽屉已打开时关闭抽屉。抽屉卸载/隐藏不能拥有或清空编辑意图。
- `CrewGroupEditor` 唯一拥有名称、成员和目录绑定草稿；DirectoryBrowser 的选择只更新该草稿，Select 立即显示所选路径（包括尚未打开为 workspace tab 的目录）。浏览路径提交不得冒泡触发群组保存。
- 保存复用 `useCrew.create/update/bind`：创建成功再绑定；绑定失败保留表单与错误，仅记录已接受 create 的 groupId 作为重试收据，重试更新同一群组而不重复创建。成功/失败均遵守 `isCurrent()`，迟到响应不改变新选择。
- zh/en 复用既有 createGroup/editGroup/chooseDirectory/workspace 翻译，不新增重复文案；不改协议、Host、relay 或 CLI。

```text
侧栏 onCreate → Shell → useCrewHomeNavigation.create（仅导航意图）
                     → 主区 crew → 若移动抽屉打开则关闭
                     → CrewHome → CrewGroupEditor（唯一表单草稿）
目录浏览 → fileService 只读 → 选择此目录 → setBinding → Select 路径
保存 → useCrew.create/update → CrewService（唯一持久事实源）
                            → bind → 成功退出 / 失败保留草稿与 create 收据
Desktop continuous / mobile replayable：沿用原 Host/owner/lease，不新增同步通道。
```

验收：1440 桌面及 390×844 isMobile，真实侧栏创建入口 → 主区编辑器（非设置）→ 目录浏览 → 选择此目录 → Select 显示所选路径；移动抽屉关闭且编辑器保留。另覆盖无详情新建、取消不创建、绑定失败重试不重复创建、Host 切换/过期保存不导航，以及既有会话打开回归。浏览器不可运行时明确标注阻碍，静态/Node 结果不冒充截图验收。
