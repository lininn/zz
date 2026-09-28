# Homepage crew chat presentation

Date: 2026-09-25. Supplements `HOME.md`; no service, hook, routing, or protocol changes.

## Ownership and order

```text
CrewController / CrewGroupDetail (existing owner and read projection)
  → scope by groupId + conversationId
  → message sequence → dispatch execution row → subsequent message
  → adjacent same-sender groups, split at executions / epochs / snapshot changes

UI-local draft → existing CrewComposer → controller.send → existing admission
recovery / cancel / permission → existing controller commands
execution disclosure → mount CrewExecutionDetails(execution) → real read-only timeline
collapse / switch conversation → unmount details (stop reads)
```

- The UI creates no events, accepted queue, duplicate runtime, or business state. Desktop continuous and mobile replayable deliveries remain owned by the existing service/Host.
- Messages and executions outside the selected group/conversation are excluded before display or action wiring. Message sequence determines message order; an execution appears immediately after its dispatch message. Missing dispatch messages fall back to the execution creation time, never its changing update time.
- Adjacent messages group only when conversation, epoch, sender, member identity, and historical name/config snapshot match. An intervening execution row splits grouping.
- Agent names prefer the message's matching execution snapshot; mention names prefer the execution dispatched by that message. Older names must not be replaced by current catalog names. Historical fallback uses only same-epoch snapshots at/before the message; no evidence falls back to current membership or the localized former-member label.
- Member avatar colors use the existing nine-color identity palette, hashed by member ID (not status/name). Explicit mention chips show sender → @recipient; no handoff is inferred from plain text.
- Agent responses longer than 1,200 characters or 16 lines start folded. A native button toggles the full response, exposes `aria-expanded`, and retains the original text. User messages are not folded.
- Execution rows show snapshot member name, real status, elapsed time and snapshot runtime. A native disclosure button supports click, Enter and Space. Only expanded rows mount the supplied real `CrewExecutionDetails`; no synthesized tool events or fake progress steps.
- Cancel and permission controls remain outside the disclosure, with pending guards. Recovery is shown only for active/recovery_required conversations; failed conversations remain able to send.
- The shared ai-elements conversation region is the independently scrolling flex child. Header and existing composer remain outside it; composer state is keyed by group/conversation/epoch. A late send only clears the existing draft when `result.ok && result.isCurrent()`.

## Acceptance evidence

Node tests exercise pure grouping/snapshot/chronology projection, actual component output and actual event callbacks using the existing transpile-and-hook-cell harness pattern. Cover disclosure mount/unmount, pending guards, send/cancel/recovery/permission targeting, long-response toggles, and foreign-conversation exclusion. This is not a browser E2E claim; parent integration owns real desktop/mobile checks and locales.

系统发送者以已有执行记录的中性“系统”折叠条呈现，状态、取消/审批均取真实 execution；不向只支持 user/member 的持久消息表伪造系统消息。会话头用成员名字首字作为头像，颜色复用现有 Agent 颜色函数。
