import assert from "node:assert/strict";
import test from "node:test";
import type { CrewExecution, CrewRuntimeProbe } from "@zcode/shared";
import { deferred, handoff, relayFixture } from "./crewRelayFixture.js";

// 延迟 probe 把测试固定在锁外检查与锁内准入之间，不依赖任意 sleep 抢时序。
test("concurrent duplicate approvals create exactly one child and return the source execution", async () => {
  const entered = deferred();
  const release = deferred<CrewRuntimeProbe | null>();
  const f = await relayFixture({
    mode: "auto",
    reply: ({ execution }) => (execution.hop === 0 ? handoff("Developer") : "Done"),
  });
  let pending: Promise<CrewExecution[]> | undefined;
  try {
    const root = await f.start();
    let probes = 0;
    f.setProbe(async () => {
      if (++probes === 2) entered.resolve();
      return release.promise;
    });
    pending = Promise.all([f.respond(root), f.respond(root)]);
    await entered.promise;
    assert.equal(f.executions().length, 1);
    release.resolve(null);
    const responses = await pending;
    assert.ok(
      responses.every(
        (result) =>
          result.executionId === root.executionId && result.relay?.status === "dispatched",
      ),
    );
    await f.service.whenIdle();
    assert.equal(f.executions().length, 2);
    assert.equal(f.calls.length, 2);
    assert.equal(f.executions()[1]!.hop, 1);
    assert.equal(f.executions()[1]!.rootRequestId, root.rootRequestId);
    const messages = f.store.messages(f.scope.groupId, f.scope.conversationId);
    assert.equal(messages.filter((message) => message.sender === "user").length, 2);
    assert.equal(messages.filter((message) => message.sender === "member").length, 2);
    assert.deepEqual(await f.respond(root), responses[0]);
    await assert.rejects(f.respond(root, false), /relayDecisionConflict/);
    await f.service.whenIdle();
    assert.equal(f.calls.length, 2);
  } finally {
    release.resolve(null);
    await pending?.catch(() => {});
    await f.close();
  }
});

for (const lane of ["approval", "automatic"] as const) {
  for (const action of ["pause", "cancel", "recovery", "budget", "catalog-change"] as const) {
    test(`${lane}: ${action} during deferred probe is rechecked before enqueue`, async () => {
      const entered = deferred();
      const release = deferred<CrewRuntimeProbe | null>();
      const gate = async () => {
        entered.resolve();
        return release.promise;
      };
      const f = await relayFixture({ mode: "auto" });
      f.setReply(({ execution }) => {
        if (execution.hop === 0) return handoff("Developer");
        if (lane === "automatic") f.setProbe(gate);
        return handoff("Coordinator", "Review work");
      });
      let pending: Promise<CrewExecution> | undefined;
      try {
        const root = await f.start();
        if (lane === "approval") f.setProbe(gate);
        pending = f.respond(root);
        await entered.promise;
        const before = f.executions();
        const source = before.at(-1)!;
        assert.equal(source.relay?.status, "awaiting_user_approval");
        assert.equal(source.hop, lane === "approval" ? 0 : 1);
        if (action === "pause")
          await f.service.update({ groupId: f.group.groupId, relayPaused: true });
        if (action === "cancel")
          await f.service.cancel({ ...f.scope, executionId: source.executionId });
        if (action === "recovery") f.seedRecovery();
        if (action === "budget") f.expireRoot(root);
        if (action === "catalog-change")
          await f.catalog.update({
            agentId: lane === "approval" ? f.developer.agentId : f.planner.agentId,
            systemPrompt: "Changed after the runtime probe began",
          });
        release.resolve(null);
        await pending;
        await f.service.whenIdle();
        const saved = f.store.execution(source.executionId);
        assert.equal(f.calls.length, lane === "approval" ? 1 : 2);
        assert.equal(f.executions().length, before.length + (action === "recovery" ? 1 : 0));
        if (action === "pause") {
          assert.equal(saved.relay?.status, "awaiting_user_approval");
          await f.service.update({ groupId: f.group.groupId, relayPaused: false });
          await f.service.whenIdle();
          assert.deepEqual(
            f.store.execution(source.executionId),
            {
              ...saved,
              relay: {
                ...saved.relay!,
                admissionRevision: (saved.relay?.admissionRevision ?? 0) + 1,
              },
            },
            "unpausing only invalidates old admission; it does not replay pending handoffs",
          );
          assert.equal(f.calls.length, before.length);
        } else {
          const reasons = {
            cancel: "relayCancelled",
            recovery: "relayRecoveryRequired",
            budget: "relayBudgetExceeded",
            "catalog-change": "relayRuntimeUnavailable",
          };
          assert.equal(saved.relay?.status, "blocked");
          assert.equal(saved.relay?.reason, reasons[action]);
          assert.deepEqual(
            await f.respond(saved),
            saved,
            "blocked handoffs cannot be resurrected by approval",
          );
        }
      } finally {
        release.resolve(null);
        await pending?.catch(() => {});
        await f.close();
      }
    });
  }
}

test("a handoff completed while paused remains pending; resume waits for explicit approval", async () => {
  const entered = deferred();
  const release = deferred();
  const f = await relayFixture({
    mode: "auto",
    reply: async ({ execution }) => {
      if (execution.hop === 0) return handoff("Developer");
      if (execution.hop === 1) {
        entered.resolve();
        await release.promise;
        return handoff("Coordinator", "Summarize");
      }
      return "Done";
    },
  });
  try {
    await f.respond(await f.start());
    await entered.promise;
    await f.service.update({ groupId: f.group.groupId, relayPaused: true });
    release.resolve();
    await f.service.whenIdle();
    const pending = f.executions()[1]!;
    assert.equal(pending.relay?.status, "awaiting_user_approval");
    assert.deepEqual(await f.respond(pending), pending, "approval cannot bypass the pause switch");
    assert.equal(f.calls.length, 2);
    await f.service.update({ groupId: f.group.groupId, relayPaused: false });
    await f.service.whenIdle();
    assert.equal(f.calls.length, 2);
    assert.equal(f.store.execution(pending.executionId).relay?.status, "awaiting_user_approval");
    await f.respond(pending);
    await f.service.whenIdle();
    assert.equal(f.calls.length, 3);
  } finally {
    release.resolve();
    await f.close();
  }
});

for (const pendingKind of ["plan", "handoff"] as const) {
  test(`restart and recovery preserve a pending ${pendingKind} without replaying task input`, async () => {
    const f = await relayFixture({
      mode: "manual",
      reply: ({ execution }) =>
        execution.hop === 0
          ? handoff("Developer")
          : execution.hop === 1
            ? handoff("Coordinator", "Review")
            : "Done",
    });
    try {
      const root = await f.start();
      if (pendingKind === "handoff") {
        await f.respond(root);
        await f.service.whenIdle();
      }
      const before = f.executions();
      const messages = f.store.messages(f.scope.groupId, f.scope.conversationId);
      assert.equal(before.at(-1)!.relay?.kind, pendingKind);
      await f.restart();
      await f.service.list({});
      await f.service.listConversations({ groupId: f.group.groupId });
      await f.service.get(f.scope);
      await f.service.recover(f.scope);
      await f.service.recover({ ...f.scope, confirm: true });
      await f.service.update({ groupId: f.group.groupId, relayMode: "auto", relayPaused: false });
      await f.service.whenIdle();
      assert.deepEqual(f.executions(), before);
      assert.deepEqual(f.store.messages(f.scope.groupId, f.scope.conversationId), messages);
      assert.equal(f.calls.length, before.length);
      await f.respond(before.at(-1)!);
      await f.service.whenIdle();
      assert.ok(f.calls.length > before.length, "explicit approval after restart may advance");
      for (const old of before)
        assert.equal(
          f.calls.filter((call) => call.execution.executionId === old.executionId).length,
          1,
        );
    } finally {
      await f.close();
    }
  });
}

test("relay decisions are conversation-scoped and omitted conversationId means the default", async () => {
  const f = await relayFixture({
    mode: "auto",
    reply: ({ execution }) => (execution.hop === 0 ? handoff("Developer") : "Done"),
  });
  try {
    const root = await f.start("second-root", f.otherConversation.conversationId);
    const before = f.executions(f.otherConversation.conversationId);
    for (const conversationId of [undefined, f.scope.conversationId]) {
      await assert.rejects(
        f.service.respondRelay({
          groupId: f.group.groupId,
          conversationId,
          executionId: root.executionId,
          approved: true,
        }),
        /executionNotFound/,
      );
    }
    assert.deepEqual(f.executions(f.otherConversation.conversationId), before);
    assert.equal(f.calls.length, 1);
    await f.respond(root);
    await f.service.whenIdle();
    assert.equal(f.executions().length, 0);
    assert.equal(f.executions(f.otherConversation.conversationId).length, 2);
    const defaultRoot = await f.start();
    const source = await f.service.respondRelay({
      groupId: f.group.groupId,
      executionId: defaultRoot.executionId,
      approved: true,
    });
    assert.equal(source.executionId, defaultRoot.executionId);
    await f.service.whenIdle();
    assert.equal(f.executions().length, 2);
  } finally {
    await f.close();
  }
});

test("identical root IDs and objective fingerprints are isolated across conversations", async () => {
  const f = await relayFixture({
    mode: "auto",
    reply: ({ execution }) => (execution.hop === 0 ? handoff("Developer") : "Done"),
  });
  try {
    const first = await f.start("same-root");
    const second = await f.start("same-root", f.otherConversation.conversationId);
    await f.respond(first);
    await f.service.whenIdle();
    await f.respond(second);
    await f.service.whenIdle();
    for (const conversationId of [f.scope.conversationId, f.otherConversation.conversationId]) {
      const chain = f.executions(conversationId);
      assert.deepEqual(
        chain.map((item) => item.hop),
        [0, 1],
      );
      assert.equal(chain[0]!.relay?.status, "dispatched");
      assert.ok(
        chain.every(
          (item) => item.conversationId === conversationId && item.rootRequestId === "same-root",
        ),
      );
    }
    assert.equal(f.calls.length, 4);
  } finally {
    await f.close();
  }
});
