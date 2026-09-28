import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CrewRuntimePort } from "../src/crew/contract.js";
import { CrewService } from "../src/crew/crewService.js";
import { CrewStore } from "../src/crew/crewStore.js";

async function fixture(runtime: CrewRuntimePort) {
  const directory = await mkdtemp(join(tmpdir(), "crew-lifecycle-"));
  const databasePath = join(directory, "tasks-index.sqlite");
  const service = new CrewService({
    databasePath,
    ownerId: "owner",
    isOwnerAlive: () => true,
    runtime,
  });
  const catalog = new CrewAgentCatalogService(databasePath);
  const agent = await catalog.create({
    name: "Agent",
    systemPrompt: "role",
    runtime: "zcode",
    accessMode: "write",
  });
  const group = await service.create({ name: "Crew", members: [{ agentId: agent.agentId }] });
  const binding = { workspacePath: directory };
  await service.bind({ groupId: group.groupId, binding });
  const send = (messageId: string) =>
    service.send({
      groupId: group.groupId,
      messageId,
      text: "work",
      mentions: [group.members[0].memberId],
    });
  return {
    service,
    group,
    binding,
    databasePath,
    send,
    async dispose() {
      await service.dispose();
      await catalog.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("dispose closes admission before waiting and preserves queued work without dispatching it", async () => {
  const started = Promise.withResolvers<void>(),
    stopped = Promise.withResolvers<void>();
  let count = 0;
  const f = await fixture({
    preflight: async () => {},
    cancel: async () => {},
    execute: async (input) => {
      count++;
      await input.onTaskCreated("task");
      started.resolve();
      await stopped.promise;
      throw new Error("crew.recoveryRequired");
    },
  });
  const store = new CrewStore(f.databasePath);
  try {
    await f.send("first");
    await started.promise;
    await f.send("queued");
    const closing = f.service.dispose();
    await assert.rejects(f.send("after-close"), /serviceClosed/);
    stopped.resolve();
    await closing;
    await store.initialize();
    assert.equal(count, 1);
    assert.deepEqual(
      store.executions(f.group.groupId).map((execution) => execution.status),
      ["recovery_required", "queued"],
    );
  } finally {
    stopped.resolve();
    store.close();
    await f.dispose();
  }
});

test("teardown during preflight returns unstarted claim to queued instead of executing after close", async () => {
  const started = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>();
  let block = false,
    calls = 0;
  const f = await fixture({
    preflight: async () => {
      if (block) {
        started.resolve();
        await released.promise;
      }
    },
    cancel: async () => {},
    execute: async () => {
      calls++;
      throw new Error("must not dispatch");
    },
  });
  const store = new CrewStore(f.databasePath);
  try {
    block = true;
    await f.send("first");
    await started.promise;
    const closing = f.service.dispose();
    released.resolve();
    await closing;
    await store.initialize();
    const execution = store.executions(f.group.groupId)[0];
    assert.equal(calls, 0);
    assert.equal(execution.status, "queued");
    assert.equal(execution.ownerId, null);
  } finally {
    released.resolve();
    store.close();
    await f.dispose();
  }
});

test("rebind preflight cannot race a newly admitted execution", async () => {
  const bindStarted = Promise.withResolvers<void>(),
    bindRelease = Promise.withResolvers<void>();
  const runStarted = Promise.withResolvers<void>(),
    runRelease = Promise.withResolvers<void>();
  const f = await fixture({
    preflight: async (binding) => {
      if (binding.workspaceIdentity === "new") {
        bindStarted.resolve();
        await bindRelease.promise;
      }
    },
    cancel: async () => {},
    execute: async (input) => {
      await input.onTaskCreated("task");
      runStarted.resolve();
      await runRelease.promise;
      return { taskId: "task", text: "done", status: "succeeded" };
    },
  });
  try {
    const pending = f.service.bind({
      groupId: f.group.groupId,
      binding: { ...f.binding, workspaceIdentity: "new" },
    });
    await bindStarted.promise;
    await f.send("work");
    await runStarted.promise;
    bindRelease.resolve();
    await assert.rejects(pending, /groupBusy/);
    assert.equal((await f.service.get({ groupId: f.group.groupId })).group.epoch, 1);
  } finally {
    bindRelease.resolve();
    runRelease.resolve();
    await f.dispose();
  }
});

test("unknown exception without a saved task remains recovery-required rather than a safe failure", async () => {
  const f = await fixture({
    preflight: async () => {},
    cancel: async () => {},
    execute: async () => {
      throw new Error("unknown transport outcome");
    },
  });
  try {
    await f.send("work");
    await f.service.whenIdle();
    assert.equal(
      (await f.service.get({ groupId: f.group.groupId })).executions[0].status,
      "recovery_required",
    );
  } finally {
    await f.dispose();
  }
});

test("immediate list then dispose waits for initialization and leaves no reopened SQLite handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crew-initialize-dispose-"));
  const service = new CrewService({
    databasePath: join(directory, "nested", "tasks-index.sqlite"),
    ownerId: "initializing-owner",
    isOwnerAlive: () => true,
    runtime: {
      preflight: async () => {},
      cancel: async () => {},
      execute: async () => {
        throw new Error("must not execute");
      },
    },
  });
  const store = (service as unknown as { store: CrewStore }).store;
  try {
    const listed = assert.rejects(service.list({}), /serviceClosed/);
    const closing = service.dispose();
    await Promise.all([listed, closing]);
    // 只验证资源生命周期：API 拒绝请求还不足以证明 initialize 没有在关闭后重开句柄。
    assert.throws(() => store.db, /databaseNotReady/);
    await service.dispose();
    assert.throws(() => store.db, /databaseNotReady/);
  } finally {
    store.close();
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
