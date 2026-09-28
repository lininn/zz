import assert from "node:assert/strict";
import test from "node:test";
import { conversationFixture } from "./crewConversationFixture.js";

test("same-group conversations isolate messages, executions, sequences, context and resume task", async () => {
  const f = await conversationFixture();
  try {
    for (const conversation of [f.a, f.b]) {
      await f.service.send({
        ...f.params(
          conversation.conversationId,
          "context",
          `private:${conversation.conversationId}`,
        ),
        mentions: [],
      });
      await f.send(
        conversation.conversationId,
        "same-message",
        `task:${conversation.conversationId}`,
      );
      await f.service.whenIdle();
    }
    for (const conversation of [f.a, f.b]) {
      await f.send(conversation.conversationId, "followup");
      await f.service.whenIdle();
    }
    const details = await Promise.all(
      [f.a, f.b].map(({ conversationId }) =>
        f.service.get({ groupId: f.group.groupId, conversationId }),
      ),
    );
    for (const [index, detail] of details.entries()) {
      const ownId = detail.conversation.conversationId;
      const otherId = details[1 - index]!.conversation.conversationId;
      assert.deepEqual(
        detail.messages.map((message) => message.sequence),
        [1, 2, 3, 4, 5],
      );
      assert.deepEqual(
        detail.messages.map((message) => message.text),
        [`private:${ownId}`, `task:${ownId}`, "reply:same-message", "followup", "reply:followup"],
      );
      assert.ok(detail.messages.every((message) => message.conversationId === ownId));
      assert.deepEqual(
        detail.executions.map((execution) => execution.status),
        ["succeeded", "succeeded"],
      );
      assert.ok(detail.executions.every((execution) => execution.conversationId === ownId));
      const calls = f.calls.filter((call) => call.execution.conversationId === ownId);
      assert.equal(calls.length, 2);
      assert.equal(calls[0]!.resumeTaskId, undefined);
      assert.equal(calls[1]!.resumeTaskId, detail.executions[0]!.taskId);
      assert.deepEqual(
        calls[0]!.messages.map((message) => message.text),
        [`private:${ownId}`, `task:${ownId}`],
      );
      assert.deepEqual(
        calls[1]!.messages.map((message) => message.sequence),
        [1, 2, 3, 4],
      );
      assert.ok(
        calls.every((call) =>
          call.messages.every(
            (message) => message.conversationId === ownId && !message.text.includes(otherId),
          ),
        ),
      );
    }
    assert.notEqual(details[0]!.executions[0]!.executionId, details[1]!.executions[0]!.executionId);
    const duplicate = await f.send(
      f.a.conversationId,
      "same-message",
      `task:${f.a.conversationId}`,
    );
    assert.equal(duplicate.execution?.executionId, details[0]!.executions[0]!.executionId);
    await assert.rejects(f.send(f.a.conversationId, "same-message", "changed"), /messageConflict/);
    await assert.rejects(
      f.service.send({
        ...f.params(f.a.conversationId, "same-message", `task:${f.a.conversationId}`),
        mentions: [],
      }),
      /messageConflict/,
    );
    await f.service.whenIdle();
    assert.equal(f.calls.length, 4);
    assert.deepEqual(
      await f.service.get({ groupId: f.group.groupId, conversationId: f.b.conversationId }),
      details[1],
    );
  } finally {
    await f.close();
  }
});

test("omitted conversation ID always resolves the fixed default, never the latest conversation", async () => {
  const f = await conversationFixture();
  try {
    assert.equal(f.a.conversationId, f.group.groupId);
    assert.equal(f.a.isDefault, true);
    assert.equal(f.b.isDefault, false);
    await f.send(f.b.conversationId, "non-default");
    await f.service.whenIdle();
    const third = await f.service.createConversation({ groupId: f.group.groupId });
    await f.service.get({ groupId: f.group.groupId, conversationId: third.conversationId });
    await f.send(undefined, "legacy");
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.conversation.conversationId, f.a.conversationId);
    assert.deepEqual(
      detail.messages.map((message) => message.text),
      ["legacy", "reply:legacy"],
    );
    assert.deepEqual(
      detail.conversations,
      await f.service.listConversations({ groupId: f.group.groupId }),
    );
    assert.equal(detail.conversations.length, 3);
    assert.deepEqual(f.store.messages(f.group.groupId, third.conversationId), []);
    assert.deepEqual(f.store.executions(f.group.groupId, third.conversationId), []);
  } finally {
    await f.close();
  }
});

test("conversations reuse group membership and resolve catalog edits without rewriting accepted snapshots", async () => {
  const f = await conversationFixture();
  try {
    await f.send(f.a.conversationId, "before");
    await f.service.whenIdle();
    const before = f.store.executions(f.group.groupId, f.a.conversationId)[0]!;
    const reviewer = await f.catalog.create({
      name: "Reviewer",
      systemPrompt: "Review",
      runtime: "zcode",
      accessMode: "read",
    });
    const updated = await f.service.update({
      groupId: f.group.groupId,
      members: [...f.group.members, { agentId: reviewer.agentId }],
    });
    await f.catalog.update({ agentId: f.agent.agentId, systemPrompt: "Updated role" });
    for (const { conversationId } of [f.a, f.b]) {
      const detail = await f.service.get({ groupId: f.group.groupId, conversationId });
      assert.deepEqual(detail.group.members, updated.members);
      assert.deepEqual(
        detail.resolvedMembers.map((member) => member.agentId),
        [f.agent.agentId, reviewer.agentId],
      );
      assert.equal(detail.resolvedMembers[0]!.rolePrompt, "Updated role");
      await f.send(conversationId, "after");
      await f.service.whenIdle();
    }
    assert.deepEqual(f.store.execution(before.executionId), before);
    assert.ok(
      f.calls
        .slice(1)
        .every(
          (call) => call.member.rolePrompt === "Updated role" && call.resumeTaskId === undefined,
        ),
    );
  } finally {
    await f.close();
  }
});

for (const status of ["queued", "running", "recovery_required"] as const) {
  test(`non-default ${status} work protects group-wide binding, membership and deletion`, async () => {
    const f = await conversationFixture();
    try {
      const unresolved = f.seed(f.b.conversationId, "busy", status);
      const before = f.store.group(f.group.groupId);
      const defaultDetail = await f.service.get({ groupId: f.group.groupId });
      assert.deepEqual(defaultDetail.executions, []);
      for (const mutation of [
        () =>
          f.service.bind({
            groupId: f.group.groupId,
            binding: { ...f.binding, workspaceIdentity: "different" },
          }),
        () => f.service.update({ groupId: f.group.groupId, members: [] }),
        () => f.service.delete({ groupId: f.group.groupId }),
      ])
        await assert.rejects(mutation, /groupBusy/);
      assert.deepEqual(f.store.group(f.group.groupId), before);
      assert.deepEqual(f.store.execution(unresolved.executionId), unresolved);
      const renamed = await f.service.update({
        groupId: f.group.groupId,
        name: "Rename while busy",
      });
      assert.equal(renamed.name, "Rename while busy");
      assert.deepEqual(renamed.members, before.members);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.close();
    }
  });
}

test("cross-group conversation IDs reject every scoped endpoint without mutating either group", async () => {
  const f = await conversationFixture();
  try {
    const foreign = await f.service.create({ name: "Foreign team", members: [] });
    const foreignConversation = await f.service.createConversation({ groupId: foreign.groupId });
    const queued = f.seed(f.b.conversationId, "queued");
    const ownBefore = f.store.detail(f.group.groupId, f.b.conversationId);
    const foreignBefore = f.store.detail(foreign.groupId, foreignConversation.conversationId);
    const target = { groupId: f.group.groupId, conversationId: foreignConversation.conversationId };
    for (const operation of [
      () => f.service.get(target),
      () => f.service.send({ ...f.params(target.conversationId, "forged"), ...target }),
      () => f.service.recover(target),
      () => f.service.cancel({ ...target, executionId: queued.executionId }),
      () =>
        f.service.respondPermission({
          ...target,
          executionId: queued.executionId,
          requestId: "p1",
          approved: true,
        }),
    ])
      await assert.rejects(operation, /conversationNotFound/);
    assert.deepEqual(f.store.detail(f.group.groupId, f.b.conversationId), ownBefore);
    assert.deepEqual(
      f.store.detail(foreign.groupId, foreignConversation.conversationId),
      foreignBefore,
    );
    assert.deepEqual(f.owners, []);
    assert.deepEqual(f.cancellations, []);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});
