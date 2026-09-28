import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  crewCreateParamsSchema,
  crewSendParamsSchema,
  crewWorkspaceBindingSchema,
  type CrewAgentInput,
} from "@zcode/shared";
import type { CrewRuntimePort } from "../src/crew/contract.js";
import { CrewService } from "../src/crew/crewService.js";

const member: CrewAgentInput = {
  name: "Developer",
  systemPrompt: "Review then implement",
  runtime: "zcode",
  accessMode: "write",
  modelSelection: { providerId: "test", modelId: "model" },
};
type ExecuteInput = Parameters<CrewRuntimePort["execute"]>[0];
async function fixture(overrides: Partial<CrewRuntimePort> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "crew-service-"));
  const calls: ExecuteInput[] = [];
  const runtime: CrewRuntimePort = {
    preflight: async () => {},
    cancel: async () => {},
    execute: async (input) => {
      calls.push(input);
      const taskId = `task-${input.execution.executionId}`;
      await input.onTaskCreated(taskId);
      return { taskId, text: "Done; @developer is just text", status: "succeeded" };
    },
    ...overrides,
  };
  const options = {
    databasePath: join(directory, "nested", "tasks-index.sqlite"),
    ownerId: "owner-a",
    isOwnerAlive: () => true,
    runtime,
  };
  const service = new CrewService(options);
  const catalog = new CrewAgentCatalogService(options.databasePath);
  const agent = await catalog.create(member);
  const group = await service.create({ name: "Crew", members: [{ agentId: agent.agentId }] });
  const binding = { workspacePath: directory, workspaceIdentity: "workspace-a" };
  return {
    service,
    catalog,
    agent,
    group,
    binding,
    calls,
    options,
    async dispose() {
      await service.dispose();
      await catalog.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("strict protocol rejects unknown fields, non-zcode runtime, invalid access and multiple mentions", () => {
  assert.throws(() =>
    crewCreateParamsSchema.parse({ name: "Crew", members: [{ ...member, runtime: "claude" }] }),
  );
  assert.throws(() =>
    crewCreateParamsSchema.parse({ name: "Crew", members: [{ ...member, accessMode: "admin" }] }),
  );
  assert.throws(() =>
    crewCreateParamsSchema.parse({
      name: "Crew",
      members: [{ ...member, authToken: "not-allowed" }],
    }),
  );
  assert.throws(() =>
    crewCreateParamsSchema.parse({
      name: "Crew",
      members: [{ ...member, modelSelection: { providerId: "test", modelId: "m", extra: true } }],
    }),
  );
  assert.throws(() =>
    crewSendParamsSchema.parse({ groupId: "g", messageId: "m", text: "t", mentions: ["a", "b"] }),
  );
  assert.throws(() =>
    crewSendParamsSchema.parse({
      groupId: "g",
      messageId: "m",
      text: "t",
      mentions: [],
      runtime: "zcode",
    }),
  );
  assert.throws(() =>
    crewWorkspaceBindingSchema.parse({ workspacePath: "/tmp", token: "not-allowed" }),
  );
});

test("CRUD, independent member IDs and atomic configuration-only duplication", async () => {
  const f = await fixture();
  try {
    assert.equal(f.group.status, "unbound");
    assert.equal(f.group.epoch, 0);
    const originalId = f.group.members[0].memberId;
    await f.service.update({
      groupId: f.group.groupId,
      name: "Renamed",
      members: [
        f.group.members[0],
        {
          agentId: (await f.catalog.create({ ...member, name: "Reviewer", accessMode: "read" }))
            .agentId,
        },
      ],
    });
    await f.service.bind({ groupId: f.group.groupId, binding: f.binding });
    await f.service.send({
      groupId: f.group.groupId,
      messageId: "m1",
      text: "do it",
      mentions: [originalId],
    });
    await f.service.whenIdle();
    const copy = await f.service.duplicate({ groupId: f.group.groupId, name: "Copy" });
    assert.notEqual(copy.groupId, f.group.groupId);
    assert.equal(copy.members.length, 2);
    assert.notEqual(copy.members[0].memberId, originalId);
    assert.deepEqual({ ...copy.members[0], memberId: originalId }, f.group.members[0]);
    assert.equal(copy.workspaceBinding, null);
    assert.equal(copy.epoch, 0);
    const detail = await f.service.get({ groupId: copy.groupId });
    assert.deepEqual(detail.messages, []);
    assert.deepEqual(detail.executions, []);
    await f.catalog.update({ agentId: f.agent.agentId, systemPrompt: "Changed" });
    const old = await f.service.get({ groupId: f.group.groupId });
    assert.equal(old.executions[0].memberSnapshot.configVersion, f.agent.configVersion);
    assert.equal(old.executions[0].memberSnapshot.rolePrompt, member.systemPrompt);
    await f.service.update({ groupId: copy.groupId, members: [] });
    assert.equal((await f.service.get({ groupId: copy.groupId })).group.members.length, 0);
    await f.service.delete({ groupId: f.group.groupId });
    await assert.rejects(f.service.get({ groupId: f.group.groupId }), /groupNotFound/);
    assert.equal((await f.service.list({})).length, 1);
  } finally {
    await f.dispose();
  }
});

test("only structured single mention dispatches; stable message id rejects changed payload", async () => {
  const f = await fixture();
  try {
    const params = {
      groupId: f.group.groupId,
      messageId: "m",
      text: "@developer discuss",
      mentions: [] as string[],
    };
    const discussion = await f.service.send(params);
    assert.equal(discussion.execution, null);
    assert.equal(f.calls.length, 0);
    await assert.rejects(
      f.service.send({ ...params, messageId: "unbound", mentions: [f.group.members[0].memberId] }),
      /workspaceUnbound/,
    );
    await f.service.bind({ groupId: f.group.groupId, binding: f.binding });
    const task = { ...params, messageId: "task", mentions: [f.group.members[0].memberId] };
    await f.service.send(task);
    await f.service.whenIdle();
    await f.service.send(task);
    await f.service.whenIdle();
    await assert.rejects(f.service.send({ ...task, text: "different" }), /messageConflict/);
    await assert.rejects(f.service.send({ ...task, mentions: [] }), /messageConflict/);
    await assert.rejects(
      f.service.send({ ...task, messageId: "unknown", mentions: ["unknown"] }),
      /memberNotFound/,
    );
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(f.calls.length, 1);
    assert.equal(detail.executions.length, 1);
    assert.equal(detail.messages.length, 3);
    assert.equal(detail.messages[2].sender, "member");
    assert.deepEqual(detail.messages[2].mentions, []);
    assert.equal(detail.executions[0].status, "succeeded");
    assert.equal(detail.executions[0].taskId, `task-${detail.executions[0].executionId}`);
  } finally {
    await f.dispose();
  }
});

test("preflight failure is atomic and bind rechecks active admission after await", async () => {
  const gate = Promise.withResolvers<void>();
  let delayed = false;
  const f = await fixture({
    preflight: async (binding) => {
      if (binding.workspaceIdentity === "bad") throw new Error("bad binding");
      if (delayed && binding.workspaceIdentity === "new") await gate.promise;
    },
  });
  try {
    await assert.rejects(
      f.service.bind({ groupId: f.group.groupId, binding: { workspacePath: "relative" } }),
      /absolutePath/,
    );
    await assert.rejects(
      f.service.bind({
        groupId: f.group.groupId,
        binding: { ...f.binding, workspaceIdentity: "bad" },
      }),
      /bad binding/,
    );
    assert.equal((await f.service.get({ groupId: f.group.groupId })).group.epoch, 0);
    await f.service.bind({ groupId: f.group.groupId, binding: f.binding });
    delayed = true;
    const pending = f.service.bind({
      groupId: f.group.groupId,
      binding: { ...f.binding, workspaceIdentity: "new" },
    });
    await f.service.bind({
      groupId: f.group.groupId,
      binding: { ...f.binding, workspaceIdentity: "other" },
    });
    gate.resolve();
    await assert.rejects(pending, /bindingChanged/);
    assert.equal(
      (await f.service.get({ groupId: f.group.groupId })).group.workspaceBinding?.workspaceIdentity,
      "other",
    );
  } finally {
    gate.resolve();
    await f.dispose();
  }
});

test("same-epoch context is bounded, contains current task and excludes old binding history", async () => {
  const f = await fixture();
  try {
    await f.service.bind({ groupId: f.group.groupId, binding: f.binding });
    await f.service.send({
      groupId: f.group.groupId,
      messageId: "old",
      text: "old workspace secret",
      mentions: [],
    });
    await f.service.bind({
      groupId: f.group.groupId,
      binding: { ...f.binding, workspaceIdentity: "new" },
    });
    for (let i = 0; i < 30; i++)
      await f.service.send({
        groupId: f.group.groupId,
        messageId: `history-${i}`,
        text: "x".repeat(8000),
        mentions: [],
      });
    await f.service.send({
      groupId: f.group.groupId,
      messageId: "current",
      text: "current task",
      mentions: [f.group.members[0].memberId],
    });
    await f.service.whenIdle();
    const context = f.calls[0].messages;
    assert.ok(context.length <= 24);
    assert.ok(context.every((message) => message.epoch === 2));
    assert.ok(!context.some((message) => message.messageId === "old"));
    assert.equal(context.at(-1)?.text, "current task");
    assert.ok(context.reduce((sum, message) => sum + message.text.length, 0) <= 16012);
  } finally {
    await f.dispose();
  }
});

test("two independent DB connections claim a duplicated message only once and retain busy guards", async () => {
  const started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let executions = 0;
  const f = await fixture({
    execute: async (input) => {
      executions++;
      await input.onTaskCreated("task-id");
      started.resolve();
      await release.promise;
      return { taskId: "task-id", text: "done", status: "succeeded" };
    },
  });
  const second = new CrewService({ ...f.options, ownerId: "owner-b" });
  try {
    await f.service.bind({ groupId: f.group.groupId, binding: f.binding });
    const params = {
      groupId: f.group.groupId,
      messageId: "same",
      text: "work",
      mentions: [f.group.members[0].memberId],
    };
    await Promise.all([f.service.send(params), second.send(params)]);
    await started.promise;
    await assert.rejects(second.update({ groupId: f.group.groupId, members: [] }), /groupBusy/);
    await assert.rejects(
      second.bind({ groupId: f.group.groupId, binding: f.binding }),
      /groupBusy/,
    );
    await assert.rejects(second.delete({ groupId: f.group.groupId }), /groupBusy/);
    await second.recover({ groupId: f.group.groupId });
    assert.equal((await second.get({ groupId: f.group.groupId })).executions[0].status, "running");
    release.resolve();
    await Promise.all([f.service.whenIdle(), second.whenIdle()]);
    assert.equal(executions, 1);
    assert.equal(
      (await second.get({ groupId: f.group.groupId })).messages.filter(
        (message) => message.sender === "member",
      ).length,
      1,
    );
  } finally {
    release.resolve();
    await second.dispose();
    await f.dispose();
  }
});
