import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createExternalRuntimeFacade } from "../../src/app/external-runtime.js";
import { SqliteExternalRuntimeQueueStore } from "../../../adapters/src/storage/session-store/repositories/external-runtime-queue.js";
import { EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0023-external-runtime-queue.js";
import { EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0024-external-runtime-native-session.js";
import {
  deferred,
  event,
  fixture,
  request,
  terminal,
  timestamp,
} from "../../../core/test/runtime-task/crew-runtime-fixture.js";

const probe = {
  action: "probe" as const,
  runtimeId: "claude-cli" as const,
  accessMode: "read" as const,
};
const start = {
  action: "start" as const,
  taskId: "crew_ext_new",
  runtimeId: "claude-cli" as const,
  sessionId: "crew_context",
  traceId: "trace",
  objective: "Review",
  accessMode: "read" as const,
};
async function setup(hold = false) {
  const root = await mkdtemp(join(tmpdir(), "crew-observer-"));
  const dbPath = join(root, "queue.db");
  const db = new DatabaseSync(dbPath);
  db.exec(EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL);
  db.exec(EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL);
  const gate = deferred();
  const began = deferred();
  const { adapter, starts } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    began.resolve();
    if (hold) await gate.promise;
    yield terminal(req, 2);
  });
  const scope = { workspaceIdentity: "workspace-1", workspacePath: root };
  const store = new SqliteExternalRuntimeQueueStore(db, scope);
  const options = {
    dbPath,
    workingDirectory: root,
    workspaceIdentity: scope.workspaceIdentity,
    cliStorageRoot: root,
    outerSandboxReady: true,
    adapters: new Map([["claude-cli", adapter]]),
  };
  const seed = () =>
    store.save({
      version: 1,
      entries: [
        {
          request: request({
            taskId: "crew_ext_old",
            workspace: { identity: scope.workspaceIdentity, path: root, kind: "git" },
          }),
          runtimeState: "queued",
          settled: false,
          enqueuedAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
  const cleanup = async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  };
  return { options, store, gate, began, starts, seed, cleanup };
}

test("observer creation/probe/read/cancel cannot mutate another Host's live task", async () => {
  const f = await setup(true);
  const owner = await createExternalRuntimeFacade(f.options);
  let observer: Awaited<ReturnType<typeof createExternalRuntimeFacade>> | undefined;
  try {
    await owner.crewRuntime(start);
    await f.began.promise;
    const before = f.store.load();
    observer = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
    await observer.crewRuntime(probe);
    const view = await observer.crewRuntime({ action: "read", taskId: start.taskId });
    assert.deepEqual(f.store.load(), before);
    assert.equal(view.kind, "task");
    if (view.kind === "task") {
      assert.equal(view.task.runtimeState, "recovery_required");
      assert.equal(view.task.settled, false);
    }
    await observer.crewRuntime({ action: "cancel", taskId: start.taskId });
    assert.deepEqual(f.store.load(), before);
    await observer.shutdown();
    observer = undefined;
    assert.deepEqual(f.store.load(), before);
    assert.equal(f.starts.length, 1);
  } finally {
    observer?.dispose();
    f.gate.resolve();
    await owner.service.waitForIdle();
    owner.dispose();
    await f.cleanup();
  }
});

test("observer creation/probe/shutdown neither pumps nor rewrites persisted queued work", async () => {
  const f = await setup();
  f.seed();
  const before = f.store.load();
  const observer = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  try {
    await observer.crewRuntime(probe);
    await observer.service.waitForIdle();
    assert.equal(f.starts.length, 0);
    assert.deepEqual(f.store.load(), before);
  } finally {
    await observer.shutdown();
  }
  try {
    assert.deepEqual(f.store.load(), before);
    assert.equal(f.starts.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("observer reads fresh owner completion before acquiring lease and starting once", async () => {
  const f = await setup(true);
  const owner = await createExternalRuntimeFacade(f.options);
  const observer = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  try {
    await owner.crewRuntime(start);
    await f.began.promise;
    await observer.crewRuntime({ action: "read", taskId: start.taskId });
    f.gate.resolve();
    await owner.service.waitForIdle();
    const view = await observer.crewRuntime({ action: "read", taskId: start.taskId });
    if (view.kind === "task") {
      assert.equal(view.task.runtimeState, "succeeded");
      assert.equal(view.task.settled, true);
    }
    await observer.crewRuntime({ ...start, taskId: "crew_ext_next" });
    await observer.service.waitForIdle();
    assert.deepEqual(
      f.starts.map((req) => req.taskId),
      [start.taskId, "crew_ext_next"],
    );
  } finally {
    f.gate.resolve();
    await owner.service.waitForIdle();
    owner.dispose();
    await observer.shutdown();
    await f.cleanup();
  }
});

test("explicit first start fences inherited queued work instead of executing it under a new lease", async () => {
  const f = await setup();
  f.seed();
  const observer = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  try {
    await assert.rejects(observer.crewRuntime(start), /fenced/);
    assert.equal(f.starts.length, 0);
    assert.equal(f.store.load()?.entries[0]?.runtimeState, "recovery_required");
  } finally {
    await observer.shutdown();
    await f.cleanup();
  }
});

test("legacy facade default still recovers and executes queued work on creation", async () => {
  const f = await setup();
  f.seed();
  const legacy = await createExternalRuntimeFacade(f.options);
  try {
    await legacy.service.waitForIdle();
    assert.deepEqual(
      f.starts.map((req) => req.taskId),
      ["crew_ext_old"],
    );
  } finally {
    legacy.dispose();
    await f.cleanup();
  }
});

test("A to B to A leased handoff keeps all three durable results", async () => {
  const f = await setup();
  const a = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  const b = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  try {
    await a.crewRuntime({ ...start, taskId: "crew_ext_A" });
    await a.service.waitForIdle();
    await b.crewRuntime({ ...start, taskId: "crew_ext_B" });
    await b.service.waitForIdle();
    const beforeQuery = f.store.load();
    await a.crewRuntime(probe);
    await a.crewRuntime({ action: "read", taskId: "crew_ext_A" });
    // Host 在新 start 前读取 resume 候选，不能依赖 prepareCrewStart 才发现 B 的结果。
    const candidate = await a.crewRuntime({ action: "read", taskId: "crew_ext_B" });
    assert.equal(candidate.kind, "task");
    if (candidate.kind === "task") {
      assert.equal(candidate.task.runtimeState, "succeeded");
      assert.equal(candidate.task.settled, true);
      assert.equal(candidate.task.summary, "structured fixture summary");
      assert.equal(candidate.task.nativeSessionId, "native-1");
    }
    assert.deepEqual(f.store.load(), beforeQuery);
    await a.crewRuntime({ ...start, taskId: "crew_ext_C", resumeTaskId: "crew_ext_B" });
    await a.service.waitForIdle();
    assert.equal(f.starts[2]?.resumeNativeSessionId, "native-1");
    const saved = f.store.load()!.entries;
    assert.deepEqual(
      saved.map((entry) => entry.request.taskId),
      ["crew_ext_A", "crew_ext_B", "crew_ext_C"],
    );
    assert.ok(
      saved.every(
        (entry) =>
          entry.runtimeState === "succeeded" &&
          entry.settled === true &&
          entry.summary === "structured fixture summary",
      ),
    );
    assert.deepEqual(
      f.starts.map((req) => req.taskId),
      ["crew_ext_A", "crew_ext_B", "crew_ext_C"],
    );
    const reopened = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
    try {
      for (const taskId of ["crew_ext_A", "crew_ext_B", "crew_ext_C"]) {
        const result = await reopened.crewRuntime({ action: "read", taskId });
        assert.equal(result.kind, "task");
        if (result.kind === "task") assert.equal(result.task.summary, "structured fixture summary");
      }
    } finally {
      await reopened.shutdown();
    }
  } finally {
    await a.shutdown();
    await b.shutdown();
    await f.cleanup();
  }
});

test("repeated owned start while active does not refresh or replay the live attempt", async () => {
  const f = await setup(true);
  const a = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  try {
    await a.crewRuntime(start);
    await f.began.promise;
    const before = f.store.load();
    const result = await a.crewRuntime(start);
    assert.equal(result.kind, "task");
    if (result.kind === "task") {
      assert.equal(result.task.runtimeState, "running");
      assert.equal(result.task.settled, false);
    }
    assert.deepEqual(f.store.load(), before);
    assert.equal(f.starts.length, 1);
  } finally {
    f.gate.resolve();
    await a.service.waitForIdle();
    await a.shutdown();
    await f.cleanup();
  }
});

test("idle handoff refresh fences foreign queued work without replaying it", async () => {
  const f = await setup();
  const a = await createExternalRuntimeFacade({ ...f.options, recoverOnCreate: false });
  try {
    await a.crewRuntime(start);
    await a.service.waitForIdle();
    const before = f.store.load()!;
    const previous = before.entries[0]!;
    f.store.save({
      ...before,
      entries: [
        ...before.entries,
        {
          request: {
            ...previous.request,
            taskId: "crew_ext_foreign",
            attemptId: "foreign-attempt",
          },
          runtimeState: "queued",
          settled: false,
          enqueuedAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });
    await assert.rejects(a.crewRuntime({ ...start, taskId: "crew_ext_next" }), /fenced/);
    assert.deepEqual(
      f.starts.map((req) => req.taskId),
      [start.taskId],
    );
    assert.deepEqual(
      f.store.load()!.entries.map((entry) => entry.runtimeState),
      ["succeeded", "recovery_required"],
    );
  } finally {
    await a.shutdown();
    await f.cleanup();
  }
});

test("idle repeated start preserves locally pending permission instead of refreshing it away", async () => {
  const f = await setup();
  const { adapter } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "pending" });
    yield terminal(req, 3, "failed");
  });
  const a = await createExternalRuntimeFacade({
    ...f.options,
    recoverOnCreate: false,
    adapters: new Map([["claude-cli", adapter]]),
  });
  try {
    await a.crewRuntime(start);
    await a.service.waitForIdle();
    const before = f.store.load();
    const repeated = await a.crewRuntime(start);
    assert.equal(repeated.kind, "task");
    if (repeated.kind === "task") {
      assert.equal(repeated.task.runtimeState, "awaiting_permission");
      assert.equal(repeated.task.permission?.requestId, "pending");
    }
    assert.deepEqual(f.store.load(), before);
    await a.crewRuntime({ action: "cancel", taskId: start.taskId });
  } finally {
    await a.shutdown();
    await f.cleanup();
  }
});

test("read keeps live supervised permission instead of replacing it with the durable projection", async () => {
  const f = await setup();
  const requested = deferred();
  const stopped = deferred();
  const { adapter } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "live-pending" });
    requested.resolve();
    await stopped.promise;
    yield terminal(req, 3, "cancelled");
  });
  adapter.cancel = async () => {
    stopped.resolve();
  };
  const a = await createExternalRuntimeFacade({
    ...f.options,
    recoverOnCreate: false,
    adapters: new Map([["claude-cli", adapter]]),
  });
  try {
    await a.crewRuntime(start);
    await requested.promise;
    const before = f.store.load();
    const result = await a.crewRuntime({ action: "read", taskId: start.taskId });
    assert.equal(result.kind, "task");
    if (result.kind === "task") {
      assert.equal(result.task.runtimeState, "awaiting_permission");
      assert.equal(result.task.permission?.requestId, "live-pending");
      assert.equal(result.task.settled, false);
    }
    assert.deepEqual(f.store.load(), before);
    await a.crewRuntime({ action: "cancel", taskId: start.taskId });
  } finally {
    stopped.resolve();
    await a.shutdown();
    await f.cleanup();
  }
});
