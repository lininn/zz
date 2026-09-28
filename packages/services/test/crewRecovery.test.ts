import assert from "node:assert/strict";
import test from "node:test";
import { recoverCrewConversations } from "../src/crew/crewRecovery.js";
import { conversationFixture } from "./crewConversationFixture.js";

test("startup recovery visits every persisted conversation, including non-default queues", async () => {
  const f = await conversationFixture();
  try {
    const second = await f.service.create({ name: "Another team", members: [] });
    const extra = await f.service.createConversation({ groupId: second.groupId });
    f.seed(f.a.conversationId, "default");
    f.seed(f.b.conversationId, "non-default");
    await f.restart();
    const visited: string[] = [];
    const recover = f.service.recover.bind(f.service);
    f.service.recover = async (params) => {
      visited.push(`${params.groupId}/${params.conversationId}`);
      return recover(params);
    };
    await recoverCrewConversations(f.service);
    await f.service.whenIdle();
    assert.deepEqual(
      visited.sort(),
      [
        `${f.group.groupId}/${f.a.conversationId}`,
        `${f.group.groupId}/${f.b.conversationId}`,
        `${second.groupId}/${second.groupId}`,
        `${second.groupId}/${extra.conversationId}`,
      ].sort(),
    );
    assert.equal(f.calls.length, 2);
    assert.ok(
      f.calls.every((call) => f.store.execution(call.execution.executionId).status === "succeeded"),
    );
  } finally {
    await f.close();
  }
});

test("startup allSettled waits for all conversations and groups despite list and recovery rejection", async () => {
  const f = await conversationFixture();
  const release = Promise.withResolvers<void>();
  try {
    const broken = await f.service.create({ name: "List failure", members: [] });
    const healthy = await f.service.create({ name: "Healthy", members: [] });
    const extra = await f.service.createConversation({ groupId: healthy.groupId });
    const listed: string[] = [],
      visited: string[] = [],
      completed: string[] = [];
    const allVisited = Promise.withResolvers<void>();
    const listConversations = f.service.listConversations.bind(f.service);
    const recover = f.service.recover.bind(f.service);
    f.service.listConversations = async (params) => {
      listed.push(params.groupId);
      if (params.groupId === broken.groupId) throw new Error("list failed");
      return listConversations(params);
    };
    f.service.recover = async (params) => {
      visited.push(params.conversationId!);
      if (visited.length === 4) allVisited.resolve();
      if (params.conversationId === f.a.conversationId) throw new Error("recovery failed");
      await release.promise;
      const result = await recover(params);
      completed.push(params.conversationId!);
      return result;
    };
    let settled = false;
    const outcome = recoverCrewConversations(f.service).then(
      () => {
        settled = true;
        return null;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await allVisited.promise;
    assert.equal(settled, false);
    assert.deepEqual(completed, []);
    assert.deepEqual(listed.sort(), [f.group.groupId, broken.groupId, healthy.groupId].sort());
    assert.deepEqual(
      visited.sort(),
      [f.a.conversationId, f.b.conversationId, healthy.groupId, extra.conversationId].sort(),
    );
    release.resolve();
    assert.match(String(await outcome), /crew.recoveryRequired/);
    assert.deepEqual(
      completed.sort(),
      [f.b.conversationId, healthy.groupId, extra.conversationId].sort(),
    );
  } finally {
    release.resolve();
    await f.close();
  }
});
