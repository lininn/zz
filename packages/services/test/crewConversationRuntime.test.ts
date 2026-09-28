import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildCrewPrompt } from "../src/crew/crewRuntime.js";
import { externalCrewFixture, waitForTask } from "./crewExternalRuntimeFixture.js";

test("legacy default vendor key is preserved; non-default keys are distinct and same-conversation resume is stable", async () => {
  const f = await externalCrewFixture();
  try {
    const a = (await f.service.get({ groupId: f.group.groupId })).conversation;
    const b = await f.service.createConversation({
      groupId: f.group.groupId,
      name: "Separate vendor session",
    });
    for (const [conversationId, messageId] of [
      [a.conversationId, "first"],
      [b.conversationId, "first"],
      [a.conversationId, "followup"],
      [b.conversationId, "followup"],
    ]) {
      await f.send(messageId!, conversationId);
      await f.service.whenIdle();
    }
    const starts = f.calls.filter((call) => call.action === "start");
    assert.equal(starts.length, 4);
    const defaultDetail = await f.service.get({ groupId: f.group.groupId });
    const defaultExecution = defaultDetail.executions[0]!;
    const legacyKey = `crew_${createHash("sha256")
      .update(
        JSON.stringify([f.group.groupId, defaultExecution.epoch, defaultExecution.memberSnapshot]),
      )
      .digest("hex")}`;
    // 默认会话必须复用 v5 key；仅验证新 key 稳定无法防止旧 native history 续接失效。
    assert.equal(starts[0]!.sessionId, legacyKey);
    assert.equal(starts[2]!.sessionId, legacyKey);
    const nonDefaultKey = `crew_${createHash("sha256")
      .update(
        JSON.stringify([
          f.group.groupId,
          b.conversationId,
          defaultExecution.epoch,
          defaultExecution.memberSnapshot,
        ]),
      )
      .digest("hex")}`;
    assert.equal(starts[1]!.sessionId, nonDefaultKey);
    assert.equal(starts[3]!.sessionId, nonDefaultKey);
    assert.notEqual(starts[0]!.sessionId, starts[1]!.sessionId);
    assert.equal(starts[2]!.sessionId, starts[0]!.sessionId);
    assert.equal(starts[3]!.sessionId, starts[1]!.sessionId);
    assert.equal(starts[0]!.resumeTaskId, undefined);
    assert.equal(starts[1]!.resumeTaskId, undefined);
    assert.equal(starts[2]!.resumeTaskId, starts[0]!.taskId);
    assert.equal(starts[3]!.resumeTaskId, starts[1]!.taskId);
    assert.equal(new Set(starts.map((call) => call.taskId)).size, 4);
    for (const { conversationId } of [a, b]) {
      const detail = await f.service.get({ groupId: f.group.groupId, conversationId });
      assert.deepEqual(
        detail.executions.map((execution) => execution.status),
        ["succeeded", "succeeded"],
      );
    }
  } finally {
    await f.close();
  }
});

test("mixed prompt input selects group plus conversation before resolving shared message IDs", async () => {
  const f = await externalCrewFixture();
  try {
    const a = (await f.service.get({ groupId: f.group.groupId })).conversation;
    const b = await f.service.createConversation({ groupId: f.group.groupId });
    for (const [conversation, prefix] of [
      [a, "own"],
      [b, "other-conversation"],
    ] as const) {
      await f.service.send({
        groupId: f.group.groupId,
        conversationId: conversation.conversationId,
        messageId: "history",
        text: `${prefix}-history`,
        mentions: [],
      });
      await f.service.send({
        groupId: f.group.groupId,
        conversationId: conversation.conversationId,
        messageId: "request",
        text: `${prefix}-task`,
        mentions: [f.group.members[0]!.memberId],
      });
      await f.service.whenIdle();
    }
    const own = await f.service.get({ groupId: f.group.groupId, conversationId: a.conversationId });
    const other = await f.service.get({
      groupId: f.group.groupId,
      conversationId: b.conversationId,
    });
    const foreignGroup = own.messages.map((message) => ({
      ...message,
      groupId: "another-group",
      text: "other-group-secret",
    }));
    const input = {
      group: own.group,
      member: own.executions[0]!.memberSnapshot,
      execution: own.executions[0]!,
      // 故意把同 messageId 的外组/外会话放在最前，防止先 find 再过滤导致任务串线。
      messages: [...foreignGroup, ...other.messages, ...own.messages],
      onTaskCreated: async () => {},
    };
    const prompt = buildCrewPrompt(input);
    assert.ok(prompt.includes("own-history"));
    assert.ok(prompt.includes("own-task"));
    assert.ok(prompt.includes(f.roleAgent.systemPrompt));
    assert.ok(!prompt.includes("other-conversation"));
    assert.ok(!prompt.includes("other-group-secret"));
    assert.ok(!prompt.includes("External result"));
    assert.throws(
      () => buildCrewPrompt({ ...input, messages: [...foreignGroup, ...other.messages] }),
      /messageNotFound/,
    );
    const starts = f.calls.filter((call) => call.action === "start");
    assert.ok(starts[0]!.objective.includes("own-history"));
    assert.ok(!starts[1]!.objective.includes("own-history"));
    assert.ok(starts[1]!.objective.includes("other-conversation-history"));
  } finally {
    await f.close();
  }
});

for (const approved of [true, false]) {
  test(`cross-conversation permission/cancel is denied while correct conversation can ${approved ? "approve" : "deny"}`, async () => {
    const f = await externalCrewFixture();
    try {
      const b = await f.service.createConversation({ groupId: f.group.groupId });
      f.permission(true);
      const sent = await f.send("permission", b.conversationId);
      const task = await waitForTask(f);
      const params = {
        groupId: f.group.groupId,
        executionId: sent.execution!.executionId,
        requestId: "p1",
        approved,
      };
      const own = await f.service.get({
        groupId: f.group.groupId,
        conversationId: b.conversationId,
      });
      assert.equal(own.executions[0]!.permission?.requestId, "p1");
      assert.deepEqual((await f.service.get({ groupId: f.group.groupId })).executions, []);
      const before = { ...task };
      const mutationCalls = () =>
        f.calls.filter((call) => call.action === "permission" || call.action === "cancel");
      for (const conversationId of [undefined, f.group.groupId]) {
        await assert.rejects(
          f.service.respondPermission({ ...params, conversationId }),
          /permissionNotFound/,
        );
        await assert.rejects(
          f.service.cancel({
            groupId: f.group.groupId,
            conversationId,
            executionId: params.executionId,
          }),
          /executionNotFound/,
        );
      }
      assert.deepEqual(task, before);
      assert.deepEqual(mutationCalls(), []);
      assert.equal((await f.leases.get(f.dir))?.sessionId, task.taskId);
      await f.service.respondPermission({ ...params, conversationId: b.conversationId });
      await f.service.whenIdle();
      const done = await f.service.get({
        groupId: f.group.groupId,
        conversationId: b.conversationId,
      });
      assert.equal(done.executions[0]!.status, approved ? "succeeded" : "cancelled");
      assert.equal(done.executions[0]!.permission, undefined);
      assert.equal(done.messages.length, 2);
      assert.deepEqual(
        mutationCalls().map((call) => call.action),
        [approved ? "permission" : "cancel"],
      );
      assert.deepEqual((await f.service.get({ groupId: f.group.groupId })).messages, []);
      assert.equal(await f.leases.get(f.dir), null);
    } finally {
      await f.close();
    }
  });
}

test("real runtime/admission/lease path keeps cross-conversation and ordinary workspace writes mutually exclusive", async () => {
  const f = await externalCrewFixture();
  const rejected = Promise.withResolvers<unknown>();
  try {
    const b = await f.service.createConversation({ groupId: f.group.groupId });
    await f.catalog.update({ agentId: f.roleAgent.agentId, accessMode: "write" });
    f.running(true);
    const first = await f.send("writer-a");
    const task = await waitForTask(f);
    const lease = await f.leases.get(f.dir);
    assert.equal(lease?.sessionId, task.taskId);
    let ordinaryStarted = false;
    await assert.rejects(
      f.gate.run({ workspacePath: f.dir, sessionId: "ordinary" }, async () => {
        ordinaryStarted = true;
      }),
      /workspaceBusy/,
    );
    assert.equal(ordinaryStarted, false);
    const execute = f.runtime.execute.bind(f.runtime);
    f.runtime.execute = async (input) => {
      try {
        return await execute(input);
      } catch (error) {
        if (input.execution.conversationId === b.conversationId) rejected.resolve(error);
        throw error;
      }
    };
    const second = await f.send("writer-b", b.conversationId);
    assert.match(String(await rejected.promise), /crew.workspaceBusy/);
    assert.deepEqual(await f.leases.get(f.dir), lease);
    assert.equal(task.runtimeState, "running");
    assert.equal(f.calls.filter((call) => call.action === "start").length, 1);
    await f.service.cancel({ groupId: f.group.groupId, executionId: first.execution!.executionId });
    await f.service.whenIdle();
    const failed = await f.service.get({
      groupId: f.group.groupId,
      conversationId: b.conversationId,
    });
    assert.equal(failed.executions[0]!.executionId, second.execution!.executionId);
    assert.equal(failed.executions[0]!.status, "failed");
    assert.equal(failed.messages.at(-1)!.text, "crew.workspaceBusy");
    assert.equal(await f.leases.get(f.dir), null);
    f.running(false);
    await f.send("writer-b-after-release", b.conversationId);
    await f.service.whenIdle();
    const done = await f.service.get({
      groupId: f.group.groupId,
      conversationId: b.conversationId,
    });
    assert.deepEqual(
      done.executions.map((execution) => execution.status),
      ["failed", "succeeded"],
    );
    assert.equal(f.calls.filter((call) => call.action === "start").length, 2);
    assert.equal(await f.leases.get(f.dir), null);
  } finally {
    await f.close();
  }
});
