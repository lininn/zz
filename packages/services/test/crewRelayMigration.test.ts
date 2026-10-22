import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CrewStore } from "../src/crew/crewStore.js";
import { AGENT_CREW_MIGRATION_SQL } from "../src/session/tasksDatabase/agent-crew-v4.js";
import { extractCrewAgentCatalog } from "../src/session/tasksDatabase/agent-crew-v5.js";
import { AGENT_CREW_CONVERSATIONS_MIGRATION_SQL } from "../src/session/tasksDatabase/agent-crew-v6.js";
import {
  areTasksDatabaseMigrationsApplied,
  runTasksDatabaseMigrations,
} from "../src/session/tasksDatabase/migrations.js";

const VERSION = "0007_agent_crew_relay";
const LATEST = "0008_agent_crew_announcement_events";
const FROZEN_LEDGER = [
  ["0001_adopt_task_schema", "3e8337b015d94b05dd31a6003f3acc649e821794cfa288bc0af3022698bd4d17"],
  ["0002_provider_selection", "7244ef7c351f8d02750ab1953fff09f493a71befbf1b6e2d4bab726b0c6b48fc"],
  [
    "0003_official_glm_selection",
    "8987adb50ae412a46c294141c1af89ccfc252f22d41351bdf4c7528f56edc8b4",
  ],
  ["0004_agent_crew", "4260b633dc7163654624ac9dd87efc589bbdc3328c3f9ddd20bc670f45046dab"],
  ["0005_agent_crew_catalog", "8cdbd455341143f7c3d0121ea4cfd9e4957b2d5bafd09b5d64480ab4513f7def"],
  [
    "0006_agent_crew_conversations",
    "4abb043cfebfc78277cfb15b8f31f3f6a5569f380af5ecf0c81bf7d279146bb6",
  ],
];
const rows = (db: DatabaseSync, table: string) =>
  db
    .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
    .all()
    .map((row) => ({ ...row }));

async function v6Fixture(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON");
  await runTasksDatabaseMigrations(db);
  // 从冻结 SQL 重建真实 v6 表，不以删除新版列或伪造最新账本代替旧库升级。
  db.exec(`DROP TABLE agent_crew_executions; DROP TABLE agent_crew_messages;
    DROP TABLE agent_crew_conversations; DROP TABLE agent_crew_members;
    DROP TABLE agent_crew_agents; DROP TABLE agent_crew_groups;
    DROP TABLE agent_crew_workspace_leases; DELETE FROM tasks_schema_migration;
    INSERT INTO task_groups(group_id,title,created_at,updated_at) VALUES('keep','旧任务',1,2);`);
  db.exec(AGENT_CREW_MIGRATION_SQL);
  const snapshot = JSON.stringify(
    {
      agentId: "agent",
      configVersion: "v1",
      memberId: "member",
      name: "Planner",
      rolePrompt: "历史快照\nkeep bytes",
      runtime: "zcode",
      accessMode: "write",
    },
    null,
    2,
  );
  for (const groupId of ["a", "b"]) {
    db.prepare("INSERT INTO agent_crew_groups VALUES(?,?,?,3,11,22)").run(
      groupId,
      groupId,
      '{ "workspacePath": "/fixture" }',
    );
    db.prepare("INSERT INTO agent_crew_members VALUES(?,'member',0,?)").run(groupId, snapshot);
    for (const [i, status] of [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "recovery_required",
    ].entries()) {
      db.prepare(
        "INSERT INTO agent_crew_messages VALUES(?,?,3,?,'user',NULL,?,'[ \"member\" ]',NULL,?)",
      ).run(groupId, `m${i}`, i + 1, `旧消息 ${i}\nkeep`, 30 + i);
      db.prepare(
        "INSERT INTO agent_crew_executions VALUES(?,?,?,'member',3,?,?,?,'owner',?,?,?)",
      ).run(
        `${groupId}-e${i}`,
        groupId,
        `m${i}`,
        status,
        snapshot,
        '{ "workspacePath": "/fixture" }',
        `task-${i}`,
        40 + i,
        50 + i,
      );
    }
  }
  db.exec(
    "INSERT INTO agent_crew_workspace_leases VALUES('workspace','token','owner','task-1',42,5)",
  );
  extractCrewAgentCatalog(db);
  db.exec(AGENT_CREW_CONVERSATIONS_MIGRATION_SQL);
  for (const [id, checksum] of FROZEN_LEDGER)
    db.prepare("INSERT INTO tasks_schema_migration VALUES(?,?,99)").run(id!, checksum!);
  return db;
}

test("v7 preserves real v6 rows and all six frozen checksums, backfills roots and defaults", async () => {
  const db = await v6Fixture();
  try {
    const tables = [
      "agent_crew_groups",
      "agent_crew_members",
      "agent_crew_agents",
      "agent_crew_conversations",
      "agent_crew_messages",
      "agent_crew_executions",
      "agent_crew_workspace_leases",
      "task_groups",
      "tasks_schema_migration",
    ];
    const before = tables.map((table) => rows(db, table));
    assert.equal(areTasksDatabaseMigrationsApplied(db), false);
    const migration = { kind: "upgrade" as const, executedCount: 0, committedCount: 0 };
    await runTasksDatabaseMigrations(db, { migration });
    assert.equal(migration.executedCount, 4);
    assert.equal(migration.committedCount, 4);
    for (const [i, table] of tables.entries()) {
      const oldRows = before[i]!;
      const keys = Object.keys(oldRows[0]!);
      const current = rows(db, table)
        .slice(0, oldRows.length)
        .map((row) => Object.fromEntries(keys.map((key) => [key, row[key]])));
      assert.deepEqual(current, oldRows, table);
    }
    for (const group of rows(db, "agent_crew_groups")) {
      assert.equal(group.relay_mode, "manual");
      assert.equal(group.relay_auto_hops, 2);
      assert.equal(group.relay_budget_minutes, 30);
      assert.equal(group.relay_paused, 0);
    }
    for (const execution of rows(db, "agent_crew_executions")) {
      assert.equal(execution.root_request_id, execution.message_id);
      assert.equal(execution.hop, 0);
      assert.equal(execution.relay_json, null);
      assert.equal(execution.relay_objective_hash, null);
      assert.equal(execution.relay_cancel_requested, 0);
      assert.equal(execution.relay_budget_minutes_snapshot, 30);
    }
    const after = rows(db, "tasks_schema_migration");
    assert.equal(after.length, 10);
    assert.equal(after.at(-1)?.id, LATEST);
    assert.equal(areTasksDatabaseMigrationsApplied(db), true);
    await runTasksDatabaseMigrations(db);
    assert.deepEqual(rows(db, "tasks_schema_migration"), after);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.prepare("UPDATE tasks_schema_migration SET checksum='tampered' WHERE id=?").run(LATEST);
    await assert.rejects(() => runTasksDatabaseMigrations(db), /checksum mismatch/);
    assert.equal(db.isTransaction, false);
  } finally {
    db.close();
  }
});

test("v7 enforces relay bounds and objective uniqueness only within one root/member scope", async () => {
  const db = await v6Fixture();
  try {
    await runTasksDatabaseMigrations(db);
    for (const [column, value] of [
      ["relay_mode", "invalid"],
      ["relay_auto_hops", -1],
      ["relay_auto_hops", 9],
      ["relay_budget_minutes", 0],
      ["relay_budget_minutes", 1441],
      ["relay_paused", 2],
    ] as const)
      assert.throws(
        () => db.prepare(`UPDATE agent_crew_groups SET ${column}=?`).run(value),
        /CHECK/,
      );
    for (const [column, value] of [
      ["hop", -1],
      ["hop", 9],
      ["relay_cancel_requested", 2],
      ["relay_budget_minutes_snapshot", 0],
      ["relay_budget_minutes_snapshot", 1441],
    ] as const)
      assert.throws(
        () => db.prepare(`UPDATE agent_crew_executions SET ${column}=?`).run(value),
        /CHECK/,
      );
    db.exec("UPDATE agent_crew_groups SET relay_auto_hops=0,relay_budget_minutes=1,relay_paused=1");
    db.exec(
      "UPDATE agent_crew_groups SET relay_auto_hops=8,relay_budget_minutes=1440,relay_paused=0",
    );
    db.exec("UPDATE agent_crew_executions SET hop=8,relay_cancel_requested=1");
    db.exec("INSERT INTO agent_crew_conversations VALUES('a','second','',0,1,1)");
    let sequence = 20;
    const insert = (
      groupId: string,
      conversationId: string,
      root: string,
      member: string,
      hash: string | null,
    ) => {
      const id = `new-${++sequence}`;
      db.prepare(`INSERT INTO agent_crew_messages(group_id,conversation_id,message_id,epoch,sequence,sender,text,mentions_json,created_at)
        VALUES(?,?,?,3,?,'user','relay','[]',1)`).run(groupId, conversationId, id, sequence);
      db.prepare(`INSERT INTO agent_crew_executions(execution_id,group_id,conversation_id,message_id,member_id,epoch,status,
        member_snapshot_json,binding_json,created_at,updated_at,root_request_id,relay_objective_hash)
        VALUES(?,?,?,?,?,3,'queued','{}','{}',1,1,?,?)`).run(
        id,
        groupId,
        conversationId,
        id,
        member,
        root,
        hash,
      );
    };
    insert("a", "a", "root", "member", "hash");
    assert.throws(() => insert("a", "a", "root", "member", "hash"), /UNIQUE/);
    insert("b", "b", "root", "member", "hash");
    insert("a", "second", "root", "member", "hash");
    insert("a", "a", "different-root", "member", "hash");
    insert("a", "a", "root", "different-member", "hash");
    insert("a", "a", "root", "member", "different-hash");
    insert("a", "a", "root", "member", null);
    insert("a", "a", "root", "member", null);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("failed v7 rolls back columns and root backfill before a clean retry", async () => {
  const db = await v6Fixture();
  try {
    const before = rows(db, "agent_crew_executions");
    const ledger = rows(db, "tasks_schema_migration");
    db.exec("CREATE INDEX idx_agent_crew_relay_objective ON task_groups(title)");
    await assert.rejects(() => runTasksDatabaseMigrations(db), /already exists/);
    assert.equal(db.isTransaction, false);
    assert.deepEqual(rows(db, "agent_crew_executions"), before);
    assert.deepEqual(rows(db, "tasks_schema_migration"), ledger);
    assert.equal(
      db
        .prepare("PRAGMA table_info(agent_crew_groups)")
        .all()
        .some((row) => row.name === "relay_mode"),
      false,
    );
    db.exec("DROP INDEX idx_agent_crew_relay_objective");
    await runTasksDatabaseMigrations(db);
    assert.equal(areTasksDatabaseMigrationsApplied(db), true);
  } finally {
    db.close();
  }
});

async function storeFixture() {
  const directory = await mkdtemp(join(tmpdir(), "crew-relay-migration-"));
  const path = join(directory, "tasks.sqlite");
  const old = await v6Fixture(path);
  old.close();
  const store = new CrewStore(path);
  await store.initialize();
  return {
    store,
    async dispose() {
      await store.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("upgraded CrewStore maps relay config defaults and updates only supplied fields", async () => {
  const f = await storeFixture();
  try {
    const { store } = f;
    const defaults = store.group("a");
    assert.equal(defaults.relayMode, "manual");
    assert.equal(defaults.relayAutoHops, 2);
    assert.equal(defaults.relayBudgetMinutes, 30);
    assert.equal(defaults.relayPaused, false);
    const settings = {
      relayMode: "semi" as const,
      relayAutoHops: 0,
      relayBudgetMinutes: 1,
      relayPaused: true,
    };
    const created = store.transaction(() => store.create("Custom", [], settings));
    for (const [key, value] of Object.entries(settings))
      assert.equal(created[key as keyof typeof settings], value);
    store.transaction(() => store.update(created.groupId, "Renamed"));
    const updated = store.transaction(() =>
      store.update(created.groupId, "Updated", undefined, { relayPaused: false }),
    );
    assert.equal(updated.relayPaused, false);
    assert.equal(updated.relayMode, "semi");
    assert.equal(updated.relayAutoHops, 0);
    assert.equal(updated.relayBudgetMinutes, 1);
    const fallback = store.transaction(() => store.create("Default", []));
    assert.equal(fallback.relayMode, "auto");
    assert.equal(fallback.relayAutoHops, 2);
    assert.equal(fallback.relayBudgetMinutes, 30);
    assert.equal(fallback.relayPaused, false);
  } finally {
    await f.dispose();
  }
});

test("upgraded enqueue retains relay metadata, validates JSON and derives approval with recovery priority", async () => {
  const f = await storeFixture();
  try {
    const { store } = f;
    const group = store.transaction(() =>
      store.create("Live", [{ memberId: "member", agentId: "agent" }]),
    );
    store.transaction(() => store.bind(group.groupId, { workspacePath: "/fixture" }, 0));
    const send = (messageId: string) => ({
      groupId: group.groupId,
      messageId,
      text: "Work",
      mentions: ["member"],
    });
    const root = store.transaction(() => store.enqueue(send("root"))).execution!;
    assert.equal(root.rootRequestId, "root");
    assert.equal(root.hop, 0);
    assert.equal(root.relay, undefined);
    const metadata = { rootRequestId: "root", hop: 1, objectiveHash: "fingerprint" };
    const handoff = store.transaction(() => store.enqueue(send("handoff"), metadata));
    assert.equal(handoff.execution?.rootRequestId, "root");
    assert.equal(handoff.execution?.hop, 1);
    assert.deepEqual(
      store.transaction(() => store.enqueue(send("handoff"), metadata)),
      handoff,
    );
    assert.equal(
      store.db
        .prepare("SELECT relay_objective_hash FROM agent_crew_executions WHERE execution_id=?")
        .get(handoff.execution!.executionId)?.relay_objective_hash,
      "fingerprint",
    );
    assert.throws(
      () => store.transaction(() => store.enqueue(send("duplicate"), metadata)),
      /UNIQUE/,
    );
    assert.equal(store.messages(group.groupId).length, 2);
    const relay = {
      kind: "plan",
      status: "awaiting_user_approval",
      to: "Planner",
      toMemberId: "member",
      objective: "Next",
      context: "Context",
    };
    store.db
      .prepare(
        "UPDATE agent_crew_executions SET status='succeeded',relay_json=? WHERE execution_id=?",
      )
      .run(JSON.stringify(relay), root.executionId);
    assert.equal(store.conversation(group.groupId).status, "awaiting_user_approval");
    store.db
      .prepare("UPDATE agent_crew_executions SET status='failed' WHERE execution_id=?")
      .run(handoff.execution!.executionId);
    assert.deepEqual(store.execution(root.executionId).relay, relay);
    assert.equal(store.conversation(group.groupId).status, "awaiting_user_approval");
    assert.throws(() => store.assertIdle(group.groupId), /groupBusy/);
    assert.throws(
      () => store.transaction(() => store.bind(group.groupId, { workspacePath: "/new" }, 1)),
      /groupBusy/,
    );
    assert.throws(() => store.transaction(() => store.delete(group.groupId)), /groupBusy/);
    const other = store.transaction(() => store.createConversation(group.groupId));
    assert.equal(other.status, "idle");
    store.db
      .prepare("UPDATE agent_crew_executions SET status='recovery_required' WHERE execution_id=?")
      .run(handoff.execution!.executionId);
    assert.equal(store.conversation(group.groupId).status, "recovery_required");
    store.db
      .prepare(
        "UPDATE agent_crew_executions SET status='succeeded',relay_cancel_requested=1 WHERE group_id=?",
      )
      .run(group.groupId);
    assert.equal("relayCancelRequested" in store.execution(root.executionId), false);
    for (const status of ["dispatched", "rejected", "blocked"]) {
      store.db
        .prepare("UPDATE agent_crew_executions SET relay_json=? WHERE execution_id=?")
        .run(JSON.stringify({ ...relay, status }), root.executionId);
      store.assertIdle(group.groupId);
      assert.equal(store.conversation(group.groupId).status, "idle");
    }
    store.db
      .prepare("UPDATE agent_crew_executions SET relay_json=? WHERE execution_id=?")
      .run(JSON.stringify({ ...relay, kind: "invalid" }), root.executionId);
    assert.throws(() => store.execution(root.executionId));
  } finally {
    await f.dispose();
  }
});
