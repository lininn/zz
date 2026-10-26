import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import { CrewService } from "../src/crew/crewService.js";
import { CrewStore } from "../src/crew/crewStore.js";

const definition = {
  name: "Developer",
  systemPrompt: "original",
  runtime: "zcode",
  accessMode: "write",
} as const;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "crew-catalog-"));
  const databasePath = join(directory, "tasks.sqlite");
  const catalog = new CrewAgentCatalogService(databasePath);
  const service = new CrewService({
    databasePath,
    ownerId: "catalog-test",
    isOwnerAlive: () => true,
    runtime: {
      preflight: async () => {},
      cancel: async () => {},
      execute: async ({ onTaskCreated, member }) => {
        await onTaskCreated("task");
        return { taskId: "task", text: member.rolePrompt, status: "succeeded" };
      },
    },
  });
  const agent = await catalog.create(definition);
  return {
    catalog,
    service,
    agent,
    databasePath,
    directory,
    async close() {
      await service.dispose();
      await catalog.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("catalog CRUD generates versions, supports explicit clears, and persists independently", async () => {
  const f = await fixture();
  try {
    const updated = await f.catalog.update({
      agentId: f.agent.agentId,
      systemPrompt: "next",
      modelSelection: { providerId: "test", modelId: "m" },
      toolAllowlist: ["Read"],
    });
    assert.notEqual(updated.configVersion, f.agent.configVersion);
    assert.equal(updated.createdAt, f.agent.createdAt);
    const cleared = await f.catalog.update({
      agentId: f.agent.agentId,
      modelSelection: null,
      toolAllowlist: null,
    });
    assert.equal(cleared.modelSelection, undefined);
    assert.equal(cleared.toolAllowlist, undefined);
    const second = new CrewAgentCatalogService(f.databasePath);
    try {
      assert.deepEqual(await second.get({ agentId: f.agent.agentId }), cleared);
    } finally {
      await second.dispose();
    }
    // 首次初始化会内置一名管理者。
    assert.equal((await f.catalog.list({})).length, 2);
    await f.catalog.delete({ agentId: f.agent.agentId });
    await assert.rejects(f.catalog.get({ agentId: f.agent.agentId }), /crew.agentNotFound/);
    await assert.rejects(
      f.catalog.update({ agentId: f.agent.agentId, name: "gone" }),
      /crew.agentNotFound/,
    );
    await assert.rejects(f.catalog.delete({ agentId: f.agent.agentId }), /crew.agentNotFound/);
  } finally {
    await f.close();
  }
});

test("references are atomic, shared across groups, protected by FK, and independent of group deletion", async () => {
  const f = await fixture();
  try {
    const ref = { agentId: f.agent.agentId };
    await assert.rejects(
      f.service.create({ name: "missing", members: [ref, { agentId: "missing" }] }),
      /crew.agentNotFound/,
    );
    await assert.rejects(
      f.service.create({ name: "duplicate", members: [ref, ref] }),
      /crew.duplicateAgentId/,
    );
    assert.equal((await f.service.list({})).length, 0);
    const a = await f.service.create({ name: "A", members: [ref] });
    const b = await f.service.create({ name: "B", members: [ref] });
    await assert.rejects(
      f.service.update({ groupId: a.groupId, name: "bad", members: [{ agentId: "missing" }] }),
      /crew.agentNotFound/,
    );
    assert.deepEqual((await f.service.get({ groupId: a.groupId })).group, a);
    await f.catalog.update({ agentId: f.agent.agentId, systemPrompt: "shared" });
    for (const group of [a, b])
      assert.equal(
        (await f.service.get({ groupId: group.groupId })).resolvedMembers[0]?.rolePrompt,
        "shared",
      );
    await assert.rejects(f.catalog.delete(ref), /crew.agentInUse/);
    const db = new DatabaseSync(f.databasePath);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      assert.throws(
        () => db.prepare("DELETE FROM agent_crew_agents WHERE agent_id=?").run(ref.agentId),
        /FOREIGN KEY/,
      );
      assert.throws(
        () =>
          db
            .prepare("UPDATE agent_crew_members SET agent_id='missing' WHERE group_id=?")
            .run(a.groupId),
        /FOREIGN KEY/,
      );
    } finally {
      db.close();
    }
    const copy = await f.service.duplicate({ groupId: a.groupId });
    assert.equal(copy.members[0]?.agentId, ref.agentId);
    for (const group of [a, b, copy]) await f.service.delete({ groupId: group.groupId });
    // 首次初始化会内置一名管理者。
    assert.equal((await f.catalog.list({})).length, 2);
    await f.catalog.delete(ref);
  } finally {
    await f.close();
  }
});

test("permissions cannot exceed catalog ceiling; external fine-grained tools explicitly reject", async () => {
  const f = await fixture();
  try {
    await f.catalog.update({ agentId: f.agent.agentId, accessMode: "read" });
    await assert.rejects(
      f.service.create({
        name: "bad",
        members: [{ agentId: f.agent.agentId, accessMode: "write" }],
      }),
      /crew.permissionEscalation/,
    );
    const g = await f.service.create({ name: "read", members: [{ agentId: f.agent.agentId }] });
    assert.equal(
      (await f.service.get({ groupId: g.groupId })).resolvedMembers[0]?.accessMode,
      "read",
    );
    for (const runtime of ["claude-cli", "codex-cli", "opencode-cli"] as const) {
      await assert.rejects(
        f.catalog.create({ ...definition, runtime, toolAllowlist: [] }),
        /crew.capabilitiesUnsupported/,
      );
      await assert.rejects(
        f.catalog.update({ agentId: f.agent.agentId, runtime, toolAllowlist: ["Read"] }),
        /crew.capabilitiesUnsupported/,
      );
    }
  } finally {
    await f.close();
  }
});

test("accepted snapshots survive catalog edits, idempotent retry and recovery; new enqueue resolves current definition", async () => {
  const f = await fixture();
  const store = new CrewStore(f.databasePath);
  try {
    const group = await f.service.create({
      name: "A",
      members: [{ agentId: f.agent.agentId, accessMode: "read" }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.directory } });
    await store.initialize();
    const params = {
      groupId: group.groupId,
      messageId: "old",
      text: "work",
      mentions: [group.members[0]!.memberId],
    };
    const accepted = store.transaction(() => store.enqueue(params));
    await f.catalog.update({
      agentId: f.agent.agentId,
      systemPrompt: "new",
      toolAllowlist: ["Read"],
    });
    assert.deepEqual(
      store.transaction(() => store.enqueue(params)),
      accepted,
    );
    await f.service.recover({ groupId: group.groupId });
    await f.service.whenIdle();
    const retried = await f.service.send(params);
    assert.deepEqual(retried.execution?.memberSnapshot, accepted.execution?.memberSnapshot);
    const next = await f.service.send({ ...params, messageId: "new" });
    await f.service.whenIdle();
    assert.equal(next.execution?.memberSnapshot.rolePrompt, "new");
    assert.equal(next.execution?.memberSnapshot.accessMode, "read");
    assert.deepEqual(next.execution?.memberSnapshot.toolAllowlist, ["Read"]);
    assert.notEqual(
      next.execution?.memberSnapshot.configVersion,
      accepted.execution?.memberSnapshot.configVersion,
    );
    const detail = await f.service.get({ groupId: group.groupId });
    assert.deepEqual(
      detail.messages.filter((m) => m.sender === "member").map((m) => m.text),
      ["original", "new"],
    );
  } finally {
    await store.shutdown();
    await f.close();
  }
});

test("catalog downgrade clamps existing overrides without rewriting references or accepted snapshots", async () => {
  const f = await fixture();
  const store = new CrewStore(f.databasePath);
  try {
    const group = await f.service.create({
      name: "A",
      members: [{ agentId: f.agent.agentId, accessMode: "write" }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.directory } });
    await store.initialize();
    const params = {
      groupId: group.groupId,
      messageId: "old",
      text: "work",
      mentions: [group.members[0]!.memberId],
    };
    const accepted = store.transaction(() => store.enqueue(params));
    await f.catalog.update({ agentId: f.agent.agentId, accessMode: "read" });
    const view = await f.service.get({ groupId: group.groupId });
    assert.equal(view.group.members[0]?.accessMode, "write");
    assert.equal(view.resolvedMembers[0]?.accessMode, "read");
    assert.equal(view.executions[0]?.memberSnapshot.accessMode, "write");
    await f.service.send(params);
    await f.service.whenIdle();
    assert.equal(accepted.execution?.memberSnapshot.accessMode, "write");
    const next = await f.service.send({ ...params, messageId: "new" });
    await f.service.whenIdle();
    assert.equal(next.execution?.memberSnapshot.accessMode, "read");
    await assert.rejects(
      f.service.update({ groupId: group.groupId, members: group.members }),
      /crew.permissionEscalation/,
    );
    const copy = await f.service.duplicate({ groupId: group.groupId });
    assert.equal(copy.members[0]?.agentId, f.agent.agentId);
    assert.equal(copy.members[0]?.accessMode, "read");
    assert.equal(
      (await f.service.get({ groupId: copy.groupId })).resolvedMembers[0]?.accessMode,
      "read",
    );
  } finally {
    await store.shutdown();
    await f.close();
  }
});

test("catalog mutations roll back atomically on storage failure and close guards new requests", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.databasePath);
  try {
    db.exec(
      "CREATE TRIGGER reject_agent BEFORE UPDATE ON agent_crew_agents BEGIN SELECT RAISE(ABORT,'rejected'); END",
    );
    await assert.rejects(
      f.catalog.update({ agentId: f.agent.agentId, name: "changed" }),
      /rejected/,
    );
    assert.deepEqual(await f.catalog.get({ agentId: f.agent.agentId }), f.agent);
    db.exec(
      "DROP TRIGGER reject_agent; CREATE TRIGGER reject_agent BEFORE INSERT ON agent_crew_agents BEGIN SELECT RAISE(ABORT,'rejected'); END",
    );
    await assert.rejects(f.catalog.create(definition), /rejected/);
    // 首次初始化会内置一名管理者。
    assert.equal((await f.catalog.list({})).length, 2);
    await f.catalog.dispose();
    await assert.rejects(f.catalog.list({}), /crew.serviceClosed/);
  } finally {
    db.close();
    await f.close();
  }
});

test("name-only update during running work never rewrites downgraded member overrides", async () => {
  const f = await fixture();
  const store = new CrewStore(f.databasePath);
  try {
    const group = await f.service.create({
      name: "A",
      members: [{ agentId: f.agent.agentId, accessMode: "write" }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.directory } });
    await store.initialize();
    const accepted = store.transaction(() =>
      store.enqueue({
        groupId: group.groupId,
        messageId: "running",
        text: "run",
        mentions: [group.members[0]!.memberId],
      }),
    );
    store.db
      .prepare(
        "UPDATE agent_crew_executions SET status='running',owner_id='another-owner' WHERE execution_id=?",
      )
      .run(accepted.execution!.executionId);
    await f.catalog.update({ agentId: f.agent.agentId, accessMode: "read" });
    store.db.exec(
      "CREATE TRIGGER reject_members BEFORE DELETE ON agent_crew_members BEGIN SELECT RAISE(ABORT,'must not rewrite membership'); END",
    );
    const renamed = await f.service.update({ groupId: group.groupId, name: "Renamed" });
    assert.equal(renamed.name, "Renamed");
    assert.deepEqual(renamed.members, group.members);
    const detail = await f.service.get({ groupId: group.groupId });
    assert.equal(detail.resolvedMembers[0]?.accessMode, "read");
    assert.equal(detail.executions[0]?.status, "running");
    assert.deepEqual(detail.executions[0]?.memberSnapshot, accepted.execution?.memberSnapshot);
    await assert.rejects(
      f.service.update({ groupId: group.groupId, members: [] }),
      /crew.groupBusy/,
    );
  } finally {
    await store.shutdown();
    await f.close();
  }
});
