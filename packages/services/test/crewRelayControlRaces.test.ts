import assert from "node:assert/strict";
import test from "node:test";
import type { CrewExecution } from "@zcode/shared";
import { deferred, handoff, relayFixture } from "./crewRelayFixture.js";

for (const transition of ["pause-resume", "recovery-confirm"] as const) {
  test(`${transition} invalidates an automatic probe even when control is restored before it returns`, async () => {
    const entered = deferred();
    const release = deferred();
    const f = await relayFixture({ mode: "auto" });
    f.setReply(({ execution }) => {
      if (execution.hop === 0) return handoff("Developer");
      if (execution.hop === 1) {
        f.setProbe(async () => {
          entered.resolve();
          await release.promise;
          return null;
        });
        return handoff("Coordinator", "Review completed work");
      }
      return "Done";
    });
    try {
      const root = await f.start();
      await f.respond(root);
      await entered.promise;
      const source = f.executions().find((item) => item.hop === 1)!;
      assert.equal(source.relay?.status, "awaiting_user_approval");
      // 锁外 probe 跨越完整控制切换：最终布尔状态相同，也不能恢复旧准入授权。
      if (transition === "pause-resume") {
        await f.service.update({ groupId: f.group.groupId, relayPaused: true });
        await f.service.update({ groupId: f.group.groupId, relayPaused: false });
      } else {
        const unresolved = f.seedRecovery();
        assert.equal(f.store.conversation(f.scope.groupId).status, "recovery_required");
        await f.service.recover({ ...f.scope, confirm: true });
        assert.equal(f.store.execution(unresolved.executionId).status, "cancelled");
      }
      assert.equal(f.store.conversation(f.scope.groupId).status, "awaiting_user_approval");
      release.resolve();
      await f.service.whenIdle();
      const pending = f.store.execution(source.executionId);
      assert.equal(pending.relay?.status, "awaiting_user_approval");
      assert.ok(
        (pending.relay?.admissionRevision ?? 0) > (source.relay?.admissionRevision ?? 0),
        "control invalidation is durable on the proposal",
      );
      assert.deepEqual(
        f.calls.map((input) => input.execution.hop),
        [0, 1],
      );
      assert.equal(
        f.executions().filter((item) => item.rootRequestId === root.rootRequestId).length,
        2,
        "no successor is enqueued by the stale probe",
      );
      // 新一次显式审批才能使用新版本；不是永久冻结提案，也不是恢复时自动重放。
      f.setProbe(async () => null);
      assert.equal((await f.respond(pending)).relay?.status, "dispatched");
      await f.service.whenIdle();
      assert.deepEqual(
        f.calls.map((input) => input.execution.hop),
        [0, 1, 2],
      );
    } finally {
      release.resolve();
      await f.close();
    }
  });
}

test("approval rejected during its probe throws crew.relayDecisionConflict without dispatch", async () => {
  const entered = deferred();
  const release = deferred();
  const f = await relayFixture({ mode: "auto", reply: () => handoff("Developer") });
  let approval: Promise<CrewExecution> | undefined;
  try {
    const root = await f.start();
    f.setProbe(async () => {
      entered.resolve();
      await release.promise;
      return null;
    });
    approval = f.respond(root);
    await entered.promise;
    assert.equal((await f.respond(root, false)).relay?.status, "rejected");
    // 拒绝先提交后，批准的异步续体必须报告相反决定冲突，而不是成功返回 rejected。
    const conflict = assert.rejects(approval, { message: "crew.relayDecisionConflict" });
    release.resolve();
    await conflict;
    await f.service.whenIdle();
    assert.equal(f.store.execution(root.executionId).relay?.status, "rejected");
    assert.equal(f.executions().length, 1);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.respond(root, false)).relay?.status, "rejected");
    await assert.rejects(f.respond(root), { message: "crew.relayDecisionConflict" });
  } finally {
    release.resolve();
    await approval?.catch(() => {});
    await f.close();
  }
});

test("30 to 1 minute edit preserves the root budget for the running task, later admission and child timer", async (t) => {
  const rootRunning = deferred();
  const finishRoot = deferred();
  const childRunning = deferred();
  const finishChild = deferred();
  const cancelResult = deferred();
  const f = await relayFixture({
    mode: "auto",
    budgetMinutes: 30,
    reply: async ({ execution }) => {
      if (execution.hop === 0) {
        rootRunning.resolve();
        await finishRoot.promise;
        return handoff("Developer");
      }
      childRunning.resolve();
      await finishChild.promise;
      return handoff("Coordinator", "Late reply must not dispatch");
    },
  });
  f.setCancel(() => cancelResult.promise);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    const sent = await f.send();
    assert.ok(sent.execution);
    await rootRunning.promise;
    t.mock.timers.tick(30000);
    await f.service.update({ groupId: f.group.groupId, relayBudgetMinutes: 1 });
    t.mock.timers.tick(30000);
    assert.equal(f.store.execution(sent.execution.executionId).status, "running");
    assert.deepEqual(f.cancellations, []);
    finishRoot.resolve();
    await f.service.whenIdle();
    const root = f.store.execution(sent.execution.executionId);
    assert.equal(root.relay?.status, "awaiting_user_approval");
    assert.equal((await f.respond(root)).relay?.status, "dispatched");
    await childRunning.promise;
    const child = f.executions().find((item) => item.hop === 1)!;
    // 子跳在第60秒才创建，但必须沿用根的30分钟截止点，不能改用新设置或重置起点。
    t.mock.timers.tick(29 * 60000 - 1);
    assert.deepEqual(f.cancellations, []);
    assert.equal(f.store.execution(child.executionId).status, "running");
    t.mock.timers.tick(1);
    assert.deepEqual(f.cancellations, [child.taskId]);
    assert.equal(f.store.execution(child.executionId).status, "running");
    cancelResult.resolve();
    await cancelResult.promise;
    assert.equal(f.store.execution(child.executionId).status, "cancelled");
    finishChild.resolve();
    await f.service.whenIdle();
    assert.equal(f.store.execution(child.executionId).relay, undefined);
    assert.equal(f.calls.length, 2);
  } finally {
    cancelResult.resolve();
    finishRoot.resolve();
    finishChild.resolve();
    await f.close();
    t.mock.timers.reset();
  }
});

test("1 to 2 minute edit cannot extend an existing root past its frozen sixty-second deadline", async (t) => {
  const running = deferred();
  const completion = deferred();
  const cancelResult = deferred();
  const f = await relayFixture({
    budgetMinutes: 1,
    reply: async () => {
      running.resolve();
      await completion.promise;
      return handoff("Developer", "Late handoff");
    },
  });
  f.setCancel(() => cancelResult.promise);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  try {
    const sent = await f.send();
    assert.ok(sent.execution);
    await running.promise;
    const active = f.store.execution(sent.execution.executionId);
    t.mock.timers.tick(30000);
    await f.service.update({ groupId: f.group.groupId, relayBudgetMinutes: 2 });
    t.mock.timers.tick(29999);
    assert.deepEqual(f.cancellations, []);
    assert.equal(f.store.execution(active.executionId).status, "running");
    t.mock.timers.tick(1);
    assert.deepEqual(f.cancellations, [active.taskId]);
    cancelResult.resolve();
    await cancelResult.promise;
    assert.equal(f.store.execution(active.executionId).status, "cancelled");
    completion.resolve();
    await f.service.whenIdle();
    assert.equal(f.store.execution(active.executionId).relay, undefined);
    assert.equal(f.calls.length, 1);
  } finally {
    cancelResult.resolve();
    completion.resolve();
    await f.close();
    t.mock.timers.reset();
  }
});

for (const [previousMinutes, nextMinutes] of [
  [30, 1],
  [1, 2],
] as const) {
  test(`a new root after ${previousMinutes} to ${nextMinutes} minute edit uses the new setting`, async (t) => {
    const running = deferred();
    const completion = deferred();
    const cancelResult = deferred();
    const f = await relayFixture({ budgetMinutes: previousMinutes });
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    try {
      const oldRoot = await f.start("before-setting-edit");
      assert.equal(oldRoot.status, "succeeded");
      t.mock.timers.tick(30000);
      await f.service.update({ groupId: f.group.groupId, relayBudgetMinutes: nextMinutes });
      f.setReply(async () => {
        running.resolve();
        await completion.promise;
        return "Done";
      });
      f.setCancel(() => cancelResult.promise);
      const sent = await f.send("after-setting-edit");
      assert.ok(sent.execution);
      await running.promise;
      const active = f.store.execution(sent.execution.executionId);
      assert.notEqual(active.rootRequestId, oldRoot.rootRequestId);
      t.mock.timers.tick(nextMinutes * 60000 - 1);
      assert.deepEqual(f.cancellations, []);
      assert.equal(f.store.execution(active.executionId).status, "running");
      t.mock.timers.tick(1);
      assert.deepEqual(f.cancellations, [active.taskId]);
      cancelResult.resolve();
      await cancelResult.promise;
      assert.equal(f.store.execution(active.executionId).status, "cancelled");
      completion.resolve();
      await f.service.whenIdle();
      assert.equal(f.calls.length, 2);
    } finally {
      cancelResult.resolve();
      completion.resolve();
      await f.close();
      t.mock.timers.reset();
    }
  });
}
