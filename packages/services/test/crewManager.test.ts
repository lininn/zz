import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CREW_BUILTIN_MANAGER_AGENT_ID,
  CREW_BUILTIN_MANAGER_NAME,
  type CrewAgentInput,
} from "@zcode/shared";
import type { CrewRuntimePort } from "../src/crew/contract.js";
import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import { CrewService } from "../src/crew/crewService.js";

const worker: CrewAgentInput = {
  name: "Developer",
  systemPrompt: "Implement the task",
  runtime: "zcode",
  accessMode: "write",
};
const manager: CrewAgentInput = {
  name: "Coordinator",
  systemPrompt: "Coordinate the crew",
  runtime: "zcode",
  accessMode: "read",
  isManager: true,
};

async function fixture(overrides: Partial<CrewRuntimePort> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "crew-manager-"));
  const calls: Parameters<CrewRuntimePort["execute"]>[0][] = [];
  const runtime: CrewRuntimePort = {
    preflight: async () => {},
    cancel: async () => {},
    execute: async (input) => {
      calls.push(input);
      const taskId = `task-${input.execution.executionId}`;
      await input.onTaskCreated(taskId);
      return { taskId, text: "Handled", status: "succeeded" };
    },
    ...overrides,
  };
  const databasePath = join(directory, "tasks.sqlite");
  const service = new CrewService({
    databasePath,
    ownerId: "manager-test",
    isOwnerAlive: () => true,
    runtime,
  });
  const catalog = new CrewAgentCatalogService(databasePath);
  return {
    service,
    catalog,
    calls,
    directory,
    async dispose() {
      await service.dispose();
      await catalog.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("built-in manager is seeded on first initialization and cannot be deleted", async () => {
  const f = await fixture();
  try {
    const agents = await f.catalog.list({});
    const builtin = agents.find((agent) => agent.agentId === CREW_BUILTIN_MANAGER_AGENT_ID);
    assert.ok(builtin);
    assert.equal(builtin.name, CREW_BUILTIN_MANAGER_NAME);
    assert.equal(builtin.isManager, true);
    await assert.rejects(
      f.catalog.delete({ agentId: CREW_BUILTIN_MANAGER_AGENT_ID }),
      /crew.builtinAgentLocked/,
    );
    const edited = await f.catalog.update({
      agentId: CREW_BUILTIN_MANAGER_AGENT_ID,
      systemPrompt: "Custom manager prompt",
    });
    assert.equal(edited.systemPrompt, "Custom manager prompt");
    assert.equal(edited.isManager, true);
  } finally {
    await f.dispose();
  }
});

test("a crew accepts at most one manager member", async () => {
  const f = await fixture();
  try {
    const managerA = await f.catalog.create(manager);
    const managerB = await f.catalog.create({ ...manager, name: "Second coordinator" });
    await assert.rejects(
      f.service.create({
        name: "Two managers",
        members: [{ agentId: managerA.agentId }, { agentId: managerB.agentId }],
      }),
      /crew.multipleManagers/,
    );
    const group = await f.service.create({
      name: "One manager",
      members: [{ agentId: managerA.agentId }],
    });
    const added = await f.catalog.create({ ...worker, name: "Later coordinator", isManager: true });
    await assert.rejects(
      f.service.update({
        groupId: group.groupId,
        members: [{ agentId: managerA.agentId }, { agentId: added.agentId }],
      }),
      /crew.multipleManagers/,
    );
  } finally {
    await f.dispose();
  }
});

test("promoting a member in a crew that already has a manager is rejected", async () => {
  const f = await fixture();
  try {
    const coordinator = await f.catalog.create(manager);
    const developer = await f.catalog.create(worker);
    const group = await f.service.create({
      name: "Crew",
      members: [{ agentId: coordinator.agentId }, { agentId: developer.agentId }],
    });
    await assert.rejects(
      f.catalog.update({ agentId: developer.agentId, isManager: true }),
      /crew.multipleManagers/,
    );
    const detail = await f.service.get({ groupId: group.groupId });
    assert.equal(detail.resolvedMembers.filter((member) => member.isManager).length, 1);
  } finally {
    await f.dispose();
  }
});

test("messages without a mention dispatch to the manager automatically", async () => {
  const f = await fixture();
  try {
    const coordinator = await f.catalog.create(manager);
    const developer = await f.catalog.create(worker);
    const group = await f.service.create({
      name: "Crew",
      members: [{ agentId: coordinator.agentId }, { agentId: developer.agentId }],
    });
    await f.service.bind({
      groupId: group.groupId,
      binding: { workspacePath: f.directory, workspaceIdentity: "workspace-a" },
    });
    const result = await f.service.send({
      groupId: group.groupId,
      messageId: "message-1",
      text: "Please ship the release",
      mentions: [],
    });
    assert.equal(result.message.mentions.length, 0);
    assert.equal(result.execution?.memberSnapshot.name, "Coordinator");
    assert.equal(result.execution?.memberSnapshot.isManager, true);
    await f.service.whenIdle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]?.member.isManager, true);
    assert.match(
      f.calls[0]?.relayMemberProfiles?.map((item) => item.name).join(",") ?? "",
      /Developer/,
    );
  } finally {
    await f.dispose();
  }
});

test("messages without a mention stay board-only when the crew has no manager", async () => {
  const f = await fixture();
  try {
    const developer = await f.catalog.create(worker);
    const group = await f.service.create({
      name: "Crew",
      members: [{ agentId: developer.agentId }],
    });
    await f.service.bind({
      groupId: group.groupId,
      binding: { workspacePath: f.directory, workspaceIdentity: "workspace-a" },
    });
    const result = await f.service.send({
      groupId: group.groupId,
      messageId: "message-1",
      text: "Board note",
      mentions: [],
    });
    assert.equal(result.execution, null);
  } finally {
    await f.dispose();
  }
});
