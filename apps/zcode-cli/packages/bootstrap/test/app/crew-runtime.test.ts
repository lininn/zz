import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ExternalRuntimeTaskRequest } from "@zcode/contracts";
import { createExternalRuntimeFacade } from "../../src/app/external-runtime.js";
import { fixture, event, terminal } from "../../../core/test/runtime-task/crew-runtime-fixture.js";
import { EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0023-external-runtime-queue.js";
import { EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0024-external-runtime-native-session.js";

function command(taskId = "crew_ext_1", overrides = {}) {
  return {
    action: "start" as const,
    taskId,
    runtimeId: "claude-cli" as const,
    sessionId: "crew_context_1",
    traceId: "trace-1",
    objective: "Review fixture",
    accessMode: "read" as const,
    ...overrides,
  };
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "crew-facade-"));
  const dbPath = join(root, "queue.db");
  const db = new DatabaseSync(dbPath);
  db.exec(EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL);
  db.exec(EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL);
  db.close();
  const starts: ExternalRuntimeTaskRequest[] = [];
  const { adapter } = fixture(async function* (req) {
    starts.push(req);
    yield event(req, 1, "task.started");
    yield terminal(req, 2);
  });
  const options = {
    dbPath,
    workingDirectory: root,
    workspaceIdentity: "workspace-1",
    cliStorageRoot: root,
    outerSandboxReady: true,
    adapters: new Map([["claude-cli", adapter]]),
  };
  return { root, starts, options, facade: await createExternalRuntimeFacade(options) };
}

test("crew facade dispatches once and persists structured summary across restart", async () => {
  const { facade, root, options, starts } = await setup();
  try {
    await Promise.all([facade.crewRuntime(command()), facade.crewRuntime(command())]);
    await facade.service.waitForIdle();
    assert.equal(starts.length, 1);
    assert.equal(starts[0]?.taskId, "crew_ext_1");
    assert.equal(starts[0]?.sessionId, "crew_context_1");
    const result = await facade.crewRuntime({ action: "read", taskId: "crew_ext_1" });
    assert.equal(result.kind, "task");
    if (result.kind === "task") {
      assert.equal(result.task.summary, "structured fixture summary");
      assert.equal(result.task.settled, true);
    }
    facade.dispose();
    const restarted = await createExternalRuntimeFacade(options);
    try {
      assert.deepEqual(
        await restarted.crewRuntime({ action: "read", taskId: "crew_ext_1" }),
        result,
      );
      await restarted.crewRuntime(command("crew_ext_2", { resumeTaskId: "crew_ext_1" }));
      await restarted.service.waitForIdle();
      assert.equal(starts[1]?.resumeNativeSessionId, "native-1");
      assert.equal(starts[1]?.taskId, "crew_ext_2");
    } finally {
      restarted.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("crew facade rejects resume from different session/runtime or unsuccessful task", async () => {
  const { facade, root } = await setup();
  try {
    await facade.crewRuntime(command());
    await facade.service.waitForIdle();
    for (const changes of [
      { sessionId: "crew_other_epoch" },
      { runtimeId: "codex-cli" },
      { resumeTaskId: "unknown" },
    ]) {
      await assert.rejects(
        facade.crewRuntime(command("crew_ext_2", { resumeTaskId: "crew_ext_1", ...changes })),
        /No completed attempt/,
      );
    }
    await assert.rejects(
      facade.crewRuntime(command("crew_ext_1", { sessionId: "other" })),
      /identity collision/,
    );
  } finally {
    facade.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("crew facade preflight is explicit and never silently falls back", async () => {
  const { facade, root, starts } = await setup();
  try {
    const probe = await facade.crewRuntime({
      action: "probe",
      runtimeId: "opencode-cli",
      accessMode: "read",
    });
    assert.equal(probe.kind, "probe");
    if (probe.kind === "probe") {
      assert.equal(probe.probe.available, false);
      assert.match(probe.probe.reason!, /not registered/);
    }
    await facade.crewRuntime(command("crew_ext_missing", { runtimeId: "opencode-cli" }));
    await facade.service.waitForIdle();
    const result = await facade.crewRuntime({ action: "read", taskId: "crew_ext_missing" });
    assert.equal(result.kind, "task");
    if (result.kind === "task") {
      assert.equal(result.task.runtimeState, "runtime_unavailable");
      assert.equal(result.task.settled, true);
    }
    assert.equal(starts.length, 0);
  } finally {
    facade.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("crew workspace-scoped facade never loads, executes or erases another workspace queue", async () => {
  const { facade, root, options, starts } = await setup();
  const second = await createExternalRuntimeFacade({
    ...options,
    workspaceIdentity: "workspace-2",
  });
  try {
    await facade.crewRuntime(command());
    await facade.service.waitForIdle();
    assert.equal((await second.service.snapshot()).entries.length, 0);
    await assert.rejects(second.crewRuntime({ action: "read", taskId: "crew_ext_1" }), /Unknown/);
    await second.crewRuntime(command("crew_ext_2"));
    await second.service.waitForIdle();
    await facade.crewRuntime(command("crew_ext_3"));
    await facade.service.waitForIdle();
    assert.deepEqual(
      starts.map((req) => req.workspace.identity),
      ["workspace-1", "workspace-2", "workspace-1"],
    );
    const reopened = await createExternalRuntimeFacade({
      ...options,
      workspaceIdentity: "workspace-2",
    });
    try {
      assert.equal((await reopened.service.snapshot()).entries[0]?.request.taskId, "crew_ext_2");
    } finally {
      reopened.dispose();
    }
  } finally {
    facade.dispose();
    second.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("crew explicit redispatch advances after a settled rejection without replay", async () => {
  const { facade, root, starts } = await setup();
  try {
    await facade.crewRuntime(command("crew_rejected", { runtimeId: "opencode-cli" }));
    await facade.service.waitForIdle();
    await facade.crewRuntime(command("crew_retry"));
    await facade.service.waitForIdle();
    assert.deepEqual(
      starts.map((req) => req.taskId),
      ["crew_retry"],
    );
    const result = await facade.crewRuntime({ action: "read", taskId: "crew_retry" });
    if (result.kind === "task") assert.equal(result.task.runtimeState, "succeeded");
  } finally {
    facade.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
