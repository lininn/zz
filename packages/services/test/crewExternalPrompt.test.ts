import assert from "node:assert/strict";
import test from "node:test";
import { externalCrewFixture } from "./crewExternalRuntimeFixture.js";

test("external prompt prunes old board context to the existing 8000-char dispatch contract", async () => {
  const f = await externalCrewFixture();
  try {
    for (let index = 0; index < 12; index++)
      await f.service.send({
        groupId: f.group.groupId,
        messageId: `history-${index}`,
        mentions: [],
        text: `history-${index}: ${"reference ".repeat(250)}`,
      });
    await f.send("bounded");
    await f.service.whenIdle();
    const command = f.calls.find((call) => call.action === "start");
    assert(command && command.objective.length <= 8000);
    assert(command.objective.includes("Task bounded"));
    assert(command.objective.includes(f.roleAgent.systemPrompt));
    assert(command.objective.includes("history-11:"));
    assert(!command.objective.includes("history-0:"));
  } finally {
    await f.close();
  }
});
test("oversized role/current task fails clearly before task or lease, never truncates instructions", async () => {
  const f = await externalCrewFixture();
  try {
    await f.catalog.update({ agentId: f.roleAgent.agentId, systemPrompt: "role".repeat(2400) });
    await f.send("oversized");
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0]?.status, "failed");
    assert.equal(detail.executions[0]?.taskId, null);
    assert.equal(detail.messages.at(-1)?.text, "crew.promptTooLarge");
    assert.equal(f.calls.filter((call) => call.action === "start").length, 0);
    assert.equal(await f.leases.get(f.dir), null);
  } finally {
    await f.close();
  }
});
