import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import { CrewExecutionStore } from "../src/crew/crewExecutionStore.js";
import { CrewStore } from "../src/crew/crewStore.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "crew-conversation-store-"));
  const databasePath = join(directory, "tasks.sqlite");
  const catalog = new CrewAgentCatalogService(databasePath);
  const agent = await catalog.create({
    name: "Shared",
    systemPrompt: "Work",
    runtime: "zcode",
    accessMode: "write",
  });
  const store = new CrewStore(databasePath),
    other = new CrewStore(databasePath);
  await store.initialize();
  await other.initialize();
  const group = store.transaction(() =>
    store.create("Group", [{ memberId: "member", agentId: agent.agentId }]),
  );
  store.transaction(() => store.bind(group.groupId, { workspacePath: directory }, 0));
  const second = store.transaction(() => store.createConversation(group.groupId, "Second"));
  const enqueue = (conversationId: string, messageId = "same", text = conversationId) =>
    store.transaction(() =>
      store.enqueue({
        groupId: group.groupId,
        conversationId,
        messageId,
        text,
        mentions: ["member"],
      }),
    );
  return {
    store,
    other,
    group,
    second,
    enqueue,
    async dispose() {
      await store.shutdown();
      await other.shutdown();
      await catalog.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("two store connections claim per-conversation queues without changing shared group guards", async () => {
  const f = await fixture();
  try {
    const a = f.enqueue(f.group.groupId),
      b = f.enqueue(f.second.conversationId);
    assert.notEqual(a.execution?.executionId, b.execution?.executionId);
    assert.equal(a.message.sequence, 1);
    assert.equal(b.message.sequence, 1);
    assert.deepEqual(f.enqueue(f.second.conversationId), b);
    assert.throws(() => f.enqueue(f.second.conversationId, "same", "changed"), /messageConflict/);
    const one = new CrewExecutionStore(f.store, "owner-one");
    const two = new CrewExecutionStore(f.other, "owner-two");
    const claimedA = one.claim(f.group.groupId)!;
    const claimedB = two.claim(f.group.groupId, f.second.conversationId)!;
    assert.equal(claimedA.executionId, a.execution?.executionId);
    assert.equal(claimedB.executionId, b.execution?.executionId);
    assert.equal(two.claim(f.group.groupId), null);
    assert.equal(one.claim(f.group.groupId, f.second.conversationId), null);
    assert.throws(() => f.store.assertIdle(f.group.groupId), /groupBusy/);
    one.finish(claimedA, "succeeded", "Reply A");
    two.finish(claimedB, "succeeded", "Reply B");
    assert.deepEqual(
      f.store.messages(f.group.groupId).map((m) => m.text),
      [f.group.groupId, "Reply A"],
    );
    assert.deepEqual(
      f.store.messages(f.group.groupId, f.second.conversationId).map((m) => m.text),
      [f.second.conversationId, "Reply B"],
    );
    assert.equal(f.store.executions(f.group.groupId).length, 1);
    assert.equal(f.store.executions(f.group.groupId, f.second.conversationId).length, 1);
    f.store.assertIdle(f.group.groupId);
  } finally {
    await f.dispose();
  }
});

test("recovery in A blocks only A admission/claim while B context and queue remain isolated", async () => {
  const f = await fixture();
  try {
    f.enqueue(f.group.groupId);
    const claims = new CrewExecutionStore(f.store, "owner");
    const running = claims.claim(f.group.groupId)!;
    claims.recovery(running);
    assert.equal(f.store.conversation(f.group.groupId).status, "recovery_required");
    assert.equal(f.store.conversation(f.group.groupId, f.second.conversationId).status, "idle");
    assert.throws(() => f.enqueue(f.group.groupId, "next"), /recoveryRequired/);
    const b = f.enqueue(f.second.conversationId);
    assert.equal(
      claims.claim(f.group.groupId, f.second.conversationId)?.executionId,
      b.execution?.executionId,
    );
    assert.equal(claims.claim(f.group.groupId), null);
    assert.deepEqual(
      f.store.context(b.execution!).map((m) => m.conversationId),
      [f.second.conversationId],
    );
    assert.equal(f.store.group(f.group.groupId).status, "recovery_required");
    assert.throws(() => f.store.transaction(() => f.store.delete(f.group.groupId)), /groupBusy/);
    const foreign = f.store.transaction(() => f.store.create("Other", []));
    assert.throws(
      () => f.store.messages(foreign.groupId, f.second.conversationId),
      /conversationNotFound/,
    );
  } finally {
    await f.dispose();
  }
});
