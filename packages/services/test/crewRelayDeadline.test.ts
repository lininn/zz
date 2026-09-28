import assert from "node:assert/strict";
import test from "node:test";
import type { CrewExecution } from "@zcode/shared";
import { deferred, handoff, relayFixture } from "./crewRelayFixture.js";

for (const activeHop of [0, 1]) {
  for (const stopFails of [false, true]) {
    test(`live budget at hop ${activeHop}: native cancellation ${stopFails ? "failure isolates recovery" : "success stops safely"}`, async (t) => {
      const running = deferred();
      const completion = deferred();
      const cancelEntered = deferred();
      const cancelResult = deferred();
      const f = await relayFixture({
        mode: "auto",
        budgetMinutes: 1,
        reply: async ({ execution }) => {
          if (activeHop === 1 && execution.hop === 0) return handoff("Developer");
          running.resolve();
          await completion.promise;
          return handoff(execution.hop === 0 ? "Developer" : "Coordinator", "Late final handoff");
        },
      });
      f.setCancel(() => {
        cancelEntered.resolve();
        return cancelResult.promise;
      });
      t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
      try {
        let root: CrewExecution;
        if (activeHop === 0) {
          const sent = await f.send();
          assert.ok(sent.execution);
          root = sent.execution;
        } else {
          root = await f.start();
          // 第二跳只剩根预算的十五秒；不能在每次创建 task 时重新获得一分钟。
          t.mock.timers.tick(45000);
          await f.respond(root);
        }
        await running.promise;
        const active = f.executions().find((item) => item.hop === activeHop)!;
        assert.equal(active.status, "running");
        const remaining = activeHop === 0 ? 60000 : 15000;
        t.mock.timers.tick(remaining - 1);
        assert.deepEqual(f.cancellations, []);
        t.mock.timers.tick(1);
        await cancelEntered.promise;
        assert.deepEqual(f.cancellations, [active.taskId]);
        assert.equal(
          f.store.db
            .prepare(
              "SELECT relay_cancel_requested FROM agent_crew_executions WHERE execution_id=?",
            )
            .get(active.executionId)?.relay_cancel_requested,
          1,
          "cancel intent is durable before native acknowledgement",
        );
        assert.equal(f.store.execution(active.executionId).status, "running");
        // expire 已先等待此 promise；再等待同一 promise 的测试只会在其持久化收敛后继续。
        if (stopFails) cancelResult.reject(new Error("crew.recoveryRequired"));
        else cancelResult.resolve();
        await cancelResult.promise.catch(() => {});
        assert.equal(
          f.store.execution(active.executionId).status,
          stopFails ? "recovery_required" : "cancelled",
        );
        completion.resolve();
        await f.service.whenIdle();
        const saved = f.store.execution(active.executionId);
        assert.equal(saved.status, stopFails ? "recovery_required" : "cancelled");
        assert.equal(
          saved.relay,
          undefined,
          "late successful output cannot reopen a stopped execution",
        );
        assert.equal(f.calls.length, activeHop + 1);
        assert.equal(f.executions().length, activeHop + 1);
        if (stopFails)
          assert.equal((await f.service.get(f.scope)).conversation.status, "recovery_required");
        else
          assert.ok(
            f.store
              .messages(f.scope.groupId, f.scope.conversationId)
              .some(
                (message) =>
                  message.executionId === active.executionId &&
                  message.text === "crew.relayBudgetExceeded",
              ),
          );
      } finally {
        cancelResult.resolve();
        completion.resolve();
        await f.close();
        t.mock.timers.reset();
      }
    });
  }
}

test("active cancel intent closes the whole chain when completion wins the native-cancel race", async () => {
  const running = deferred();
  const completion = deferred();
  const cancelEntered = deferred();
  const cancelResult = deferred();
  const f = await relayFixture({
    mode: "auto",
    reply: async ({ execution }) => {
      if (execution.hop === 0) return handoff("Developer");
      running.resolve();
      await completion.promise;
      return handoff("Coordinator", "This late summary must not dispatch");
    },
  });
  f.setCancel(() => {
    cancelEntered.resolve();
    return cancelResult.promise;
  });
  let cancelling: Promise<CrewExecution> | undefined;
  try {
    await f.respond(await f.start());
    await running.promise;
    const active = f.executions()[1]!;
    cancelling = f.service.cancel({ ...f.scope, executionId: active.executionId });
    await cancelEntered.promise;
    assert.equal(
      f.store.db
        .prepare("SELECT relay_cancel_requested FROM agent_crew_executions WHERE execution_id=?")
        .get(active.executionId)?.relay_cancel_requested,
      1,
    );
    // 模型先完成，但原生取消还未回执；不能把成功结果当作再次派工授权。
    completion.resolve();
    await f.service.whenIdle();
    const finished = f.store.execution(active.executionId);
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.relay?.status, "blocked");
    assert.equal(finished.relay?.reason, "relayCancelled");
    assert.equal(f.executions().length, 2);
    assert.equal(f.calls.length, 2);
    cancelResult.resolve();
    const cancelled = await cancelling;
    assert.equal(cancelled.executionId, active.executionId);
    assert.equal(cancelled.relay?.reason, "relayCancelled");
    assert.deepEqual(await f.respond(cancelled), cancelled);
    await f.service.whenIdle();
    assert.deepEqual(f.cancellations, [active.taskId]);
    assert.equal(f.calls.length, 2);
  } finally {
    cancelResult.resolve();
    completion.resolve();
    await cancelling?.catch(() => {});
    await f.close();
  }
});
