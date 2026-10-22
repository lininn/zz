import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AGENT_CREW_MIGRATION_SQL } from "../src/session/tasksDatabase/agent-crew-v4.js";
import { extractCrewAgentCatalog } from "../src/session/tasksDatabase/agent-crew-v5.js";
import {
  areTasksDatabaseMigrationsApplied,
  runTasksDatabaseMigrations,
} from "../src/session/tasksDatabase/migrations.js";

const VERSION = "0006_agent_crew_conversations";
const rows = (db: DatabaseSync, table: string) =>
  db
    .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
    .all()
    .map((row) => ({ ...row }));

async function v5Fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  await await runTasksDatabaseMigrations(db);
  // 用冻结 v4/v5 创建真实旧表，沿用旧账本，不把缺列的新版表冒充迁移输入。
  db.exec(`DROP TABLE agent_crew_executions; DROP TABLE agent_crew_messages;
    DROP TABLE agent_crew_conversations; DROP TABLE agent_crew_members;
    DROP TABLE agent_crew_agents; DROP TABLE agent_crew_groups;
    DROP TABLE agent_crew_workspace_leases;
    DELETE FROM tasks_schema_migration WHERE id>='${VERSION}';`);
  db.exec(AGENT_CREW_MIGRATION_SQL);
  extractCrewAgentCatalog(db);
  for (const group of ["a", "b", "empty"])
    db.prepare("INSERT INTO agent_crew_groups VALUES(?,?,?,7,11,99)").run(
      group,
      `Group ${group}`,
      '{ "workspacePath": "/fixture/workspace" }',
    );
  const statuses = ["queued", "running", "succeeded", "failed", "cancelled", "recovery_required"];
  for (const group of ["a", "b"]) {
    for (const [i, status] of statuses.entries()) {
      db.prepare("INSERT INTO agent_crew_messages VALUES(?,?,7,?,'user',NULL,?,?,NULL,?)").run(
        group,
        `m${i}`,
        i * 2 + 1,
        `Task ${group} ${i}\n中文`,
        '[ "member" ]',
        20 + i,
      );
      db.prepare("INSERT INTO agent_crew_executions VALUES(?,?,?,?,7,?,?,?,?,?,?,?)").run(
        `${group}-e${i}`,
        group,
        `m${i}`,
        "member",
        status,
        '{ "name": "historical snapshot", "configVersion": "old" }',
        '{ "workspacePath": "/fixture/workspace" }',
        i ? "old-owner" : null,
        i ? `${group}-old-task${i}` : null,
        30 + i,
        40 + i,
      );
      db.prepare(
        "INSERT INTO agent_crew_messages VALUES(?,?,7,?,'member','member',?,'[]',?,?)",
      ).run(group, `reply${i}`, i * 2 + 2, `Reply ${group} ${i}`, `${group}-e${i}`, 50 + i);
    }
  }
  db.prepare("INSERT INTO agent_crew_workspace_leases VALUES(?,?,?,?,?,?)").run(
    "shared-workspace",
    "fencing-token",
    "old-owner",
    "a-old-task1",
    4321,
    10,
  );
  return db;
}

test("v6 preserves every v5 message/execution field and installs one default even for empty groups", async () => {
  const db = await v5Fixture();
  try {
    const messages = rows(db, "agent_crew_messages");
    const executions = rows(db, "agent_crew_executions");
    const leases = rows(db, "agent_crew_workspace_leases");
    const groups = rows(db, "agent_crew_groups");
    const ledger = rows(db, "tasks_schema_migration");
    assert.equal(areTasksDatabaseMigrationsApplied(db), false);
    await runTasksDatabaseMigrations(db);
    const originalColumns = (table: string, original: Record<string, unknown>[]) =>
      rows(db, table).map((row) => {
        assert.equal(row.conversation_id, row.group_id);
        return Object.fromEntries(Object.keys(original[0]!).map((key) => [key, row[key]]));
      });
    assert.deepEqual(originalColumns("agent_crew_messages", messages), messages);
    assert.deepEqual(originalColumns("agent_crew_executions", executions), executions);
    assert.deepEqual(rows(db, "agent_crew_workspace_leases"), leases);
    assert.deepEqual(
      rows(db, "agent_crew_groups").map((row) =>
        Object.fromEntries(Object.keys(groups[0]!).map((key) => [key, row[key]])),
      ),
      groups,
    );
    assert.deepEqual(rows(db, "tasks_schema_migration").slice(0, ledger.length), ledger);
    assert.deepEqual(
      rows(db, "agent_crew_conversations"),
      groups.map((group) => ({
        group_id: group.group_id,
        conversation_id: group.group_id,
        name: "",
        is_default: 1,
        created_at: group.created_at,
        updated_at: group.updated_at,
      })),
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(areTasksDatabaseMigrationsApplied(db), true);
    const after = rows(db, "tasks_schema_migration");
    assert.equal(after.at(-1)?.id, "0008_agent_crew_announcement_events");
    assert.equal(after.length, 10);
    await runTasksDatabaseMigrations(db);
    assert.deepEqual(rows(db, "tasks_schema_migration"), after);
    assert.equal(rows(db, "agent_crew_conversations").length, 3);
    assert.equal(rows(db, "agent_crew_messages").length, messages.length);
  } finally {
    db.close();
  }
});

test("v6 composite keys permit same message id per conversation and reject foreign ownership", async () => {
  const db = await v5Fixture();
  try {
    await runTasksDatabaseMigrations(db);
    db.exec("INSERT INTO agent_crew_conversations VALUES('a','second','Task',0,100,100)");
    db.exec(`INSERT INTO agent_crew_messages
      SELECT group_id,'second',message_id,epoch,sequence,sender,member_id,text,mentions_json,NULL,created_at,kind
      FROM agent_crew_messages WHERE group_id='a' AND conversation_id='a' AND message_id='m0'`);
    assert.throws(
      () =>
        db.exec(`INSERT INTO agent_crew_messages
      SELECT group_id,'b',message_id,epoch,sequence,sender,member_id,text,mentions_json,NULL,created_at,kind
      FROM agent_crew_messages WHERE group_id='a' AND conversation_id='second'`),
      /FOREIGN KEY/,
    );
    assert.throws(
      () => db.exec("INSERT INTO agent_crew_conversations VALUES('a','another','',1,100,100)"),
      /UNIQUE/,
    );
    db.exec("DELETE FROM agent_crew_groups WHERE group_id='a'");
    for (const table of [
      "agent_crew_conversations",
      "agent_crew_messages",
      "agent_crew_executions",
    ])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE group_id='a'`).get()?.n, 0);
    assert.equal(
      db.prepare("SELECT count(*) n FROM agent_crew_messages WHERE group_id='b'").get()?.n,
      12,
    );
    assert.equal(rows(db, "agent_crew_workspace_leases").length, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});

test("failed v6 rolls back the default backfill and preserves old tables/ledger before retry", async () => {
  const db = await v5Fixture();
  try {
    const before = rows(db, "agent_crew_messages");
    const ledger = rows(db, "tasks_schema_migration");
    db.exec("CREATE TABLE agent_crew_messages_v6 (blocked TEXT)");
    await assert.rejects(() => runTasksDatabaseMigrations(db), /already exists/);
    assert.equal(db.isTransaction, false);
    assert.deepEqual(rows(db, "agent_crew_messages"), before);
    assert.deepEqual(rows(db, "tasks_schema_migration"), ledger);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_crew_conversations'").get(),
      undefined,
    );
    db.exec("DROP TABLE agent_crew_messages_v6");
    await runTasksDatabaseMigrations(db);
    assert.equal(areTasksDatabaseMigrationsApplied(db), true);
    db.prepare("UPDATE tasks_schema_migration SET checksum='tampered' WHERE id=?").run(VERSION);
    await assert.rejects(() => runTasksDatabaseMigrations(db), /checksum mismatch/);
    assert.equal(rows(db, "agent_crew_messages").length, before.length);
  } finally {
    db.close();
  }
});
