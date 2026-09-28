import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CrewExecution } from "@zcode/shared";
import type { CrewRuntimePort } from "../src/crew/contract.js";
import { CrewService } from "../src/crew/crewService.js";
import { CrewStore } from "../src/crew/crewStore.js";

async function fixture(overrides: Partial<CrewRuntimePort> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "crew-recovery-"));
  let dispatches = 0;
  const runtime: CrewRuntimePort = {
    preflight: async () => {},
    cancel: async () => {},
    execute: async (input) => {
      dispatches++;
      const taskId = `task-${input.execution.executionId}`;
      await input.onTaskCreated(taskId);
      return { taskId, text: "done", status: "succeeded" };
    },
    ...overrides,
  };
  const options = {
    databasePath: join(directory, "tasks-index.sqlite"),
    ownerId: "new-owner",
    isOwnerAlive: (owner: string) => owner !== "dead-owner",
    runtime,
  };
  const service = new CrewService(options),
    store = new CrewStore(options.databasePath);
  const catalog = new CrewAgentCatalogService(options.databasePath);
  const agent = await catalog.create({
    name: "Agent",
    systemPrompt: "role",
    runtime: "zcode",
    accessMode: "write",
  });
  const group = await service.create({ name: "Crew", members: [{ agentId: agent.agentId }] });
  const binding = { workspacePath: directory };
  await service.bind({ groupId: group.groupId, binding });
  await store.initialize();
  const send = (messageId: string) =>
    service.send({
      groupId: group.groupId,
      messageId,
      text: "run",
      mentions: [group.members[0].memberId],
    });
  const seed = (messageId: string, owner?: string): CrewExecution =>
    store.transaction(() => {
      const result = store.enqueue({
        groupId: group.groupId,
        messageId,
        text: "run",
        mentions: [group.members[0].memberId],
      });
      if (owner)
        store.db
          .prepare(
            "UPDATE agent_crew_executions SET status='running',owner_id=?,task_id='original-task' WHERE execution_id=?",
          )
          .run(owner, result.execution!.executionId);
      return store.execution(result.execution!.executionId);
    });
  return {
    service,
    store,
    group,
    binding,
    options,
    seed,
    send,
    dispatches: () => dispatches,
    async dispose() {
      await service.dispose();
      await catalog.dispose();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("queued restart recovery is serial, CAS claimed across two connections and never duplicated", async () => {
  const f = await fixture();
  const second = new CrewService({ ...f.options, ownerId: "another-owner" });
  try {
    const first = f.seed("first"),
      next = f.seed("next");
    await Promise.all([
      f.service.recover({ groupId: f.group.groupId }),
      second.recover({ groupId: f.group.groupId }),
    ]);
    await Promise.all([f.service.whenIdle(), second.whenIdle()]);
    await f.service.recover({ groupId: f.group.groupId });
    await f.service.whenIdle();
    const detail = await second.get({ groupId: f.group.groupId });
    assert.equal(f.dispatches(), 2);
    assert.deepEqual(
      detail.executions.map((execution) => execution.executionId),
      [first.executionId, next.executionId],
    );
    assert.ok(detail.executions.every((execution) => execution.status === "succeeded"));
    assert.equal(detail.messages.filter((message) => message.sender === "member").length, 2);
  } finally {
    await second.dispose();
    await f.dispose();
  }
});

test("dead running owner becomes recovery_required without replay; manual safe cancel unblocks queued", async () => {
  let cancellations = 0;
  const f = await fixture({
    cancel: async (_binding, taskId) => {
      assert.equal(taskId, "original-task");
      cancellations++;
    },
  });
  try {
    const abandoned = f.seed("abandoned", "dead-owner");
    f.seed("queued-behind");
    // 不调用 recover（模拟用户只点执行条上的「取消」）：直接安全取消并解锁队列。
    await f.service.cancel({ groupId: f.group.groupId, executionId: abandoned.executionId });
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.deepEqual(
      detail.executions.map((execution) => execution.status),
      ["cancelled", "succeeded"],
    );
    assert.equal(cancellations, 1);
    assert.equal(f.dispatches(), 1);
    // 已终态执行的重复取消是幂等的，不再调用 runtime。
    await f.service.cancel({ groupId: f.group.groupId, executionId: abandoned.executionId });
    assert.equal(cancellations, 1);
  } finally {
    await f.dispose();
  }
});

test("recover confirms dead recovery_required executions as cancelled and unblocks the conversation; live owner stays", async () => {
  const f = await fixture();
  try {
    const abandoned = f.seed("abandoned", "dead-owner");
    // 一次 recover 内：running(dead) → recovery_required → 确认归属 → cancelled。
    // 死亡 owner 无需用户两次点击，检查恢复直接给出确定结果，绝不重放。
    const confirmed = await f.service.recover({ groupId: f.group.groupId, confirm: true });
    await f.service.whenIdle();
    const confirmedExecution = confirmed.executions.find(
      (execution) => execution.executionId === abandoned.executionId,
    );
    assert.equal(confirmedExecution?.status, "cancelled");
    assert.equal(f.dispatches(), 0, "确认恢复绝不重放已创建 task 的输入");
    // 会话解锁：可以再次派工。
    await f.send("next-task");
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.ok(detail.executions.some((execution) => execution.status === "succeeded"));

    // owner 仍存活的 running 执行：recover 不抢占、不误确认。
    const liveAbandoned = f.seed("live-abandoned", "live-owner");
    const preserved = await f.service.recover({ groupId: f.group.groupId });
    const preservedExecution = preserved.executions.find(
      (execution) => execution.executionId === liveAbandoned.executionId,
    );
    assert.equal(preservedExecution?.status, "running");
    await f.service.cancel({ groupId: f.group.groupId, executionId: liveAbandoned.executionId });
    await f.service.whenIdle();
  } finally {
    await f.dispose();
  }
});

test("live owner is preserved and owner liveness race cannot overwrite a concurrently completed run", async () => {
  const check = Promise.withResolvers<boolean>();
  const f = await fixture();
  const observer = new CrewService({
    ...f.options,
    ownerId: "observer",
    isOwnerAlive: () => check.promise,
  });
  try {
    const running = f.seed("running", "live-owner");
    await f.service.recover({ groupId: f.group.groupId });
    assert.equal(f.store.execution(running.executionId).status, "running");
    assert.equal(f.dispatches(), 0);
    const recovering = observer.recover({ groupId: f.group.groupId });
    await observer.list({});
    f.store.db
      .prepare("UPDATE agent_crew_executions SET status='succeeded' WHERE execution_id=?")
      .run(running.executionId);
    check.resolve(false);
    await recovering;
    assert.equal(f.store.execution(running.executionId).status, "succeeded");
  } finally {
    check.resolve(true);
    await observer.dispose();
    await f.dispose();
  }
});

test("explicit unknown-ACK recovery error stays unresolved even before task reference exists", async () => {
  const f = await fixture({
    execute: async () => {
      throw new Error("crew.recoveryRequired");
    },
  });
  try {
    const sent = await f.send("unknown");
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0].status, "recovery_required");
    assert.equal(detail.executions[0].taskId, null);
    assert.equal(detail.messages.length, 1);
    await assert.rejects(
      f.service.bind({ groupId: f.group.groupId, binding: f.binding }),
      /groupBusy/,
    );
    await assert.rejects(
      f.service.cancel({ groupId: f.group.groupId, executionId: sent.execution!.executionId }),
      /taskNotReady/,
    );
  } finally {
    await f.dispose();
  }
});

test("task creation must persist before execution; runtime interruption after callback stays unresolved", async () => {
  const f = await fixture({
    execute: async (input) => {
      await input.onTaskCreated("persisted-task");
      assert.equal(f.store.execution(input.execution.executionId).taskId, "persisted-task");
      throw new Error("process interrupted");
    },
  });
  try {
    await f.send("interrupted");
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0].taskId, "persisted-task");
    assert.equal(detail.executions[0].status, "recovery_required");
    assert.equal(detail.messages.length, 1);
  } finally {
    await f.dispose();
  }
});

test("known pre-start rejection fails safely; inconsistent task result never reports success", async () => {
  for (const inconsistent of [false, true]) {
    const f = await fixture({
      execute: async (input) => {
        if (!inconsistent) {
          await input.onTaskCreated("pre-admission-task");
          throw new Error("crew.workspaceBusy");
        }
        await input.onTaskCreated("task-a");
        return { taskId: "task-b", text: "done", status: "succeeded" };
      },
    });
    try {
      await f.send("run");
      await f.service.whenIdle();
      const detail = await f.service.get({ groupId: f.group.groupId });
      assert.equal(detail.executions[0].status, inconsistent ? "recovery_required" : "failed");
      assert.equal(detail.messages.length, inconsistent ? 1 : 2);
    } finally {
      await f.dispose();
    }
  }
});

test("queued cancellation does not invoke runtime and rolls back both result and status on DB write failure", async () => {
  let cancellations = 0;
  const f = await fixture({
    cancel: async () => {
      cancellations++;
    },
  });
  try {
    const execution = f.seed("queued");
    f.store.db.exec(
      "CREATE TRIGGER fail_reply BEFORE INSERT ON agent_crew_messages WHEN NEW.sender='member' BEGIN SELECT RAISE(ABORT,'test reply write failure'); END",
    );
    await assert.rejects(
      f.service.cancel({ groupId: f.group.groupId, executionId: execution.executionId }),
      /test reply write failure/,
    );
    assert.equal(f.store.execution(execution.executionId).status, "queued");
    f.store.db.exec("DROP TRIGGER fail_reply");
    await f.service.cancel({ groupId: f.group.groupId, executionId: execution.executionId });
    await f.service.whenIdle();
    assert.equal(cancellations, 0);
    assert.equal(f.dispatches(), 0);
    assert.equal(f.store.execution(execution.executionId).status, "cancelled");
  } finally {
    await f.dispose();
  }
});

test("cancel failure fences running work; late result cannot clear recovery or emit duplicate reply", async () => {
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const f = await fixture({
    execute: async (input) => {
      await input.onTaskCreated("running-task");
      started.resolve();
      await release.promise;
      return { taskId: "running-task", text: "late result", status: "succeeded" };
    },
    cancel: async () => {
      throw new Error("crew.recoveryRequired");
    },
  });
  try {
    const sent = await f.send("running");
    await started.promise;
    await assert.rejects(
      f.service.cancel({ groupId: f.group.groupId, executionId: sent.execution!.executionId }),
      /recoveryRequired/,
    );
    release.resolve();
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0].status, "recovery_required");
    assert.equal(detail.messages.length, 1);
  } finally {
    release.resolve();
    await f.dispose();
  }
});

test("safe running cancellation emits one reply and late task callback cannot mutate history", async () => {
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const f = await fixture({
    execute: async (input) => {
      await input.onTaskCreated("task");
      started.resolve();
      await release.promise;
      await assert.rejects(input.onTaskCreated("late-task"), /staleExecution/);
      return { taskId: "task", text: "late", status: "succeeded" };
    },
  });
  try {
    const sent = await f.send("running");
    await started.promise;
    const result = await f.service.cancel({
      groupId: f.group.groupId,
      executionId: sent.execution!.executionId,
    });
    assert.equal(result.status, "cancelled");
    await f.service.bind({
      groupId: f.group.groupId,
      binding: { ...f.binding, workspaceIdentity: "new-epoch" },
    });
    release.resolve();
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0].status, "cancelled");
    assert.equal(detail.executions[0].taskId, "task");
    assert.equal(detail.group.epoch, 2);
    assert.equal(detail.messages.length, 2);
  } finally {
    release.resolve();
    await f.dispose();
  }
});
