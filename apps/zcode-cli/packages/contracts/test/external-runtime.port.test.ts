import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalRuntimeCapabilityReportSchema,
  ExternalRuntimeResultSchema,
  ExternalRuntimeTaskRequestSchema,
  KNOWN_EXTERNAL_RUNTIME_EVENT_TYPES,
  mapExternalRuntimeStateToSubagentStatus,
  normalizeExternalRuntimeEventType,
  validateExternalRuntimeEventSequence,
} from "../src/interfaces/external-runtime.port.js";

const timestamp = "2026-09-24T00:00:00.000Z";

function request(overrides = {}) {
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
    objective: "run a bounded external task",
    boundaries: ["do not escape workspace"],
    workspace: { identity: "workspace-1", path: "/workspace", kind: "git", branch: "main" },
    baseline: { kind: "git", ref: "abc123" },
    instructionSnapshotRef: "instructions-1",
    timeoutMs: 60_000,
    budget: { wallTimeMs: 60_000, maxOutputBytes: 1024 },
    verification: { commandIds: ["unit"] },
    retention: { structuredDays: 30, rawDays: 7 },
    sessionMode: "one-shot",
    executionMode: "sequential",
    failoverPolicy: "none",
    ...overrides,
  };
}

function envelope(sequence: number, type: string, payload: unknown = {}) {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    taskId: "task-1",
    attemptId: "attempt-1",
    runtimeId: "fake-cli",
    timestamp,
    type,
    payload,
  };
}

function result(overrides = {}) {
  return {
    schemaVersion: 1,
    taskId: "task-1",
    attemptId: "attempt-1",
    runtimeId: "fake-cli",
    status: "succeeded",
    runtimeState: "succeeded",
    summary: "done",
    completedAt: timestamp,
    artifacts: [],
    ...overrides,
  };
}

test("valid write request passes with failover none", () => {
  const parsed = ExternalRuntimeTaskRequestSchema.parse(request());
  assert.equal(parsed.taskId, "task-1");
  assert.equal(parsed.executionMode, "sequential");
});

test("write tasks cannot enable runtime failover", () => {
  assert.throws(() => ExternalRuntimeTaskRequestSchema.parse(request({ failoverPolicy: "read-only" })));
});

test("reviewer tasks must be read-only", () => {
  assert.throws(() => ExternalRuntimeTaskRequestSchema.parse(request({ role: "reviewer" })));
});

test("capability report accepts warnings and defaults testedVersion", () => {
  const parsed = ExternalRuntimeCapabilityReportSchema.parse({
    schemaVersion: 1,
    runtimeId: "fake-cli",
    available: true,
    authenticated: true,
    capabilities: { structuredOutput: true },
    requiredCapabilities: ["structuredOutput"],
    warnings: ["newer than tested"],
    probedAt: timestamp,
  });
  assert.equal(parsed.testedVersion, false);
  assert.deepEqual(parsed.warnings, ["newer than tested"]);
});

test("terminal result status must match runtimeState", () => {
  assert.doesNotThrow(() => ExternalRuntimeResultSchema.parse(result()));
  assert.throws(() =>
    ExternalRuntimeResultSchema.parse(result({ status: "succeeded", runtimeState: "failed" })),
  );
});

test("runtime states map to existing subagent statuses without expanding them", () => {
  assert.equal(mapExternalRuntimeStateToSubagentStatus("succeeded"), "completed");
  assert.equal(mapExternalRuntimeStateToSubagentStatus("failed"), "failed");
  assert.equal(mapExternalRuntimeStateToSubagentStatus("cancelled"), "killed");
  assert.equal(mapExternalRuntimeStateToSubagentStatus("needs_verification"), "running");
  assert.equal(mapExternalRuntimeStateToSubagentStatus("recovery_required"), "running");
});

test("unknown vendor events are preserved for warning mapping", () => {
  assert.equal(normalizeExternalRuntimeEventType("task.started"), "task.started");
  assert.equal(normalizeExternalRuntimeEventType("vendor.something_new"), "unknown");
  assert.ok(KNOWN_EXTERNAL_RUNTIME_EVENT_TYPES.includes("task.completed"));
});

test("event sequence requires start, contiguity, attempt scope, and terminal result", () => {
  const events = validateExternalRuntimeEventSequence([
    envelope(1, "task.started", { runtimeState: "running" }),
    envelope(2, "assistant.message", { text: "working" }),
    envelope(3, "task.completed", result()),
  ]);
  assert.equal(events.length, 3);
  assert.throws(() =>
    validateExternalRuntimeEventSequence([
      envelope(2, "task.started"),
      envelope(3, "task.completed", result()),
    ]),
  );
  assert.throws(() =>
    validateExternalRuntimeEventSequence([
      envelope(1, "task.started"),
      envelope(3, "task.completed", result()),
    ]),
  );
  assert.throws(() =>
    validateExternalRuntimeEventSequence([
      envelope(1, "task.started"),
      envelope(2, "assistant.message"),
    ]),
  );
});
