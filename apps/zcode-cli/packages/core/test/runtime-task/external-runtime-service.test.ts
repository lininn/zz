import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalRuntimeDispatchService,
  describeExternalRuntimeQueueEntry,
  type ExternalRuntimeServiceVerificationCommand,
} from "../../src/runtime-task/external-runtime-service.js";
import type {
  ExternalRuntimeQueueSnapshot,
  ExternalRuntimeQueueStore,
} from "../../src/runtime-task/external-runtime-coordinator.js";
import type {
  ExternalRuntimeEventEnvelope,
  ExternalRuntimePort,
  ExternalRuntimeTaskRequest,
} from "@zcode/contracts";
import { InMemoryRuntimeTaskRegistry } from "../../src/runtime-task/registry.js";

const timestamp = "2026-09-24T00:00:00.000Z";

class MemoryStore implements ExternalRuntimeQueueStore {
  snapshot: ExternalRuntimeQueueSnapshot | undefined;
  load(): ExternalRuntimeQueueSnapshot | undefined {
    return this.snapshot;
  }
  save(snapshot: ExternalRuntimeQueueSnapshot): void {
    this.snapshot = snapshot;
  }
}

function request(overrides = {}): ExternalRuntimeTaskRequest {
  return {
    schemaVersion: 1,
    taskId: "task-1",
    attemptId: "attempt-1",
    sessionId: "sess_1",
    traceId: "trace-1",
    runtimeId: "fake-cli",
    role: "executor",
    accessMode: "write",
    networkProfile: "restricted",
    objective: "bounded task",
    boundaries: ["do not escape workspace"],
    workspace: { identity: "workspace-1", path: "/workspace", kind: "git", branch: "main" },
    baseline: { kind: "git", ref: "abc123" },
    instructionSnapshotRef: "instructions-1",
    timeoutMs: 60_000,
    budget: { wallTimeMs: 60_000 },
    verification: { commandIds: ["unit"] },
    retention: { structuredDays: 30, rawDays: 7 },
    sessionMode: "one-shot",
    executionMode: "sequential",
    failoverPolicy: "none",
    ...overrides,
  } as ExternalRuntimeTaskRequest;
}

function envelope(
  req: ExternalRuntimeTaskRequest,
  sequence: number,
  type: string,
  payload: unknown = {},
): ExternalRuntimeEventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    taskId: req.taskId,
    attemptId: req.attemptId,
    runtimeId: req.runtimeId,
    timestamp,
    type,
    payload,
  };
}

function terminalPayload(req: ExternalRuntimeTaskRequest, nativeSessionId = "session-7") {
  return {
    schemaVersion: 1,
    taskId: req.taskId,
    attemptId: req.attemptId,
    runtimeId: req.runtimeId,
    status: "succeeded",
    runtimeState: "succeeded",
    summary: "done",
    completedAt: timestamp,
    nativeSessionId,
    artifacts: [],
  };
}

function sessionedEnvelope(req: ExternalRuntimeTaskRequest, sequence: number): ExternalRuntimeEventEnvelope {
  return { ...envelope(req, sequence, "assistant.message", { text: "working" }), nativeSessionId: "session-7" };
}

function successEvents(req: ExternalRuntimeTaskRequest): ExternalRuntimeEventEnvelope[] {
  return [
    envelope(req, 1, "task.started", { runtimeState: "running" }),
    envelope(req, 2, "assistant.message", { text: "working" }),
    envelope(req, 3, "task.completed", terminalPayload(req)),
  ];
}

class FakeAdapter implements ExternalRuntimePort {
  starts: ExternalRuntimeTaskRequest[] = [];
  cancellations = 0;
  available = true;
  failures: string[] = [];
  constructor(private readonly script: (req: ExternalRuntimeTaskRequest) => ExternalRuntimeEventEnvelope[] | never) {}

  async probe() {
    return {
      schemaVersion: 1 as const,
      runtimeId: "fake-cli",
      available: this.available,
      testedVersion: true,
      authenticated: true,
      capabilities: { structuredOutput: true, structuredTerminalResult: true, permissionMode: true },
      requiredCapabilities: [],
      warnings: [...this.failures],
      probedAt: timestamp,
    };
  }

  async *start(req: ExternalRuntimeTaskRequest) {
    this.starts.push(req);
    yield* this.script(req);
  }

  async interrupt(): Promise<void> {}

  async cancel(): Promise<void> {
    this.cancellations += 1;
  }
}

function service(
  adapter: FakeAdapter,
  overrides: {
    clean?: boolean;
    changed?: boolean;
    conflict?: boolean;
    verification?: "passed" | "failed";
  } = {},
) {
  const resolved: string[][] = [];
  return {
    resolved,
    instance: new ExternalRuntimeDispatchService({
      adapters: new Map([["fake-cli", adapter]]),
      store: new MemoryStore(),
      outerSandboxReady: true,
      allowDirtyWorkspace: false,
      beginWorkspaceGuard: async () => ({
        isClean: async () => overrides.clean ?? true,
        detectChanges: async () => ({
          changed: overrides.changed ?? true,
          conflict: overrides.conflict ?? false,
        }),
      }),
      resolveVerificationCommands: (commandIds): ExternalRuntimeServiceVerificationCommand[] => {
        resolved.push([...commandIds]);
        return commandIds.map((id) => ({ id, argv: ["unit-cmd", id] }));
      },
      runVerification: async () => ({ status: overrides.verification ?? "passed" }),
    }),
  };
}

test("write success path advances with diff and passing verification", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const harness = service(adapter);
  const outcome = await harness.instance.dispatch(request());
  assert.equal(outcome.taskId, "task-1");
  assert.equal(outcome.queuePosition, 1);
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "succeeded");
  assert.deepEqual(harness.resolved, [["unit"]]);
  assert.match(describeExternalRuntimeQueueEntry(snapshot, "task-1"), /state succeeded/);
});

test("terminal native session ids persist on the queue record", async () => {
  const adapter = new FakeAdapter((req) => [
    envelope(req, 1, "task.started", { runtimeState: "running" }),
    sessionedEnvelope(req, 2),
    { ...envelope(req, 3, "task.completed", terminalPayload(req)), nativeSessionId: "session-7" },
  ]);
  const harness = service(adapter);
  await harness.instance.dispatch(request());
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "succeeded");
  assert.equal(snapshot.entries[0]?.nativeSessionId, "session-7");
});

test("unresolved permission requests pause the queue", async () => {
  const adapter = new FakeAdapter((req) => [
    envelope(req, 1, "task.started", { runtimeState: "running" }),
    envelope(req, 2, "permission.requested", { request_id: "p-1" }),
    envelope(req, 3, "task.completed", terminalPayload(req)),
  ]);
  const harness = service(adapter);
  await harness.instance.dispatch(request({ taskId: "task-1", attemptId: "attempt-1" }));
  await harness.instance.dispatch(request({ taskId: "task-2", attemptId: "attempt-2" }));
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "awaiting_permission");
  assert.equal(snapshot.entries[1]?.runtimeState, "queued");
  assert.match(describeExternalRuntimeQueueEntry(snapshot, "task-1"), /awaiting_permission/);
});

test("failed verification pauses with failure state", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const harness = service(adapter, { verification: "failed" });
  await harness.instance.dispatch(request());
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "failed");
  assert.match(snapshot.pauseReason ?? "", /verification/);
});

test("dirty workspace blocks write tasks before spawning", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const harness = service(adapter, { clean: false });
  await harness.instance.dispatch(request());
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "workspace_unsupported");
  assert.equal(adapter.starts.length, 0);
});

test("workspace conflicts pause with apply_conflict state", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const harness = service(adapter, { conflict: true });
  await harness.instance.dispatch(request());
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "apply_conflict");
  assert.match(snapshot.pauseReason ?? "", /pre-existing workspace content/);
});

test("parallel writes without isolated workspaces are rejected at dispatch", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const harness = service(adapter);
  await assert.rejects(
    harness.instance.dispatch(request({ executionMode: "parallel" })),
    /isolated workspace/,
  );
  assert.equal(adapter.starts.length, 0);
  await harness.instance.dispatch(
    request({
      taskId: "task-iso",
      attemptId: "attempt-iso",
      executionMode: "parallel",
      workspace: { identity: "workspace-1", path: "/worktree-1", kind: "git", branch: "main", isolated: true },
    }),
  );
  await harness.instance.waitForIdle();
  assert.equal((await harness.instance.snapshot()).entries[0]?.runtimeState, "succeeded");
});

test("policy violations and protocol errors pause with explicit states", async () => {
  const violating = new FakeAdapter(() => {
    throw new Error("policy_violation: external runtime attempted delegation (subagent_started)");
  });
  const violatingHarness = service(violating);
  await violatingHarness.instance.dispatch(request());
  await violatingHarness.instance.waitForIdle();
  assert.equal((await violatingHarness.instance.snapshot()).entries[0]?.runtimeState, "policy_violation");

  const broken = new FakeAdapter((req) => [
    envelope(req, 1, "task.started", { runtimeState: "running" }),
    envelope(req, 2, "assistant.message", { text: "working" }),
  ]);
  const brokenHarness = service(broken);
  await brokenHarness.instance.dispatch(request());
  await brokenHarness.instance.waitForIdle();
  assert.equal((await brokenHarness.instance.snapshot()).entries[0]?.runtimeState, "protocol_error");
});

test("unregistered runtimes and unavailable preflight fail closed", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  adapter.available = false;
  adapter.failures = ["binary_not_found"];
  const harness = service(adapter);
  await harness.instance.dispatch(request());
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "runtime_unavailable");
  assert.equal(adapter.starts.length, 0);

  const empty = new ExternalRuntimeDispatchService({
    adapters: new Map(),
    store: new MemoryStore(),
    outerSandboxReady: true,
    allowDirtyWorkspace: false,
    beginWorkspaceGuard: async () => ({
      isClean: async () => true,
      detectChanges: async () => ({ changed: true, conflict: false }),
    }),
    resolveVerificationCommands: () => [],
    runVerification: async () => ({ status: "passed" as const }),
  });
  await empty.dispatch(request({ runtimeId: "missing-cli" }));
  await empty.waitForIdle();
  assert.equal((await empty.snapshot()).entries[0]?.runtimeState, "runtime_unavailable");
});

test("task snapshots project into the runtime task registry", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const taskRegistry = new InMemoryRuntimeTaskRegistry();
  const projecting = new ExternalRuntimeDispatchService({
    adapters: new Map([["fake-cli", adapter]]),
    store: new MemoryStore(),
    outerSandboxReady: true,
    allowDirtyWorkspace: false,
    beginWorkspaceGuard: async () => ({
      isClean: async () => true,
      detectChanges: async () => ({ changed: true, conflict: false }),
    }),
    resolveVerificationCommands: (commandIds) => commandIds.map((id) => ({ id, argv: ["unit-cmd"] })),
    runVerification: async () => ({ status: "passed" }),
    taskRegistry,
  });
  await projecting.dispatch(request());
  await projecting.waitForIdle();
  const projected = taskRegistry.get("task-1");
  assert.ok(projected);
  assert.equal(projected.type, "external_runtime");
  assert.equal(projected.status, "completed");
  assert.equal(projected.description, "bounded task");
  assert.ok(projected.completedAt);
});

test("read tasks succeed without workspace changes or verification", async () => {
  const adapter = new FakeAdapter((req) => successEvents(req));
  const harness = service(adapter);
  await harness.instance.dispatch(
    request({ role: "reviewer", accessMode: "read", verification: { commandIds: [] } }),
  );
  await harness.instance.waitForIdle();
  const snapshot = await harness.instance.snapshot();
  assert.equal(snapshot.entries[0]?.runtimeState, "succeeded");
  assert.deepEqual(harness.resolved, []);
});
