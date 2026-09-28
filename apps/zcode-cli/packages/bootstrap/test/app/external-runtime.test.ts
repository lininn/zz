import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { createExternalRuntimeFacade } from "../../src/app/external-runtime.js";
import { EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0023-external-runtime-queue.js";
import { EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0024-external-runtime-native-session.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function migrate(dbPath: string): Promise<void> {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL);
    db.exec(EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL);
  } finally {
    db.close();
  }
}

async function facade(workspace: string) {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-facade-"));
  roots.push(root);
  const dbPath = join(root, "queue.db");
  await migrate(dbPath);
  return createExternalRuntimeFacade({
    dbPath,
    workingDirectory: workspace,
    workspaceIdentity: workspace,
    cliStorageRoot: join(root, "cli"),
    outerSandboxReady: false,
  });
}

function input(overrides = {}) {
  return {
    role: "reviewer" as const,
    accessMode: "read" as const,
    executionMode: "sequential" as const,
    objective: "bounded task",
    verificationCommands: [],
    skipVerification: false,
    networkProfile: "restricted" as const,
    allowDirtyWorkspace: false,
    useWorktree: false,
    unsafeTextFallback: false,
    sessionId: "sess_1",
    traceId: "trace-1",
    ...overrides,
  };
}

test("parallel writes without isolated workspaces are rejected before spawning", async () => {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-ws-"));
  roots.push(root);
  const handle = await facade(root);
  try {
    await assert.rejects(
      handle.dispatchExternalRuntime(
        input({ role: "executor", accessMode: "write", executionMode: "parallel" }),
      ),
      /isolated workspace/,
    );
  } finally {
    handle.dispose();
  }
});

test("chat requires a prior attempt with a native session", async () => {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-ws-"));
  roots.push(root);
  const handle = await facade(root);
  try {
    await assert.rejects(
      handle.dispatchExternalRuntime(input({ chatTaskId: "task-9" })),
      /No completed attempt with a native session/,
    );
    assert.deepEqual(await handle.listExternalRuntimeTasks(), []);
  } finally {
    handle.dispose();
  }
});

test("cancel and cleanup report unknown tasks without side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-ws-"));
  roots.push(root);
  const handle = await facade(root);
  try {
    assert.deepEqual(await handle.cancelExternalRuntimeTask({ taskId: "task-9" }), { cancelled: false });
    const cleaned = await handle.cleanupExternalRuntimeTask({ taskId: "task-9" });
    assert.equal(cleaned.cleaned, false);
    assert.match(cleaned.detail ?? "", /Unknown task/);
  } finally {
    handle.dispose();
  }
});

test("unverified sandboxes fail closed before spawning", async () => {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-ws-"));
  roots.push(root);
  const handle = await facade(root);
  try {
    const outcome = await handle.dispatchExternalRuntime(
      input({ role: "executor", accessMode: "write" }),
    );
    await handle.service.waitForIdle();
    const tasks = await handle.listExternalRuntimeTasks();
    assert.equal(tasks[0]?.runtimeState, "runtime_unavailable");
    assert.equal(tasks[0]?.taskId, outcome.taskId);
  } finally {
    handle.dispose();
  }
});
