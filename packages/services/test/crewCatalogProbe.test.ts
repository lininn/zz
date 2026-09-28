import assert from "node:assert/strict";
import test from "node:test";
import { externalCrewFixture } from "./crewExternalRuntimeFixture.js";

test("catalog edits during provider probe cannot authorize a different definition; retry resolves it", async () => {
  const f = await externalCrewFixture();
  try {
    const original = f.runtime.probeMember!;
    let changed = false;
    f.runtime.probeMember = async (binding, member) => {
      const result = await original(binding, member);
      if (!changed) {
        changed = true;
        await f.catalog.update({ agentId: f.roleAgent.agentId, systemPrompt: "new role" });
      }
      return result;
    };
    await assert.rejects(f.send("race"), /crew.staleExecution/);
    assert.equal((await f.service.get({ groupId: f.group.groupId })).executions.length, 0);
    const accepted = await f.send("race");
    await f.service.whenIdle();
    assert.equal(accepted.execution?.memberSnapshot.rolePrompt, "new role");
    await f.catalog.update({ agentId: f.roleAgent.agentId, systemPrompt: "later" });
    assert.deepEqual(
      (await f.send("race")).execution?.memberSnapshot,
      accepted.execution?.memberSnapshot,
    );
  } finally {
    await f.close();
  }
});
