import assert from "node:assert/strict";
import test from "node:test";
import { handoff, relayFixture } from "./crewRelayFixture.js";

test("relay settings default to manual, two automatic hops, thirty minutes and unpaused", async () => {
  const f = await relayFixture();
  try {
    const group = (await f.service.get(f.scope)).group;
    assert.equal(group.relayMode, "manual");
    assert.equal(group.relayAutoHops, 2);
    assert.equal(group.relayBudgetMinutes, 30);
    assert.equal(group.relayPaused, false);
  } finally {
    await f.close();
  }
});

for (const mode of ["manual", "semi", "auto"] as const) {
  test(`${mode}: user-selected root planner uses only the last tag and always requires approval`, async () => {
    const f = await relayFixture({
      mode,
      reply: () => `${handoff("Coordinator", "obsolete")}\n${handoff("Developer")}`,
    });
    try {
      const root = await f.start();
      assert.equal(root.status, "succeeded");
      assert.equal(root.hop, 0);
      assert.equal(root.rootRequestId, root.messageId);
      assert.deepEqual(root.relay, {
        kind: "plan",
        status: "awaiting_user_approval",
        to: "Developer",
        toMemberId: f.group.members[1]!.memberId,
        objective: "Implement feature",
        context: "Approved scope",
      });
      assert.equal(f.calls.length, 1);
      assert.equal(f.executions().length, 1);
      const detail = await f.service.get(f.scope);
      assert.equal(detail.conversation.status, "awaiting_user_approval");
      assert.equal(detail.messages.filter((message) => message.sender === "member").length, 1);
    } finally {
      await f.close();
    }
  });
}

test("a directly selected developer is also a root planner, without a PM role heuristic", async () => {
  const f = await relayFixture({ mode: "auto", reply: () => handoff("Coordinator") });
  try {
    const root = await f.start(
      "developer-root",
      f.scope.conversationId,
      f.group.members[1]!.memberId,
    );
    assert.equal(root.memberSnapshot.name, "Developer");
    assert.equal(root.relay?.kind, "plan");
    assert.equal(root.relay?.status, "awaiting_user_approval");
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});

test("auto: approved PM → developer → PM → developer does not repeat the root plan gate", async () => {
  const f = await relayFixture({
    mode: "auto",
    reply: ({ execution }) => {
      if (execution.hop === 0) return handoff("Developer", "Build first change");
      if (execution.hop === 1) return handoff("Coordinator", "Summarize results");
      if (execution.hop === 2) return handoff("Developer", "Apply review feedback");
      return "All done";
    },
  });
  try {
    const root = await f.start();
    const accepted = await f.respond(root);
    assert.equal(accepted.executionId, root.executionId, "approval returns the source execution");
    assert.equal(accepted.relay?.automatic, false);
    await f.service.whenIdle();
    const chain = f.executions();
    assert.deepEqual(
      chain.map((item) => item.hop),
      [0, 1, 2, 3],
    );
    assert.deepEqual(
      chain.map((item) => item.memberSnapshot.name),
      ["Coordinator", "Developer", "Coordinator", "Developer"],
    );
    assert.ok(
      chain.every((item) => item.rootRequestId === root.messageId && item.status === "succeeded"),
    );
    assert.deepEqual(
      chain.slice(0, 3).map((item) => item.relay?.kind),
      ["plan", "handoff", "handoff"],
    );
    assert.deepEqual(
      chain.slice(0, 3).map((item) => item.relay?.status),
      ["dispatched", "dispatched", "dispatched"],
    );
    assert.deepEqual(
      chain.slice(0, 3).map((item) => item.relay?.automatic),
      [false, true, true],
    );
    assert.equal(chain[3]!.relay, undefined);
    assert.equal(f.calls.length, 4);
    assert.ok(
      f.calls.every(
        (call) => call.execution.workspaceBinding.workspaceIdentity === f.binding.workspaceIdentity,
      ),
    );
  } finally {
    await f.close();
  }
});

test("manual: every non-root handoff remains pending until its own approval", async () => {
  const f = await relayFixture({
    mode: "manual",
    reply: ({ execution }) =>
      (execution.hop ?? 0) < 3
        ? handoff(execution.hop === 1 ? "Coordinator" : "Developer", `Objective ${execution.hop}`)
        : "Done",
  });
  try {
    await f.start();
    for (let hop = 0; hop < 3; hop++) {
      const source = f.executions().at(-1)!;
      assert.equal(source.hop, hop);
      assert.equal(source.relay?.status, "awaiting_user_approval");
      assert.equal(f.calls.length, hop + 1);
      assert.equal((await f.respond(source)).executionId, source.executionId);
      await f.service.whenIdle();
    }
    assert.equal(f.calls.length, 4);
    assert.ok(
      f
        .executions()
        .slice(0, 3)
        .every((item) => item.relay?.automatic === false),
    );
  } finally {
    await f.close();
  }
});

for (const autoHops of [0, 1, 2]) {
  test(`semi: next-hop <= K with K=${autoHops}, including after manual approval beyond K`, async () => {
    const f = await relayFixture({
      mode: "semi",
      autoHops,
      reply: ({ execution }) =>
        handoff(
          (execution.hop ?? 0) % 2 === 0 ? "Developer" : "Coordinator",
          `Hop ${execution.hop}`,
        ),
    });
    try {
      const root = await f.start();
      assert.equal(root.relay?.status, "awaiting_user_approval");
      await f.respond(root);
      await f.service.whenIdle();
      const boundary = Math.max(1, autoHops);
      assert.equal(f.calls.length, boundary + 1);
      assert.ok(
        f
          .executions()
          .slice(1, boundary)
          .every((item) => item.relay?.automatic === true),
      );
      const pending = f.executions().at(-1)!;
      assert.equal(pending.hop, boundary);
      assert.equal(pending.relay?.status, "awaiting_user_approval");
      await f.respond(pending);
      await f.service.whenIdle();
      assert.equal(f.executions().at(-1)!.hop, boundary + 1);
      assert.equal(f.executions().at(-1)!.relay?.status, "awaiting_user_approval");
      assert.equal(f.calls.length, boundary + 2);
    } finally {
      await f.close();
    }
  });
}

test("rejecting a plan is persistent and idempotent; later approval conflicts", async () => {
  const f = await relayFixture({ mode: "auto", reply: () => handoff("Developer") });
  try {
    const root = await f.start();
    const rejected = await f.respond(root, false);
    assert.equal(rejected.executionId, root.executionId);
    assert.equal(rejected.relay?.status, "rejected");
    assert.deepEqual(await f.respond(root, false), rejected);
    await assert.rejects(f.respond(root), /relayDecisionConflict/);
    await f.service.whenIdle();
    assert.equal(f.executions().length, 1);
    assert.equal(f.calls.length, 1);
    assert.notEqual((await f.service.get(f.scope)).conversation.status, "awaiting_user_approval");
  } finally {
    await f.close();
  }
});

const invalidFinals = [
  ["no tag", "Finished"],
  ["free mention", "@Developer please implement this"],
  ["invalid JSON", "<crew-handoff>{oops}</crew-handoff>"],
  ["missing context", '<crew-handoff>{"to":"Developer","objective":"Build"}</crew-handoff>'],
  [
    "unknown field",
    '<crew-handoff>{"to":"Developer","objective":"Build","context":"","extra":1}</crew-handoff>',
  ],
  ["blank objective", handoff("Developer", "   ")],
  ["invalid last tag", `${handoff("Developer")}\n<crew-handoff>broken</crew-handoff>`],
  ["unterminated last tag", `${handoff("Developer")}\n<crew-handoff>{`],
];
for (const [name, text] of invalidFinals) {
  test(`${name}: successful final output ends the chain without dispatch or a pending proposal`, async () => {
    const f = await relayFixture({ mode: "auto", reply: () => text! });
    try {
      const root = await f.start();
      assert.equal(root.status, "succeeded");
      assert.equal(root.relay, undefined);
      assert.equal(f.calls.length, 1);
      assert.equal(f.executions().length, 1);
      await assert.rejects(f.respond(root), /relayNotFound/);
    } finally {
      await f.close();
    }
  });
}

for (const ambiguous of [false, true]) {
  test(`${ambiguous ? "ambiguous" : "missing"} target cannot dispatch`, async () => {
    const f = await relayFixture({
      mode: "auto",
      reply: () => handoff(ambiguous ? "Developer" : "Missing"),
    });
    try {
      if (ambiguous) {
        const duplicate = await f.catalog.create({
          name: "Developer",
          systemPrompt: "Different agent",
          runtime: "zcode",
          accessMode: "read",
        });
        await f.service.update({
          groupId: f.group.groupId,
          members: [...f.group.members, { agentId: duplicate.agentId }],
        });
      }
      const root = await f.start();
      assert.equal(root.relay?.status, "blocked");
      assert.equal(root.relay?.reason, "relayMemberNotFound");
      await f.respond(root);
      assert.equal(f.calls.length, 1);
      assert.equal(f.executions().length, 1);
    } finally {
      await f.close();
    }
  });
}
