import assert from "node:assert/strict";
import test from "node:test";
import type { CrewExecution } from "@zcode/shared";
import { handoff, relayFixture } from "./crewRelayFixture.js";

for (const mode of ["manual", "semi", "auto"] as const) {
  test(`${mode}: hop eight is allowed, but even approval cannot create hop nine`, async () => {
    const f = await relayFixture({
      mode,
      reply: ({ execution }) =>
        handoff(
          (execution.hop ?? 0) % 2 === 0 ? "Developer" : "Coordinator",
          `Unique objective ${execution.hop}`,
        ),
    });
    try {
      const root = await f.start();
      for (let attempt = 0; attempt < 9; attempt++) {
        const pending = f
          .executions()
          .find((item) => item.relay?.status === "awaiting_user_approval");
        if (!pending) break;
        await f.respond(pending);
        await f.service.whenIdle();
      }
      const chain = f.executions();
      assert.deepEqual(
        chain.map((item) => item.hop),
        [0, 1, 2, 3, 4, 5, 6, 7, 8],
      );
      assert.ok(chain.every((item) => item.rootRequestId === root.messageId));
      const last = chain.at(-1)!;
      assert.equal(last.relay?.status, "blocked");
      assert.equal(last.relay?.reason, "relayHopLimit");
      assert.deepEqual(await f.respond(last), last);
      await f.service.whenIdle();
      assert.equal(f.calls.length, 9);
      assert.equal(f.executions().length, 9);
    } finally {
      await f.close();
    }
  });

  test(`${mode}: approval rechecks the default thirty-minute root budget in SQLite`, async () => {
    const f = await relayFixture({ mode, reply: () => handoff("Developer") });
    try {
      const root = await f.start();
      assert.equal(root.relay?.status, "awaiting_user_approval");
      f.expireRoot(root);
      const result = await f.respond(root);
      assert.equal(result.executionId, root.executionId);
      assert.equal(result.relay?.status, "blocked");
      assert.equal(result.relay?.reason, "relayBudgetExceeded");
      await f.service.whenIdle();
      assert.equal(f.calls.length, 1);
      assert.equal(f.executions().length, 1);
    } finally {
      await f.close();
    }
  });
}

for (const budgetMinutes of [1, 30]) {
  test(`automatic dispatch uses root creation time, not current-hop time (${budgetMinutes} minutes)`, async () => {
    let root!: CrewExecution;
    const f = await relayFixture({ mode: "auto", budgetMinutes });
    f.setReply(({ execution }) => {
      if (execution.hop === 0) return handoff("Developer");
      f.expireRoot(root);
      return handoff("Coordinator", "Summarize recent work");
    });
    try {
      root = await f.start();
      await f.respond(root);
      await f.service.whenIdle();
      const recent = f.executions().at(-1)!;
      assert.equal(recent.hop, 1);
      assert.ok(
        recent.createdAt > f.store.execution(root.executionId).createdAt + budgetMinutes * 60000,
      );
      assert.equal(recent.relay?.status, "blocked");
      assert.equal(recent.relay?.reason, "relayBudgetExceeded");
      assert.equal(f.calls.length, 2);
    } finally {
      await f.close();
    }
  });
}

for (const mode of ["manual", "semi", "auto"] as const) {
  test(`${mode}: NFKC, whitespace and case-normalized objective cannot revisit the same member`, async () => {
    const f = await relayFixture({
      mode,
      reply: ({ execution }) => {
        if (execution.hop === 0) return handoff("Developer", "Implement Feature");
        if (execution.hop === 1) return handoff("Coordinator", "Review result");
        return handoff("Developer", "  Ｉｍｐｌｅｍｅｎｔ\n\tＦＥＡＴＵＲＥ  ");
      },
    });
    try {
      const root = await f.start();
      await f.respond(root);
      await f.service.whenIdle();
      const pending = f
        .executions()
        .find((item) => item.relay?.status === "awaiting_user_approval");
      if (pending) {
        await f.respond(pending);
        await f.service.whenIdle();
      }
      const last = f.executions().at(-1)!;
      assert.equal(last.hop, 2);
      assert.equal(last.relay?.status, "blocked");
      assert.equal(last.relay?.reason, "relayDuplicate");
      assert.deepEqual(await f.respond(last), last);
      assert.equal(f.calls.length, 3);
      assert.equal(f.executions().length, 3);
    } finally {
      await f.close();
    }
  });
}

test("an identical objective to a different member is not a duplicate", async () => {
  const f = await relayFixture({
    mode: "auto",
    reply: ({ execution }) =>
      execution.hop === 0
        ? handoff("Developer", "Review change")
        : execution.hop === 1
          ? handoff("Coordinator", "Review change")
          : "Done",
  });
  try {
    await f.respond(await f.start());
    await f.service.whenIdle();
    assert.deepEqual(
      f.executions().map((item) => item.hop),
      [0, 1, 2],
    );
    assert.equal(f.executions()[1]!.relay?.status, "dispatched");
    assert.equal(f.calls.length, 3);
  } finally {
    await f.close();
  }
});

for (const failure of [
  "unavailable",
  "probe-error",
  "preflight-error",
  "missing-external-probe",
] as const) {
  test(`${failure}: approval blocks unavailable runtime without submitting another task`, async () => {
    const f = await relayFixture({ mode: "auto", reply: () => handoff("Developer") });
    try {
      if (failure === "missing-external-probe")
        await f.catalog.update({ agentId: f.developer.agentId, runtime: "codex-cli" });
      const root = await f.start();
      if (failure === "unavailable")
        f.setProbe(async () => ({ runtimeId: "codex-cli", available: false }));
      if (failure === "probe-error")
        f.setProbe(async () => {
          throw new Error("private diagnostic must not persist");
        });
      if (failure === "preflight-error")
        f.setPreflight(async () => {
          throw new Error("private diagnostic must not persist");
        });
      const blocked = await f.respond(root);
      assert.equal(blocked.relay?.status, "blocked");
      assert.equal(blocked.relay?.reason, "relayRuntimeUnavailable");
      assert.ok(!JSON.stringify(blocked).includes("private diagnostic"));
      await f.service.whenIdle();
      assert.equal(f.executions().length, 1);
      assert.equal(f.calls.length, 1);
    } finally {
      await f.close();
    }
  });
}

test("automatic handoff probes the next member and blocks an unavailable runtime", async () => {
  const f = await relayFixture({ mode: "auto" });
  f.setReply(({ execution }) => {
    if (execution.hop === 0) return handoff("Developer");
    f.setProbe(async () => ({ runtimeId: "codex-cli", available: false }));
    return handoff("Coordinator", "Review");
  });
  try {
    await f.respond(await f.start());
    await f.service.whenIdle();
    assert.equal(f.executions()[1]!.relay?.reason, "relayRuntimeUnavailable");
    assert.equal(f.executions()[1]!.relay?.status, "blocked");
    assert.equal(f.calls.length, 2);
  } finally {
    await f.close();
  }
});

for (const lane of ["approval", "automatic"] as const) {
  test(`recovery_required inhibits ${lane} relay and has projection priority`, async () => {
    const f = await relayFixture({ mode: "auto" });
    let abandoned: CrewExecution | undefined;
    f.setReply(({ execution }) => {
      if (execution.hop === 0) return handoff("Developer");
      abandoned = f.seedRecovery();
      return handoff("Coordinator", "Review");
    });
    try {
      const root = await f.start();
      if (lane === "approval") abandoned = f.seedRecovery();
      const response = await f.respond(root);
      await f.service.whenIdle();
      const source =
        lane === "approval" ? response : f.executions().find((item) => item.hop === 1)!;
      assert.equal(source.relay?.status, "blocked");
      assert.equal(source.relay?.reason, "relayRecoveryRequired");
      assert.equal((await f.service.get(f.scope)).conversation.status, "recovery_required");
      assert.ok(abandoned);
      assert.equal(f.store.execution(abandoned.executionId).status, "recovery_required");
      await f.service.recover(f.scope);
      await f.service.whenIdle();
      assert.equal(f.calls.length, lane === "approval" ? 1 : 2);
      assert.ok(f.calls.every((call) => call.execution.executionId !== abandoned!.executionId));
    } finally {
      await f.close();
    }
  });
}

for (const status of ["failed", "cancelled"] as const) {
  test(`${status} runtime final with a valid handoff stops the chain`, async () => {
    const f = await relayFixture({ mode: "auto", status, reply: () => handoff("Developer") });
    try {
      const root = await f.start();
      assert.equal(root.status, status);
      assert.equal(root.relay, undefined);
      assert.equal(f.calls.length, 1);
      assert.equal(f.executions().length, 1);
    } finally {
      await f.close();
    }
  });
}

test("pending plan prevents rebinding and a stale epoch cannot dispatch", async () => {
  const f = await relayFixture({ mode: "auto", reply: () => handoff("Developer") });
  try {
    const root = await f.start();
    await assert.rejects(
      f.service.bind({
        groupId: f.group.groupId,
        binding: { ...f.binding, workspaceIdentity: "new-workspace" },
      }),
      /groupBusy/,
    );
    // 正常重绑已被 pending 保护；模拟其他 owner 提交新纪元，验证陈旧审批仍不能放行。
    f.store.db
      .prepare("UPDATE agent_crew_groups SET epoch=epoch+1 WHERE group_id=?")
      .run(f.group.groupId);
    const blocked = await f.respond(root);
    assert.equal(blocked.relay?.status, "blocked");
    assert.equal(blocked.relay?.reason, "relayBindingChanged");
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});
