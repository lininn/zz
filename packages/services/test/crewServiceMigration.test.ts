import { AGENT_CREW_MIGRATION_SQL } from "../src/session/tasksDatabase/agent-crew-v4.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  areTasksDatabaseMigrationsApplied,
  runTasksDatabaseMigrations,
} from "../src/session/tasksDatabase/migrations.js";

test("v7 is checksum-tracked and installs the exact shared workspace lease contract", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    runTasksDatabaseMigrations(db);
    assert.equal(areTasksDatabaseMigrationsApplied(db), true);
    const ledger = db.prepare("SELECT id,checksum FROM tasks_schema_migration ORDER BY id").all();
    assert.equal(ledger.at(-1)?.id, "0007_agent_crew_relay");
    assert.equal(ledger.length, 7);
    assert.ok(
      !db
        .prepare("PRAGMA table_info(agent_crew_groups)")
        .all()
        .some((column) => column.name === "members_json"),
    );
    assert.deepEqual(
      db
        .prepare("PRAGMA table_info(agent_crew_members)")
        .all()
        .filter((column) => Number(column.pk) > 0)
        .map((column) => [column.name, column.pk]),
      [
        ["group_id", 1],
        ["member_id", 2],
      ],
    );
    const memberForeignKey = db
      .prepare("PRAGMA foreign_key_list(agent_crew_members)")
      .all()
      .find((row) => row.table === "agent_crew_groups");
    assert.equal(memberForeignKey?.table, "agent_crew_groups");
    assert.equal(memberForeignKey?.on_delete, "CASCADE");
    assert.deepEqual(
      db
        .prepare("PRAGMA table_info(agent_crew_workspace_leases)")
        .all()
        .map((row) => ({
          name: row.name,
          type: row.type,
          required: row.notnull,
          primary: row.pk,
        })),
      [
        { name: "workspace_key", type: "TEXT", required: 0, primary: 1 },
        { name: "token", type: "TEXT", required: 1, primary: 0 },
        { name: "owner_id", type: "TEXT", required: 1, primary: 0 },
        { name: "session_id", type: "TEXT", required: 1, primary: 0 },
        { name: "runtime_pid", type: "INTEGER", required: 0, primary: 0 },
        { name: "created_at", type: "INTEGER", required: 1, primary: 0 },
      ],
    );
    db.prepare("INSERT INTO agent_crew_workspace_leases VALUES(?,?,?,?,?,?)").run(
      "identity",
      "token",
      "owner",
      "session",
      null,
      1,
    );
    runTasksDatabaseMigrations(db);
    assert.deepEqual(
      db.prepare("SELECT id,checksum FROM tasks_schema_migration ORDER BY id").all(),
      ledger,
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM agent_crew_workspace_leases").get()?.n, 1);
    db.prepare(
      "UPDATE tasks_schema_migration SET checksum='changed' WHERE id='0004_agent_crew'",
    ).run();
    assert.throws(() => runTasksDatabaseMigrations(db), /checksum mismatch/);
    assert.equal(db.isTransaction, false);
  } finally {
    db.close();
  }
});

test("v3 upgrade adds only Crew tables without rewriting historical ledger or unrelated rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    runTasksDatabaseMigrations(db);
    // 降级夹具必须一并移除 v6 会话表，否则重放迁移会撞到残留表。
    db.exec(`DROP TABLE agent_crew_workspace_leases; DROP TABLE agent_crew_executions;
      DROP TABLE agent_crew_messages; DROP TABLE agent_crew_conversations; DROP TABLE agent_crew_members; DROP TABLE agent_crew_groups; DROP TABLE agent_crew_agents;
      DELETE FROM tasks_schema_migration WHERE id>='0004_agent_crew';
      INSERT INTO task_groups(group_id,title,created_at,updated_at) VALUES ('existing-group','keep',1,1);`);
    const before = db.prepare("SELECT * FROM tasks_schema_migration ORDER BY id").all();
    assert.equal(areTasksDatabaseMigrationsApplied(db), false);
    runTasksDatabaseMigrations(db);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM tasks_schema_migration WHERE id<'0004_agent_crew' ORDER BY id")
        .all(),
      before,
    );
    assert.equal(
      db.prepare("SELECT title FROM task_groups WHERE group_id='existing-group'").get()?.title,
      "keep",
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM agent_crew_groups").get()?.n, 0);
  } finally {
    db.close();
  }
});

test("v4 extraction deduplicates equivalent definitions, splits conflicts and preserves historical execution bytes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON");
    runTasksDatabaseMigrations(db);
    // 回到真实 v4：删除 v5/v6 ledger 与新表，保留旧 checksum 和审计断言。
    db.exec(`DROP TABLE agent_crew_executions; DROP TABLE agent_crew_messages;
      DROP TABLE agent_crew_conversations; DROP TABLE agent_crew_members; DROP TABLE agent_crew_groups; DROP TABLE agent_crew_agents;
      DROP TABLE agent_crew_workspace_leases;
      DELETE FROM tasks_schema_migration WHERE id>='0005_agent_crew_catalog';`);
    db.exec(AGENT_CREW_MIGRATION_SQL);
    const old = {
      agentId: "shared",
      configVersion: "v1",
      name: "A",
      rolePrompt: "original",
      runtime: "zcode",
      accessMode: "read",
      modelSelection: { providerId: "p", modelId: "m" },
    };
    for (const id of ["a", "b", "c", "d"]) {
      db.prepare("INSERT INTO agent_crew_groups VALUES(?,?,NULL,0,1,2)").run(id, id);
      const snapshot =
        id === "c"
          ? { ...old, rolePrompt: "different" }
          : id === "d"
            ? { ...old, configVersion: "v2", modelSelection: { modelId: "m", providerId: "p" } }
            : old;
      db.prepare("INSERT INTO agent_crew_members VALUES(?,?,0,?)").run(
        id,
        "member",
        JSON.stringify(snapshot),
      );
    }
    const history = JSON.stringify({ ...old, memberId: "member" }, null, 2);
    db.prepare(
      "INSERT INTO agent_crew_messages VALUES('c','m',0,1,'user',NULL,'run','[\"member\"]',NULL,1)",
    ).run();
    db.prepare(
      "INSERT INTO agent_crew_executions VALUES('e','c','m','member',0,'queued',?,'{\"workspacePath\":\"/tmp\"}',NULL,NULL,1,1)",
    ).run(history);
    const ledger = db.prepare("SELECT * FROM tasks_schema_migration ORDER BY id").all();
    runTasksDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT count(*) n FROM agent_crew_agents").get()?.n, 2);
    const refs = db
      .prepare("SELECT group_id,agent_id FROM agent_crew_members ORDER BY group_id")
      .all();
    assert.equal(refs[0]?.agent_id, "shared");
    assert.equal(refs[1]?.agent_id, refs[0]?.agent_id);
    assert.equal(refs[3]?.agent_id, refs[0]?.agent_id);
    assert.notEqual(refs[2]?.agent_id, refs[0]?.agent_id);
    const split = db
      .prepare("SELECT definition_json FROM agent_crew_agents WHERE agent_id=?")
      .get(refs[2]!.agent_id!);
    assert.equal(JSON.parse(String(split?.definition_json)).systemPrompt, "different");
    assert.equal(
      db.prepare("SELECT member_snapshot_json FROM agent_crew_executions").get()
        ?.member_snapshot_json,
      history,
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT * FROM tasks_schema_migration WHERE id<'0005_agent_crew_catalog' ORDER BY id",
        )
        .all(),
      ledger,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    runTasksDatabaseMigrations(db);
    assert.equal(db.prepare("SELECT count(*) n FROM agent_crew_agents").get()?.n, 2);
  } finally {
    db.close();
  }
});
