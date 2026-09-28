import type { DatabaseSync } from "node:sqlite";

/** 在同一控制变更事务中让待审批提案的旧准入失效，避免暂停→恢复的ABA竞态。 */
export function invalidateCrewRelayAdmissions(
  db: DatabaseSync,
  groupId: string,
  conversationId?: string,
): void {
  db.prepare(`UPDATE agent_crew_executions SET relay_json=json_set(relay_json,'$.admissionRevision',
    COALESCE(json_extract(relay_json,'$.admissionRevision'),0)+1)
    WHERE group_id=? AND json_extract(relay_json,'$.status')='awaiting_user_approval'
    ${conversationId === undefined ? "" : "AND conversation_id=?"}`).run(
    ...(conversationId === undefined ? [groupId] : [groupId, conversationId]),
  );
}
