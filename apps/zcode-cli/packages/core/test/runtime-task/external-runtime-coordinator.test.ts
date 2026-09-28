import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalRuntimeCoordinator,
  type ExternalRuntimeDispatchResult,
  type ExternalRuntimeQueueSnapshot,
  type ExternalRuntimeQueueStore,
} from "../../src/runtime-task/external-runtime-coordinator.js";
import type { ExternalRuntimeTaskRequest } from "@zcode/contracts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((inner) => {
    resolve = inner;
  });
  return { promise, resolve };
}

function readRequest(taskId: string, attemptId: string): ExternalRuntimeTaskRequest {
  return request(taskId, attemptId, {
    role: "reviewer",
    accessMode: "read",
    executionMode: "parallel",
    verification: { commandIds: [] },
  });
}

function readResult(): ExternalRuntimeDispatchResult {
  return { runtimeState: "succeeded", structuredResult: true };
}

class MemoryStore implements ExternalRuntimeQueueStore {
  saved: ExternalRuntimeQueueSnapshot[] = [];
  snapshot: ExternalRuntimeQueueSnapshot | undefined;
  load(): ExternalRuntimeQueueSnapshot | undefined {
    return this.snapshot;
  }
  save(snapshot: ExternalRuntimeQueueSnapshot): void {
    this.snapshot = snapshot;
    this.saved.push(snapshot);
  }
}

function request(taskId: string, attemptId: string, overrides = {}): ExternalRuntimeTaskRequest {
  return {
    schemaVersion: 1,
    taskId,
    attemptId,
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

function succeededWrite(): ExternalRuntimeDispatchResult {
  return { runtimeState: "succeeded", structuredResult: true, workspaceChanged: true, verification: "passed" };
}

test("sequential write tasks advance only with diff and passing verification", async () => {
  const store = new MemoryStore();
  const order: string[] = [];
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    execute: async (entry) => {
      order.push(entry.request.taskId);
      return succeededWrite();
    },
  });
  await coordinator.enqueue(request("task-1", "attempt-1"));
  await coordinator.enqueue(request("task-2", "attempt-2"));
  await coordinator.waitForIdle();
  assert.deepEqual(order, ["task-1", "task-2"]);
  const snapshot = await coordinator.load();
  assert.ok(snapshot.entries.every((entry) => entry.runtimeState === "succeeded"));
  assert.equal(snapshot.pauseReason, undefined);
});

test("write task without changes pauses the queue until resumed", async () => {
  const store = new MemoryStore();
  const order: string[] = [];
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    execute: async (entry) => {
      order.push(entry.request.taskId);
      if (entry.request.taskId === "task-1") {
        return { runtimeState: "succeeded", structuredResult: true, workspaceChanged: false };
      }
      return succeededWrite();
    },
  });
  await coordinator.enqueue(request("task-1", "attempt-1"));
  await coordinator.enqueue(request("task-2", "attempt-2"));
  await coordinator.waitForIdle();
  assert.deepEqual(order, ["task-1"]);
  let snapshot = await coordinator.load();
  assert.equal(snapshot.entries[0]?.runtimeState, "needs_verification");
  assert.ok(snapshot.pauseReason);
  await coordinator.resume();
  await coordinator.waitForIdle();
  assert.deepEqual(order, ["task-1", "task-2"]);
  snapshot = await coordinator.load();
  assert.equal(snapshot.pauseReason, undefined);
});

test("duplicate enqueue is idempotent and queued cancel marks cancelled", async () => {
  const store = new MemoryStore();
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    execute: async (entry) => {
      if (entry.request.taskId === "task-1") {
        return { runtimeState: "succeeded", structuredResult: true, workspaceChanged: false };
      }
      return succeededWrite();
    },
  });
  const first = await coordinator.enqueue(request("task-1", "attempt-1"));
  const second = await coordinator.enqueue(request("task-1", "attempt-1"));
  assert.equal(first.request.taskId, second.request.taskId);
  await coordinator.waitForIdle();
  await coordinator.enqueue(request("task-2", "attempt-2"));
  await coordinator.cancel("task-2");
  await coordinator.waitForIdle();
  const snapshot = await coordinator.load();
  assert.equal(snapshot.entries.length, 2);
  assert.equal(snapshot.entries[1]?.runtimeState, "cancelled");
});

test("parallel reads overlap while sequential tasks stay exclusive", async () => {
  const store = new MemoryStore();
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<ExternalRuntimeDispatchResult>>>();
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    execute: async (entry) => {
      started.push(entry.request.taskId);
      const gate = deferred<ExternalRuntimeDispatchResult>();
      gates.set(entry.request.taskId, gate);
      return gate.promise;
    },
  });
  await coordinator.enqueue(readRequest("read-1", "attempt-1"));
  await coordinator.enqueue(readRequest("read-2", "attempt-2"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ["read-1", "read-2"]);
  gates.get("read-1")!.resolve(readResult());
  gates.get("read-2")!.resolve(readResult());
  await coordinator.waitForIdle();
  const snapshot = await coordinator.load();
  assert.ok(snapshot.entries.every((entry) => entry.runtimeState === "succeeded"));
});

test("sequential tasks wait for in-flight parallel tasks and vice versa", async () => {
  const store = new MemoryStore();
  const started: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred<ExternalRuntimeDispatchResult>>>();
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    execute: async (entry) => {
      started.push(entry.request.taskId);
      const gate = deferred<ExternalRuntimeDispatchResult>();
      gates.set(entry.request.taskId, gate);
      return gate.promise;
    },
  });
  await coordinator.enqueue(readRequest("read-1", "attempt-1"));
  await coordinator.enqueue(request("write-1", "attempt-1"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ["read-1"]);
  gates.get("read-1")!.resolve(readResult());
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(started, ["read-1", "write-1"]);
  gates.get("write-1")!.resolve(succeededWrite());
  await coordinator.waitForIdle();
  const snapshot = await coordinator.load();
  assert.equal(snapshot.entries[1]?.runtimeState, "succeeded");
});

test("parallel launches respect the concurrency limit", async () => {
  const store = new MemoryStore();
  let concurrent = 0;
  let peak = 0;
  const gates = new Map<string, ReturnType<typeof deferred<ExternalRuntimeDispatchResult>>>();
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    maxParallel: 2,
    execute: async (entry) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      const gate = deferred<ExternalRuntimeDispatchResult>();
      gates.set(entry.request.taskId, gate);
      const result = await gate.promise;
      concurrent -= 1;
      return result;
    },
  });
  await coordinator.enqueue(readRequest("read-1", "attempt-1"));
  await coordinator.enqueue(readRequest("read-2", "attempt-2"));
  await coordinator.enqueue(readRequest("read-3", "attempt-3"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(peak, 2);
  for (const gate of gates.values()) gate.resolve(readResult());
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const gate of gates.values()) gate.resolve(readResult());
  await coordinator.waitForIdle();
  assert.equal(peak, 2);
  const snapshot = await coordinator.load();
  assert.ok(snapshot.entries.every((entry) => entry.runtimeState === "succeeded"));
});

test("recover marks interrupted entries without replaying them", async () => {
  const store = new MemoryStore();
  store.snapshot = {
    version: 1,
    entries: [
      {
        request: readRequest("read-1", "attempt-1"),
        runtimeState: "running",
        enqueuedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        request: readRequest("read-2", "attempt-2"),
        runtimeState: "queued",
        enqueuedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
  const started: string[] = [];
  const coordinator = new ExternalRuntimeCoordinator({
    store,
    execute: async (entry) => {
      started.push(entry.request.taskId);
      return readResult();
    },
  });
  await coordinator.recover();
  await coordinator.waitForIdle();
  const snapshot = await coordinator.load();
  assert.equal(snapshot.entries[0]?.runtimeState, "recovery_required");
  assert.equal(snapshot.entries[1]?.runtimeState, "queued");
  assert.deepEqual(started, []);
  await assert.rejects(coordinator.resume(), /recovery_required/);
});
