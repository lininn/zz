import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { crewConversationSchema, type CrewConversation } from "@zcode/shared";

/** 会话状态由其执行记录派生，不复制群组配置或建立第二份运行状态。 */
export class CrewConversationStore {
  constructor(private readonly db: DatabaseSync) {}

  private assertGroup(groupId: string): void {
    if (!this.db.prepare("SELECT 1 FROM agent_crew_groups WHERE group_id=?").get(groupId))
      throw new Error("crew.groupNotFound");
  }

  get(groupId: string, conversationId?: string): CrewConversation {
    this.assertGroup(groupId);
    const row = this.db
      .prepare(`SELECT c.*,
      EXISTS(SELECT 1 FROM agent_crew_executions e WHERE e.group_id=c.group_id
        AND e.conversation_id=c.conversation_id AND e.status='recovery_required') AS recovery,
      EXISTS(SELECT 1 FROM agent_crew_executions e WHERE e.group_id=c.group_id
        AND e.conversation_id=c.conversation_id AND e.status IN ('queued','running')) AS active,
      EXISTS(SELECT 1 FROM agent_crew_executions e WHERE e.group_id=c.group_id
        AND e.conversation_id=c.conversation_id
        AND json_extract(e.relay_json,'$.status')='awaiting_user_approval') AS awaiting_approval,
      (SELECT e.status FROM agent_crew_executions e WHERE e.group_id=c.group_id
        AND e.conversation_id=c.conversation_id ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1) AS latest_status
      FROM agent_crew_conversations c WHERE c.group_id=?
        AND ${conversationId === undefined ? "c.is_default=1" : "c.conversation_id=?"}`)
      .get(...(conversationId === undefined ? [groupId] : [groupId, conversationId]));
    if (!row) throw new Error("crew.conversationNotFound");
    // 恢复隔离优先；待审批交接不能被同会话其他执行的 active 状态遮蔽。
    return crewConversationSchema.parse({
      groupId: row.group_id,
      conversationId: row.conversation_id,
      name: row.name,
      isDefault: row.is_default === 1,
      status: row.recovery
        ? "recovery_required"
        : row.awaiting_approval
          ? "awaiting_user_approval"
          : row.active
            ? "active"
            : row.latest_status === "failed"
              ? "failed"
              : "idle",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  list(groupId: string): CrewConversation[] {
    this.assertGroup(groupId);
    return this.db
      .prepare(`SELECT conversation_id FROM agent_crew_conversations
      WHERE group_id=? ORDER BY is_default DESC,created_at,rowid`)
      .all(groupId)
      .map((row) => this.get(groupId, String(row.conversation_id)));
  }

  create(groupId: string, name = "", isDefault = false): CrewConversation {
    this.assertGroup(groupId);
    const conversationId = isDefault ? groupId : randomUUID();
    const now = Date.now();
    this.db
      .prepare(`INSERT INTO agent_crew_conversations(group_id,conversation_id,name,is_default,created_at,updated_at)
        VALUES(?,?,?,?,?,?)`)
      .run(groupId, conversationId, name, Number(isDefault), now, now);
    this.db.prepare("UPDATE agent_crew_groups SET updated_at=? WHERE group_id=?").run(now, groupId);
    return this.get(groupId, conversationId);
  }

  delete(groupId: string, conversationId: string): void {
    const conversation = this.get(groupId, conversationId);
    // 默认会话承载群组身份（ID 与群组相同），删除会破坏 detail/get 的既有约定。
    if (conversation.isDefault) throw new Error("crew.defaultConversationProtected");
    // 运行中或待恢复/待审批的会话与群组共用删除护栏，避免级联清理掉活跃执行。
    const busy = this.db
      .prepare(
        `SELECT 1 FROM agent_crew_executions WHERE group_id=? AND conversation_id=? AND
        (status IN ('queued','running','recovery_required')
        OR json_extract(relay_json,'$.status')='awaiting_user_approval') LIMIT 1`,
      )
      .get(groupId, conversationId);
    if (busy) throw new Error("crew.conversationBusy");
    this.db
      .prepare("DELETE FROM agent_crew_conversations WHERE group_id=? AND conversation_id=?")
      .run(groupId, conversationId);
    this.db
      .prepare("UPDATE agent_crew_groups SET updated_at=? WHERE group_id=?")
      .run(Date.now(), groupId);
  }
}
