# Relay directory and group-save failure semantics

## Scope and ownership

- Browser directory selection uses the existing `systemService.info` and `fileService.readdir` services; crew mutations use the existing crew hook/RPC path and server CrewService/store. No additional runtime, accepted queue, or CLI changes.
- The connection owns pending RPC lifetimes. Terminal transport close rejects in-flight and pre-initialization calls; a replacement connection cannot replay an old create.
- DirectoryBrowser owns only the current navigation/loading/error state and draft path. A failed read is not an empty directory; older responses and unmounted requests cannot change current state.
- The crew request scope owns button pending/error state, cleared on success, explicit rejection, and a bounded foreground deadline. A deadline is not cancellation/rollback of server work: surface uncertain save outcome and require checking the group list before retrying; do not silently auto-resubmit create.

## Timing and errors

- Observed relay/connector close must fast-fail HTTP and WS forwarding without waiting for the browser fallback deadline. Pending channel opens must be aborted when their control connection ends or is superseded.
- Foreground directory reads and crew commands have a bounded fallback (25 seconds: relay channel-open default 10 seconds + connector local WS handshake default 10 seconds + 5 seconds margin). Clear deadline timers after settlement; ignore late results; preserve long-running task/session streams.
- Report authentication failure, filesystem permission failure, disconnected/unreachable service, and deadline separately in zh/en. Unknown failures retain useful concrete error text. Directory errors have an accessible alert and retry control; failed reads do not display “no subdirectories” or enable selecting stale paths.
- Directory navigation form submission stops React event propagation, including when rendered through a portal, so Enter/Go never submits the enclosing crew editor.
- Keep valid drafts on failed/uncertain save and restore actionable controls. No new dependencies.

```mermaid
sequenceDiagram
  participant UI as Browser / directory + crew scope
  participant RPC as Connection owner
  participant Relay as Relay + connector (forwarding only)
  participant PC as Existing ZCode services / CrewStore
  UI->>RPC: info / readdir / crew.create
  RPC->>Relay: existing channel request
  Relay->>PC: forward
  alt result
    PC-->>UI: result through same connection
  else observed disconnect
    Relay-->>RPC: HTTP failure / WS close
    RPC-->>UI: reject pending requests
  else no transport result before foreground deadline
    UI->>UI: clear pending, show timeout/uncertain-save error
  end
  Note over UI,PC: No automatic create replay; late result cannot navigate or overwrite a new draft
```

## Compatibility and validation

- Test historical create semantics (legacy minimal/catalog-member payload and relay settings available to the morning frontend) against current schema/service; malformed/version-incompatible payload must reject, not hang. The actual September 26 09:12 bundle is not assumed available; distinguish semantic fixture evidence from bundle verification.
- Extend existing relay/connector/ZCode fixture with real system/file service reads, known temporary directory entries, valid creates, pre/in-flight channel interruption and reconnect. Preserve authentication isolation and existing crew persistence/idempotency checks.
- Run real subprocess integration three times when TCP permitted; when sandbox rejects listening, report skipped real E2E explicitly and run existing memory-wire seam as supplementary, not equivalent evidence.
- Test UI retry/late-result races plus narrow layout (<1024px); run crew suites, relay tests, root typecheck/lint/architecture. Relay edits are delivered as a patch from a temporary writable copy, never write the external repo or deploy.
