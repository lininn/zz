import assert from "node:assert/strict";
import test from "node:test";
import { conversationFixture } from "./crewConversationFixture.js";

test("restart recovers only the selected conversation queue, in order and without duplicate replies", async () => {
  const f = await conversationFixture();
  try {
    const a1 = f.seed(f.a.conversationId, "same-id");
    const a2 = f.seed(f.a.conversationId, "a-next");
    const b1 = f.seed(f.b.conversationId, "same-id");
    const b2 = f.seed(f.b.conversationId, "b-next");
    const bMessages = f.store.messages(f.group.groupId, f.b.conversationId);
    await f.restart();
    await f.service.recover({ groupId: f.group.groupId, conversationId: f.a.conversationId });
    await f.service.whenIdle();
    assert.deepEqual(
      f.calls.map((call) => call.execution.executionId),
      [a1.executionId, a2.executionId],
    );
    assert.deepEqual(f.store.executions(f.group.groupId, f.b.conversationId), [b1, b2]);
    assert.deepEqual(f.store.messages(f.group.groupId, f.b.conversationId), bMessages);
    await f.service.recover({ groupId: f.group.groupId });
    await f.service.whenIdle();
    assert.equal(f.calls.length, 2);
    await f.service.recover({ groupId: f.group.groupId, conversationId: f.b.conversationId });
    await f.service.whenIdle();
    assert.deepEqual(
      f.calls.map((call) => call.execution.executionId),
      [a1.executionId, a2.executionId, b1.executionId, b2.executionId],
    );
    await f.restart();
    for (const { conversationId } of [f.a, f.b]) {
      await f.service.recover({ groupId: f.group.groupId, conversationId });
      await f.service.whenIdle();
      const detail = await f.service.get({ groupId: f.group.groupId, conversationId });
      assert.deepEqual(
        detail.executions.map((execution) => execution.status),
        ["succeeded", "succeeded"],
      );
      assert.equal(detail.messages.filter((message) => message.sender === "member").length, 2);
      assert.deepEqual(
        detail.messages.map((message) => message.sequence),
        [1, 2, 3, 4],
      );
      assert.ok(detail.messages.every((message) => message.conversationId === conversationId));
    }
    assert.equal(f.calls.length, 4);
  } finally {
    await f.close();
  }
});

for (const status of ["running", "recovery_required"] as const) {
  test(`${status} restart isolation does not inspect another conversation or block its admission`, async () => {
    const f = await conversationFixture();
    try {
      const running = f.seed(f.b.conversationId, "abandoned", "running");
      const queued = f.seed(f.b.conversationId, "behind");
      // 排队先于恢复隔离；不能绕过 admission 在已隔离会话继续 enqueue。
      if (status === "recovery_required")
        f.store.db
          .prepare("UPDATE agent_crew_executions SET status=? WHERE execution_id=?")
          .run(status, running.executionId);
      const abandoned = f.store.execution(running.executionId);
      const bMessages = f.store.messages(f.group.groupId, f.b.conversationId);
      await f.restart();
      await f.service.recover({ groupId: f.group.groupId });
      await f.service.whenIdle();
      assert.deepEqual(f.owners, []);
      assert.deepEqual(f.store.executions(f.group.groupId, f.b.conversationId), [
        abandoned,
        queued,
      ]);
      await f.send(f.a.conversationId, "healthy-before-recovery");
      await f.service.whenIdle();
      assert.equal(f.calls.length, 1);
      assert.equal(f.store.executions(f.group.groupId, f.a.conversationId)[0]!.status, "succeeded");
      await f.service.recover({ groupId: f.group.groupId, conversationId: f.b.conversationId });
      await f.service.whenIdle();
      assert.deepEqual(f.owners, status === "running" ? ["dead-owner"] : []);
      assert.equal(f.store.execution(abandoned.executionId).status, "recovery_required");
      assert.equal(f.store.execution(abandoned.executionId).taskId, abandoned.taskId);
      assert.deepEqual(f.store.execution(queued.executionId), queued);
      assert.deepEqual(f.store.messages(f.group.groupId, f.b.conversationId), bMessages);
      await assert.rejects(f.send(f.b.conversationId, "blocked"), /recoveryRequired/);
      await f.send(f.a.conversationId, "healthy-after-recovery");
      await f.service.whenIdle();
      assert.equal(f.calls.length, 2);
      const aBeforeCancel = await f.service.get({
        groupId: f.group.groupId,
        conversationId: f.a.conversationId,
      });
      await f.service.cancel({
        groupId: f.group.groupId,
        conversationId: f.b.conversationId,
        executionId: abandoned.executionId,
      });
      await f.service.whenIdle();
      assert.deepEqual(f.cancellations, [abandoned.taskId]);
      assert.equal(f.calls.length, 3);
      assert.equal(f.calls[2]!.execution.executionId, queued.executionId);
      assert.equal(f.calls[2]!.resumeTaskId, undefined);
      const aAfterCancel = await f.service.get({
        groupId: f.group.groupId,
        conversationId: f.a.conversationId,
      });
      assert.deepEqual(aAfterCancel.messages, aBeforeCancel.messages);
      assert.deepEqual(aAfterCancel.executions, aBeforeCancel.executions);
      assert.deepEqual(
        f.store
          .executions(f.group.groupId, f.b.conversationId)
          .map((execution) => execution.status),
        ["cancelled", "succeeded"],
      );
    } finally {
      await f.close();
    }
  });
}

test("cross-conversation cancellation rejects queued work and terminal work before runtime or history mutation", async () => {
  const f = await conversationFixture();
  try {
    const queued = f.seed(f.b.conversationId, "queued");
    const before = f.store.detail(f.group.groupId, f.b.conversationId);
    for (const conversationId of [undefined, f.a.conversationId]) {
      await assert.rejects(
        f.service.cancel({
          groupId: f.group.groupId,
          conversationId,
          executionId: queued.executionId,
        }),
        /executionNotFound/,
      );
    }
    assert.deepEqual(f.store.detail(f.group.groupId, f.b.conversationId), before);
    assert.deepEqual(f.cancellations, []);
    await f.service.cancel({
      groupId: f.group.groupId,
      conversationId: f.b.conversationId,
      executionId: queued.executionId,
    });
    await f.service.whenIdle();
    assert.equal(f.store.execution(queued.executionId).status, "cancelled");
    await assert.rejects(
      f.service.cancel({
        groupId: f.group.groupId,
        conversationId: f.a.conversationId,
        executionId: queued.executionId,
      }),
      /executionNotFound/,
    );
    assert.deepEqual(f.cancellations, []);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.store.messages(f.group.groupId), []);
  } finally {
    await f.close();
  }
});
