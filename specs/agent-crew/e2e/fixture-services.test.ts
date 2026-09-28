import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { fixtureServices, fixtureControl, fixtureState } from "./fixture-services.js";

const crew = fixtureServices.crewService!;
test("offline fixture provides explicit isolated conversations and controllable late reads/commands", async () => {
  const group = await crew.create({ name: "Fixture group", members: [] });
  await crew.bind({ groupId: group.groupId, binding: { workspacePath: "/fixture/workspace" } });
  const a = (await crew.listConversations({ groupId: group.groupId }))[0]!;
  assert.equal(a.conversationId, group.groupId);
  assert.equal(a.isDefault, true);
  assert.equal(a.name, "");
  const b = await crew.createConversation({ groupId: group.groupId });
  assert.notEqual(b.conversationId, group.groupId);
  for (const conversationId of [a.conversationId, b.conversationId]) {
    await crew.send({
      groupId: group.groupId,
      conversationId,
      messageId: "same-id",
      text: conversationId,
      mentions: [],
    });
  }
  const target = { groupId: group.groupId, conversationId: a.conversationId };
  const gate = fixtureControl.deferNext("get", a.conversationId);
  const delayed = crew.get(target);
  await setImmediate();
  assert.equal(fixtureState().gates.find((item) => item.id === gate)?.waiting, true);
  assert.equal(
    (await crew.get({ ...target, conversationId: b.conversationId })).messages[0]?.text,
    b.conversationId,
  );
  fixtureControl.release(gate);
  assert.equal((await delayed).messages[0]?.text, a.conversationId);
  assert.equal((await crew.get(target)).messages[0]?.sequence, 1);
  await assert.rejects(crew.get({ groupId: group.groupId }), /conversationNotFound/);
  await assert.rejects(crew.get({ ...target, conversationId: "foreign" }), /conversationNotFound/);
  const sendGate = fixtureControl.deferNext("send", a.conversationId);
  const rejected = crew.send({ ...target, messageId: "fail", text: "no commit", mentions: [] });
  await setImmediate();
  fixtureControl.release(sendGate, "crew.workspaceBusy");
  await assert.rejects(rejected, /workspaceBusy/);
  assert.equal((await crew.get(target)).messages.length, 1);
});

test("relay fixture preserves settings and requires explicit root approval without replay on resume", async () => {
  const catalog = fixtureServices.crewAgentCatalogService;
  const members = await Promise.all(
    ["Planner", "Builder"].map((name) =>
      catalog.create({ name, systemPrompt: "Fixture", runtime: "zcode", accessMode: "read" }),
    ),
  );
  const group = await crew.create({
    name: "Relay fixture",
    members: members.map((member) => ({ agentId: member.agentId })),
    relayMode: "auto",
  });
  const target = { groupId: group.groupId, conversationId: group.groupId };
  await crew.bind({ groupId: group.groupId, binding: { workspacePath: "/fixture/workspace" } });
  const plan = fixtureControl.seedRelay(target);
  assert.equal((await crew.get(target)).conversation.status, "awaiting_user_approval");
  assert.equal((await crew.get(target)).executions.length, 1);
  await crew.respondRelay({ ...target, executionId: plan.executionId, approved: true });
  assert.equal((await crew.get(target)).executions.length, 2);
  await crew.update({ groupId: group.groupId, relayPaused: true });
  await crew.update({ groupId: group.groupId, relayPaused: false });
  assert.equal((await crew.get(target)).executions.length, 2);
  await crew.update({
    groupId: group.groupId,
    relayMode: "semi",
    relayAutoHops: 1,
    relayBudgetMinutes: 20,
  });
  assert.equal((await crew.get(target)).group.relayBudgetMinutes, 20);
  const reject = fixtureControl.seedRelay(target);
  await crew.respondRelay({ ...target, executionId: reject.executionId, approved: false });
  assert.equal((await crew.get(target)).executions.length, 1);
  await assert.rejects(
    crew.respondRelay({ ...target, executionId: reject.executionId, approved: true }),
    /relayDecisionConflict/,
  );
});
