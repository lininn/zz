import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  ExternalRuntimeQueueSnapshot,
  ExternalRuntimeTaskRequest,
} from "@zcode/contracts";
import { EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL } from "../../src/storage/session-store/migrations/0023-external-runtime-queue.js";
import { EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL } from "../../src/storage/session-store/migrations/0024-external-runtime-native-session.js";
import { SqliteExternalRuntimeQueueStore } from "../../src/storage/session-store/repositories/external-runtime-queue.js";

function openDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL);
  db.exec(EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL);
  return db;
}

function request(taskId: string, attemptId: string): ExternalRuntimeTaskRequest {
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
  } as ExternalRuntimeTaskRequest;
}

function snapshot(): ExternalRuntimeQueueSnapshot {
  return {
    version: 1,
    pauseReason: "task requires intervention: needs_verification",
    entries: [
      {
        request: request("task-1", "attempt-1"),
        runtimeState: "needs_verification",
        pauseReason: "write task made no change",
        nativeSessionId: "session-1",
        enqueuedAt: timestamp(),
        updatedAt: timestamp(),
      },
      {
        request: request("task-2", "attempt-2"),
        runtimeState: "queued",
        enqueuedAt: timestamp(),
        updatedAt: timestamp(),
      },
    ],
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

test("empty queue loads as undefined", () => {
  const db = openDatabase();
  try {
    assert.equal(new SqliteExternalRuntimeQueueStore(db).load(), undefined);
  } finally {
    db.close();
  }
});

test("save and load round-trips entries, states, and pause reasons", () => {
  const db = openDatabase();
  try {
    const store = new SqliteExternalRuntimeQueueStore(db);
    store.save(snapshot());
    const loaded = store.load();
    assert.ok(loaded);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.pauseReason, "task requires intervention: needs_verification");
    assert.equal(loaded.entries.length, 2);
    assert.equal(loaded.entries[0]?.runtimeState, "needs_verification");
    assert.equal(loaded.entries[0]?.pauseReason, "write task made no change");
    assert.equal(loaded.entries[0]?.request.objective, "bounded task");
    assert.equal(loaded.entries[0]?.nativeSessionId, "session-1");
    assert.equal(loaded.entries[1]?.nativeSessionId, undefined);
    assert.equal(loaded.entries[1]?.runtimeState, "queued");
    assert.equal(loaded.entries[1]?.pauseReason, undefined);
  } finally {
    db.close();
  }
});

test("save overwrites the previous snapshot without duplicating rows", () => {
  const db = openDatabase();
  try {
    const store = new SqliteExternalRuntimeQueueStore(db);
    store.save(snapshot());
    const next = snapshot();
    next.entries = next.entries.slice(0, 1);
    next.entries[0]!.runtimeState = "succeeded";
    delete next.entries[0]!.pauseReason;
    delete next.pauseReason;
    store.save(next);
    const loaded = store.load();
    assert.ok(loaded);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0]?.runtimeState, "succeeded");
    assert.equal(loaded.pauseReason, undefined);
  } finally {
    db.close();
  }
});

test("a second store instance sees the same durable state", () => {
  const db = openDatabase();
  try {
    new SqliteExternalRuntimeQueueStore(db).save(snapshot());
    const loaded = new SqliteExternalRuntimeQueueStore(db).load();
    assert.ok(loaded);
    assert.equal(loaded.entries.length, 2);
  } finally {
    db.close();
  }
});

test("corrupt request payloads fail closed with task identity", () => {
  const db = openDatabase();
  try {
    db.prepare(
      `
      insert into external_runtime_task (
        task_id, attempt_id, request_json, runtime_state, pause_reason, enqueued_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?)
      `,
    ).run("task-9", "attempt-9", "{not-json", "queued", null, timestamp(), timestamp());
    assert.throws(
      () => new SqliteExternalRuntimeQueueStore(db).load(),
      /task-9.*attempt-9|attempt-9.*task-9/,
    );
  } finally {
    db.close();
  }
});

test("unsupported snapshot versions are rejected", () => {
  const db = openDatabase();
  try {
    const foreign = JSON.parse(JSON.stringify({ version: 2, entries: [] })) as ExternalRuntimeQueueSnapshot;
    assert.throws(() => new SqliteExternalRuntimeQueueStore(db).save(foreign));
  } finally {
    db.close();
  }
});
