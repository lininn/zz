import { invalidateCrewRelayAdmissions } from "./crewRelayControl.js";
import { readExecution, readMessage, readCrewContext } from "./crewStoreRows.js";
export { readExecution } from "./crewStoreRows.js";
import { CrewConversationStore } from "./crewConversationStore.js";
import { assertCrewCapabilities, resolveCrewMember } from "./agentCatalogStore.js";
import {
  crewGroupSchema,
  type CrewExecution,
  type CrewGroup,
  type CrewGroupDetail,
  type CrewMember,
  type CrewResolvedMember,
  type CrewMessage,
  type CrewSendParams,
  type CrewSendResult,
  type CrewWorkspaceBinding,
} from "@zcode/shared";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as SqliteDatabase } from "node:sqlite";
import { getTasksIndexDatabasePath } from "#src/paths.js";
import {
  areTasksDatabaseMigrationsApplied,
  runTasksDatabaseMigrations,
} from "#src/session/tasksDatabase/migrations.js";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
type RelaySettings = Pick<
  CrewGroup,
  "relayMode" | "relayAutoHops" | "relayBudgetMinutes" | "relayPaused"
>;
export const CREW_UNRESOLVED = "'queued','running','recovery_required'";

/** CrewService 的持久化适配器；所有读改写在同一个 SQLite 写锁中完成。 */
export class CrewStore {
  private connection?: SqliteDatabase;
  private ready?: Promise<void>;
  constructor(private readonly path = getTasksIndexDatabasePath()) {}

  initialize(): Promise<void> {
    return (this.ready ??= (async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const db = new DatabaseSync(this.path);
      try {
        db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL");
        // 每个 CrewService / AgentCatalog 实例都新开连接并初始化，迁移 runner 的
        // BEGIN IMMEDIATE 会取写锁；群详情轮询也在取写锁，并发初始化因此互相等待，
        // 5s 超时后抛 "database is locked"。账本只读确认已应用就跳过，不再每次抢写锁。
        if (!areTasksDatabaseMigrationsApplied(db)) runTasksDatabaseMigrations(db);
        this.connection = db;
      } catch (error) {
        db.close();
        this.ready = undefined;
        throw error;
      }
    })());
  }
  get db(): SqliteDatabase {
    if (!this.connection) throw new Error("crew.databaseNotReady");
    return this.connection;
  }
  close(): void {
    this.connection?.close();
    this.connection = undefined;
    this.ready = undefined;
  }
  async shutdown(): Promise<void> {
    // mkdir/迁移尚未完成时直接 close 会漏掉随后打开的句柄；只等待已有初始化，不另起连接。
    await this.ready?.catch(() => undefined);
    this.close();
  }
  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      // 绝不能依赖 node:sqlite 的 isTransaction：Node 22 没有该属性（恒为 undefined），
      // 旧写法会让回滚被静默跳过，连接永久停在打开的事务里，之后所有 BEGIN 都报
      // "cannot start a transaction within a transaction"，直到重启 server。
      // 此处 BEGIN 必然已成功，无条件尝试回滚；无事务时吞掉错误，绝不覆盖原始异常。
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* 事务已结束或回滚失败：保留原异常交调用方处理。 */
      }
      throw error;
    }
  }
  group(groupId: string): CrewGroup {
    const row = this.db
      .prepare(`SELECT g.*,
      EXISTS(SELECT 1 FROM agent_crew_executions e WHERE e.group_id=g.group_id AND e.status='recovery_required') AS recovery,
      EXISTS(SELECT 1 FROM agent_crew_executions e WHERE e.group_id=g.group_id AND e.status IN ('queued','running')) AS active
      FROM agent_crew_groups g WHERE group_id=?`)
      .get(groupId);
    if (!row) throw new Error("crew.groupNotFound");
    return crewGroupSchema.parse({
      groupId: row.group_id,
      name: row.name,
      relayMode: row.relay_mode,
      relayAutoHops: row.relay_auto_hops,
      relayBudgetMinutes: row.relay_budget_minutes,
      relayPaused: row.relay_paused === 1,
      members: this.db
        .prepare(
          "SELECT member_id,agent_id,access_mode FROM agent_crew_members WHERE group_id=? ORDER BY sort_order",
        )
        .all(groupId)
        .map((member) => ({
          memberId: member.member_id,
          agentId: member.agent_id,
          ...(member.access_mode === null ? {} : { accessMode: member.access_mode }),
        })),
      workspaceBinding: row.binding_json === null ? null : JSON.parse(String(row.binding_json)),
      epoch: row.epoch,
      status: row.recovery
        ? "recovery_required"
        : row.active
          ? "active"
          : row.binding_json === null
            ? "unbound"
            : "idle",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  list(): CrewGroup[] {
    return this.db
      .prepare("SELECT group_id FROM agent_crew_groups ORDER BY updated_at DESC,group_id")
      .all()
      .map((row) => this.group(String(row.group_id)));
  }
  resolve(member: CrewMember): CrewResolvedMember {
    return resolveCrewMember(this.db, member);
  }
  conversation(groupId: string, conversationId?: string) {
    return new CrewConversationStore(this.db).get(groupId, conversationId);
  }
  conversations(groupId: string) {
    return new CrewConversationStore(this.db).list(groupId);
  }
  createConversation(groupId: string, name = "") {
    return new CrewConversationStore(this.db).create(groupId, name);
  }
  deleteConversation(groupId: string, conversationId: string) {
    new CrewConversationStore(this.db).delete(groupId, conversationId);
  }
  detail(groupId: string, conversationId?: string): CrewGroupDetail {
    const group = this.group(groupId);
    const conversation = this.conversation(groupId, conversationId);
    return {
      group,
      conversation,
      conversations: this.conversations(groupId),
      resolvedMembers: group.members.map((member) => this.resolve(member)),
      messages: this.messages(groupId, conversation.conversationId),
      executions: this.executions(groupId, conversation.conversationId),
    };
  }
  messages(groupId: string, conversationId?: string): CrewMessage[] {
    const conversation = this.conversation(groupId, conversationId);
    return this.db
      .prepare(
        "SELECT * FROM agent_crew_messages WHERE group_id=? AND conversation_id=? ORDER BY sequence",
      )
      .all(groupId, conversation.conversationId)
      .map(readMessage);
  }
  executions(groupId: string, conversationId?: string): CrewExecution[] {
    const conversation = this.conversation(groupId, conversationId);
    return this.db
      .prepare(
        "SELECT * FROM agent_crew_executions WHERE group_id=? AND conversation_id=? ORDER BY created_at,rowid",
      )
      .all(groupId, conversation.conversationId)
      .map(readExecution);
  }
  execution(executionId: string): CrewExecution {
    const row = this.db
      .prepare("SELECT * FROM agent_crew_executions WHERE execution_id=?")
      .get(executionId);
    if (!row) throw new Error("crew.executionNotFound");
    return readExecution(row);
  }
  assertIdle(groupId: string): void {
    // 已结束的执行仍可持有待审批交接，不能据 terminal 状态放行解绑/成员变更。
    if (
      this.db
        .prepare(
          `SELECT 1 FROM agent_crew_executions WHERE group_id=? AND
          (status IN (${CREW_UNRESOLVED}) OR json_extract(relay_json,'$.status')='awaiting_user_approval') LIMIT 1`,
        )
        .get(groupId)
    ) {
      throw new Error("crew.groupBusy");
    }
  }
  create(name: string, members: CrewMember[], settings: RelaySettings = {}): CrewGroup {
    const now = Date.now(),
      groupId = randomUUID();
    this.db
      .prepare(`INSERT INTO agent_crew_groups(group_id,name,binding_json,epoch,created_at,updated_at,
        relay_mode,relay_auto_hops,relay_budget_minutes,relay_paused) VALUES(?,?,NULL,0,?,?,?,?,?,?)`)
      .run(
        groupId,
        name,
        now,
        now,
        settings.relayMode ?? "auto",
        settings.relayAutoHops ?? 2,
        settings.relayBudgetMinutes ?? 30,
        Number(settings.relayPaused ?? false),
      );
    this.replaceMembers(groupId, members);
    new CrewConversationStore(this.db).create(groupId, "", true);
    return this.group(groupId);
  }
  update(
    groupId: string,
    name: string,
    members?: CrewMember[],
    settings: RelaySettings = {},
  ): CrewGroup {
    if (
      settings.relayPaused !== undefined &&
      settings.relayPaused !== this.group(groupId).relayPaused
    )
      invalidateCrewRelayAdmissions(this.db, groupId);
    this.db
      .prepare(`UPDATE agent_crew_groups SET name=?,updated_at=?,relay_mode=COALESCE(?,relay_mode),
        relay_auto_hops=COALESCE(?,relay_auto_hops),relay_budget_minutes=COALESCE(?,relay_budget_minutes),
        relay_paused=COALESCE(?,relay_paused) WHERE group_id=?`)
      .run(
        name,
        Date.now(),
        settings.relayMode ?? null,
        settings.relayAutoHops ?? null,
        settings.relayBudgetMinutes ?? null,
        settings.relayPaused === undefined ? null : Number(settings.relayPaused),
        groupId,
      );
    // 仅重命名不属于成员写入，运行中或目录降权后也不能重写/重新校验引用。
    if (members) this.replaceMembers(groupId, members);
    return this.group(groupId);
  }
  private replaceMembers(groupId: string, members: CrewMember[]): void {
    // 成员仅持有引用；同事务校验后替换，失败整体回滚，不改历史执行快照。
    if (new Set(members.map((member) => member.agentId)).size !== members.length)
      throw new Error("crew.duplicateAgentId");
    members.forEach((member) => resolveCrewMember(this.db, member, true));
    this.db.prepare("DELETE FROM agent_crew_members WHERE group_id=?").run(groupId);
    const insert = this.db.prepare(
      "INSERT INTO agent_crew_members(group_id,member_id,sort_order,agent_id,access_mode) VALUES(?,?,?,?,?)",
    );
    members.forEach(({ memberId, agentId, accessMode }, index) => {
      insert.run(groupId, memberId, index, agentId, accessMode ?? null);
    });
  }
  bind(groupId: string, binding: CrewWorkspaceBinding, expectedEpoch: number): CrewGroup {
    this.assertIdle(groupId);
    const result = this.db
      .prepare(
        "UPDATE agent_crew_groups SET binding_json=?,epoch=epoch+1,updated_at=? WHERE group_id=? AND epoch=?",
      )
      .run(JSON.stringify(binding), Date.now(), groupId, expectedEpoch);
    if (result.changes !== 1) throw new Error("crew.bindingChanged");
    return this.group(groupId);
  }
  delete(groupId: string): void {
    this.group(groupId);
    this.assertIdle(groupId);
    this.db.prepare("DELETE FROM agent_crew_groups WHERE group_id=?").run(groupId);
  }
  enqueue(
    input: CrewSendParams,
    relay?: { rootRequestId: string; hop: number; objectiveHash: string },
  ): CrewSendResult {
    const group = this.group(input.groupId);
    const conversation = this.conversation(input.groupId, input.conversationId);
    const existing = this.db
      .prepare(
        "SELECT * FROM agent_crew_messages WHERE group_id=? AND conversation_id=? AND message_id=?",
      )
      .get(input.groupId, conversation.conversationId, input.messageId);
    if (existing) {
      const message = readMessage(existing);
      if (
        message.sender !== "user" ||
        message.text !== input.text ||
        JSON.stringify(message.mentions) !== JSON.stringify(input.mentions)
      ) {
        throw new Error("crew.messageConflict");
      }
      const row = this.db
        .prepare(
          "SELECT * FROM agent_crew_executions WHERE group_id=? AND conversation_id=? AND message_id=?",
        )
        .get(input.groupId, conversation.conversationId, input.messageId);
      return { message, execution: row ? readExecution(row) : null };
    }
    const member = input.mentions.length
      ? group.members.find((m) => m.memberId === input.mentions[0])
      : undefined;
    if (input.mentions.length && !member) throw new Error("crew.memberNotFound");
    if (member && !group.workspaceBinding) throw new Error("crew.workspaceUnbound");
    if (member && conversation.status === "recovery_required")
      throw new Error("crew.recoveryRequired");
    const snapshot = member ? this.resolve(member) : undefined;
    if (snapshot) assertCrewCapabilities(snapshot);
    const message = this.insertMessage({
      groupId: input.groupId,
      conversationId: conversation.conversationId,
      messageId: input.messageId,
      epoch: group.epoch,
      sender: "user",
      memberId: null,
      text: input.text,
      mentions: input.mentions,
      executionId: null,
    });
    let execution: CrewExecution | null = null;
    if (member && group.workspaceBinding) {
      const now = Date.now(),
        executionId = randomUUID();
      this.db
        .prepare(`INSERT INTO agent_crew_executions(execution_id,group_id,conversation_id,message_id,member_id,
          epoch,status,member_snapshot_json,binding_json,owner_id,task_id,created_at,updated_at,
          root_request_id,hop,relay_objective_hash,relay_budget_minutes_snapshot)
          VALUES(?,?,?,?,?,?,'queued',?,?,NULL,NULL,?,?,?,?,?,COALESCE((SELECT relay_budget_minutes_snapshot
          FROM agent_crew_executions WHERE group_id=? AND conversation_id=? AND root_request_id=? AND hop=0 LIMIT 1),?))`)
        .run(
          executionId,
          group.groupId,
          conversation.conversationId,
          input.messageId,
          member.memberId,
          group.epoch,
          JSON.stringify(snapshot),
          JSON.stringify(group.workspaceBinding),
          now,
          now,
          relay?.rootRequestId ?? input.messageId,
          relay?.hop ?? 0,
          relay?.objectiveHash ?? null,
          group.groupId,
          conversation.conversationId,
          relay?.rootRequestId ?? input.messageId,
          group.relayBudgetMinutes ?? 30,
        );
      execution = this.execution(executionId);
    }
    return { message, execution };
  }
  insertMessage(input: Omit<CrewMessage, "sequence" | "createdAt">): CrewMessage {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM agent_crew_messages WHERE group_id=? AND conversation_id=?",
      )
      .get(input.groupId, input.conversationId)!;
    const message: CrewMessage = {
      ...input,
      sequence: Number(row.sequence),
      createdAt: Date.now(),
    };
    this.db
      .prepare(`INSERT INTO agent_crew_messages(group_id,conversation_id,message_id,epoch,sequence,sender,
        member_id,text,mentions_json,execution_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        message.groupId,
        message.conversationId,
        message.messageId,
        message.epoch,
        message.sequence,
        message.sender,
        message.memberId,
        message.text,
        JSON.stringify(message.mentions),
        message.executionId,
        message.createdAt,
      );
    this.db
      .prepare("UPDATE agent_crew_groups SET updated_at=? WHERE group_id=?")
      .run(message.createdAt, message.groupId);
    this.db
      .prepare(
        "UPDATE agent_crew_conversations SET updated_at=? WHERE group_id=? AND conversation_id=?",
      )
      .run(message.createdAt, message.groupId, message.conversationId);
    return message;
  }
  context(execution: CrewExecution): CrewMessage[] {
    return readCrewContext(this.db, execution);
  }
}
