import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CrewService } from "../src/crew/crewService.js";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "crew-members-"));
  const databasePath = join(directory, "tasks-index.sqlite");
  const service = new CrewService({
    databasePath,
    ownerId: "members-test",
    isOwnerAlive: () => true,
    runtime: {
      preflight: async () => {},
      cancel: async () => {},
      execute: async ({ onTaskCreated }) => {
        await onTaskCreated("task");
        return { taskId: "task", text: "done", status: "succeeded" };
      },
    },
  });
  const catalog = new CrewAgentCatalogService(databasePath);
  const developer = await catalog.create({
    name: "Developer",
    systemPrompt: "original",
    runtime: "zcode",
    accessMode: "write",
  });
  const reviewer = await catalog.create({
    name: "Reviewer",
    systemPrompt: "review",
    runtime: "zcode",
    accessMode: "read",
  });
  const group = await service.create({
    name: "Original",
    members: [
      { memberId: "second-in-sort", agentId: developer.agentId },
      { memberId: "first-in-sort", agentId: reviewer.agentId },
    ],
  });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys=ON");
  return {
    service,
    catalog,
    developer,
    group,
    db,
    directory,
    async dispose() {
      await service.dispose();
      await catalog.dispose();
      db.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("members live only in their own table, preserve order, copy independently and cascade on delete", async () => {
  const f = await fixture();
  try {
    assert.ok(
      !f.db
        .prepare("PRAGMA table_info(agent_crew_groups)")
        .all()
        .some((column) => column.name === "members_json"),
    );
    const members = f.db
      .prepare(
        "SELECT member_id,agent_id FROM agent_crew_members WHERE group_id=? ORDER BY sort_order",
      )
      .all(f.group.groupId);
    assert.deepEqual(
      members.map((row) => row.member_id),
      f.group.members.map((member) => member.memberId),
    );
    assert.equal(members[0]!.agent_id, f.developer.agentId);
    assert.equal(
      (await f.service.get({ groupId: f.group.groupId })).resolvedMembers[0]?.rolePrompt,
      "original",
    );
    const copy = await f.service.duplicate({ groupId: f.group.groupId });
    const copied = f.db
      .prepare("SELECT member_id FROM agent_crew_members WHERE group_id=? ORDER BY sort_order")
      .all(copy.groupId);
    assert.equal(copied.length, 2);
    assert.ok(
      copied.every((row) => !f.group.members.some((member) => member.memberId === row.member_id)),
    );
    assert.deepEqual(
      copy.members.map(({ memberId: _id, ...config }) => config),
      f.group.members.map(({ memberId: _id, ...config }) => config),
    );
    assert.equal(copy.workspaceBinding, null);
    assert.equal(copy.epoch, 0);
    assert.deepEqual((await f.service.get({ groupId: copy.groupId })).executions, []);
    await f.service.update({ groupId: copy.groupId, members: [] });
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM agent_crew_members WHERE group_id=?")
        .get(copy.groupId)?.n,
      0,
    );
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM agent_crew_members WHERE group_id=?")
        .get(f.group.groupId)?.n,
      2,
    );
    await f.service.delete({ groupId: f.group.groupId });
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM agent_crew_members WHERE group_id=?")
        .get(f.group.groupId)?.n,
      0,
    );
  } finally {
    await f.dispose();
  }
});

test("replacing current members leaves historical execution snapshots untouched", async () => {
  const f = await fixture();
  try {
    await f.service.bind({ groupId: f.group.groupId, binding: { workspacePath: f.directory } });
    await f.service.send({
      groupId: f.group.groupId,
      messageId: "run",
      text: "work",
      mentions: [f.group.members[0]!.memberId],
    });
    await f.service.whenIdle();
    await f.service.update({
      groupId: f.group.groupId,
      members: [f.group.members[0]!],
    });
    await f.catalog.update({ agentId: f.developer.agentId, systemPrompt: "changed" });
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.group.members.length, 1);
    assert.equal(detail.resolvedMembers[0]!.rolePrompt, "changed");
    assert.equal(detail.executions[0]!.memberSnapshot.rolePrompt, "original");
    assert.equal(detail.executions[0]!.memberSnapshot.configVersion, f.developer.configVersion);
    assert.equal(
      f.db
        .prepare("SELECT count(*) AS n FROM agent_crew_members WHERE group_id=?")
        .get(f.group.groupId)?.n,
      1,
    );
  } finally {
    await f.dispose();
  }
});

test("member-write failure atomically rolls back both group mutation and duplication", async () => {
  const f = await fixture();
  try {
    f.db.exec(
      "CREATE TRIGGER reject_member BEFORE INSERT ON agent_crew_members BEGIN SELECT RAISE(ABORT,'member write rejected'); END",
    );
    await assert.rejects(
      f.service.update({
        groupId: f.group.groupId,
        name: "Changed",
        members: [f.group.members[0]!],
      }),
      /member write rejected/,
    );
    assert.deepEqual((await f.service.get({ groupId: f.group.groupId })).group, f.group);
    await assert.rejects(
      f.service.duplicate({ groupId: f.group.groupId }),
      /member write rejected/,
    );
    assert.equal((await f.service.list({})).length, 1);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM agent_crew_members").get()?.n, 2);
  } finally {
    await f.dispose();
  }
});
