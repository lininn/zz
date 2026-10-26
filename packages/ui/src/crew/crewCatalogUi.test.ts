import assert from "node:assert/strict";
import test from "node:test";
import type { CrewAgent } from "@zcode/shared";
import {
  crewAgentUpdate,
  crewEditorMembers,
  crewGroupInput,
  toggleCrewAgent,
} from "./crewCatalogUi.js";

const agent: CrewAgent = {
  agentId: "agent-a",
  configVersion: "v1",
  name: "Reader",
  systemPrompt: "Read evidence.",
  runtime: "zcode",
  accessMode: "read",
  createdAt: 0,
  updatedAt: 0,
};
test("group payload contains references only and preserves existing member IDs", () => {
  const members = [{ memberId: "member-a", agentId: agent.agentId, accessMode: "read" as const }];
  assert.deepEqual(crewGroupInput(" A ", members, [agent]), { name: "A", members });
  assert.deepEqual(crewGroupInput("B", [{ agentId: agent.agentId }], [agent]).members, [
    { agentId: agent.agentId },
  ]);
  assert.equal(agent.configVersion, "v1");
});
test("invalid references, duplicates and read-to-write escalation fail closed", () => {
  assert.throws(() => crewGroupInput("A", [{ agentId: "missing" }], [agent]), /agentNotFound/);
  assert.throws(
    () => crewGroupInput("A", [{ agentId: agent.agentId }, { agentId: agent.agentId }], [agent]),
    /duplicateAgentId/,
  );
  assert.throws(
    () => crewGroupInput("A", [{ agentId: agent.agentId, accessMode: "write" }], [agent]),
    /permissionEscalation/,
  );
  assert.equal(
    crewGroupInput(
      "A",
      [{ agentId: agent.agentId, accessMode: "read" }],
      [{ ...agent, accessMode: "write" }],
    ).members[0]?.accessMode,
    "read",
  );
});
test("catalog selection toggles a reference, never creates a definition or duplicate", () => {
  const first = toggleCrewAgent([], agent.agentId);
  assert.deepEqual(first, [{ agentId: agent.agentId }]);
  assert.deepEqual(toggleCrewAgent(first, agent.agentId), []);
});
test("catalog clear uses explicit null through JSON and external runtime cannot retain ZCode controls", () => {
  const { agentId, configVersion: _v, createdAt: _c, updatedAt: _u, ...input } = agent;
  const update = JSON.parse(JSON.stringify(crewAgentUpdate(agentId, input)));
  assert.equal(update.modelSelection, null);
  assert.equal(update.toolAllowlist, null);
  assert.deepEqual(crewAgentUpdate(agentId, { ...input, toolAllowlist: [] }).toolAllowlist, []);
  for (const runtime of ["claude-cli", "codex-cli", "opencode-cli"] as const) {
    const external = crewAgentUpdate(agentId, {
      ...input,
      runtime,
      modelSelection: { providerId: "p", modelId: "m" },
      toolAllowlist: ["Read"],
    });
    assert.equal(external.runtime, runtime);
    assert.equal(external.modelSelection, null);
    assert.equal(external.toolAllowlist, null);
  }
});

test("multiple groups share an agent ID without persisting its configuration", () => {
  const first = crewGroupInput("A", [{ agentId: agent.agentId, memberId: "member-a" }], [agent]);
  const updated = { ...agent, name: "New reader", configVersion: "v2", systemPrompt: "New prompt" };
  const second = crewGroupInput("B", [{ agentId: agent.agentId, memberId: "member-b" }], [updated]);
  assert.equal(first.members[0]?.agentId, second.members[0]?.agentId);
  assert.notEqual(first.members[0]?.memberId, second.members[0]?.memberId);
  assert.deepEqual(Object.keys(first.members[0]!).sort(), ["agentId", "memberId"]);
  assert.deepEqual(Object.keys(second.members[0]!).sort(), ["agentId", "memberId"]);
});

test("group payload rejects invalid names and more than 32 references", () => {
  assert.throws(() => crewGroupInput("   ", [], [agent]));
  const agents = Array.from({ length: 33 }, (_, index) => ({
    ...agent,
    agentId: `agent-${index}`,
  }));
  assert.throws(() =>
    crewGroupInput(
      "A",
      agents.map(({ agentId }) => ({ agentId })),
      agents,
    ),
  );
});

test("catalog downgrade reconciles an old write override so group rename can save", () => {
  const original = [{ memberId: "member-a", agentId: agent.agentId, accessMode: "write" as const }];
  const projected = crewEditorMembers(original, [agent]);
  assert.equal(projected[0]?.accessMode, "read");
  assert.deepEqual(crewGroupInput("Renamed group", projected, [agent]), {
    name: "Renamed group",
    members: [{ memberId: "member-a", agentId: agent.agentId, accessMode: "read" }],
  });
  assert.equal(original[0]?.accessMode, "write");
  assert.equal(agent.accessMode, "read");
  assert.equal(agent.configVersion, "v1");
  assert.throws(
    () => crewGroupInput("Direct escalation", original, [agent]),
    /permissionEscalation/,
  );
});

test("group payload rejects more than one manager member", () => {
  const managerA = { ...agent, agentId: "manager-a", isManager: true };
  const managerB = { ...agent, agentId: "manager-b", isManager: true };
  assert.throws(
    () =>
      crewGroupInput(
        "Two managers",
        [{ agentId: managerA.agentId }, { agentId: managerB.agentId }],
        [managerA, managerB],
      ),
    /multipleManagers/,
  );
  assert.deepEqual(
    crewGroupInput("One manager", [{ agentId: managerA.agentId }], [managerA, managerB]).members,
    [{ agentId: managerA.agentId }],
  );
});

test("agent update carries the manager flag and defaults new agents to non-manager", () => {
  const { agentId, configVersion: _v, createdAt: _c, updatedAt: _u, ...input } = agent;
  assert.equal(input.isManager, undefined);
  assert.equal(crewAgentUpdate(agentId, { ...input, isManager: true }).isManager, true);
  assert.equal(crewAgentUpdate(agentId, { ...input, isManager: false }).isManager, false);
});

test("editor reconciliation follows current catalog without widening existing read or inherited policies", () => {
  const writer = { ...agent, accessMode: "write" as const };
  const inherited = [{ agentId: agent.agentId }];
  assert.deepEqual(crewEditorMembers(inherited, [agent]), inherited);
  const restricted = [{ agentId: agent.agentId, accessMode: "read" as const }];
  assert.deepEqual(crewEditorMembers(restricted, [writer]), restricted);
  const old = [{ agentId: agent.agentId, accessMode: "write" as const }];
  assert.deepEqual(crewEditorMembers(old, [writer]), old);
  assert.equal(crewEditorMembers(old, [agent])[0]?.accessMode, "read");
});
