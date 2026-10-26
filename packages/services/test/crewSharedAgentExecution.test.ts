import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrewResolvedMember } from "@zcode/shared";
import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import { CrewService } from "../src/crew/crewService.js";

test("both referencing crews execute the latest catalog definition while old audits remain intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "crew-shared-agent-"));
  const databasePath = join(directory, "tasks.sqlite");
  const catalog = new CrewAgentCatalogService(databasePath);
  const observed: CrewResolvedMember[] = [];
  const crew = new CrewService({
    databasePath,
    ownerId: "fixture-owner",
    isOwnerAlive: () => true,
    runtime: {
      preflight: async () => {},
      cancel: async () => {},
      execute: async ({ execution, member, onTaskCreated }) => {
        observed.push(member);
        const taskId = `task-${execution.executionId}`;
        await onTaskCreated(taskId);
        return { taskId, text: member.rolePrompt, status: "succeeded" };
      },
    },
  });
  try {
    const agent = await catalog.create({
      name: "Original",
      systemPrompt: "Original instructions",
      runtime: "zcode",
      accessMode: "write",
    });
    const groups = await Promise.all(
      ["A", "B"].map((name) =>
        crew.create({
          name,
          members: [{ agentId: agent.agentId, accessMode: "read" }],
        }),
      ),
    );
    for (const group of groups) {
      await crew.bind({ groupId: group.groupId, binding: { workspacePath: directory } });
      await crew.send({
        groupId: group.groupId,
        messageId: "old",
        text: "First task",
        mentions: [group.members[0]!.memberId],
      });
      await crew.whenIdle();
    }
    const updated = await catalog.update({
      agentId: agent.agentId,
      name: "Updated",
      systemPrompt: "Latest instructions",
      modelSelection: { providerId: "fixture", modelId: "new-model" },
      toolAllowlist: ["Read"],
    });
    for (const group of groups) {
      await crew.send({
        groupId: group.groupId,
        messageId: "next",
        text: "Next task",
        mentions: [group.members[0]!.memberId],
      });
      await crew.whenIdle();
      const detail = await crew.get({ groupId: group.groupId });
      assert.deepEqual(detail.group.members, group.members);
      assert.equal(detail.resolvedMembers[0]?.configVersion, updated.configVersion);
      assert.equal(detail.executions[0]?.memberSnapshot.configVersion, agent.configVersion);
      assert.equal(detail.executions[0]?.memberSnapshot.rolePrompt, "Original instructions");
      assert.equal(detail.executions[1]?.memberSnapshot.configVersion, updated.configVersion);
      assert.equal(detail.executions[1]?.status, "succeeded");
    }
    assert.equal(observed.length, 4);
    for (const member of observed.slice(2)) {
      assert.equal(member.agentId, agent.agentId);
      assert.equal(member.rolePrompt, updated.systemPrompt);
      assert.equal(member.name, updated.name);
      assert.equal(member.configVersion, updated.configVersion);
      assert.equal(member.accessMode, "read");
      assert.deepEqual(member.modelSelection, updated.modelSelection);
      assert.deepEqual(member.toolAllowlist, updated.toolAllowlist);
    }
    // 首次初始化会内置一名管理者。
    assert.equal((await catalog.list({})).length, 2);
  } finally {
    await crew.dispose();
    await catalog.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
