import type { DatabaseSync } from "node:sqlite";
import {
  crewExecutionSchema,
  crewMessageSchema,
  type CrewExecution,
  type CrewMessage,
} from "@zcode/shared";

type Row = Record<string, unknown>;

export function readExecution(row: Row): CrewExecution {
  return crewExecutionSchema.parse({
    executionId: row.execution_id,
    groupId: row.group_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    rootRequestId: row.root_request_id,
    relayBudgetMinutes: row.relay_budget_minutes_snapshot,
    hop: row.hop,
    relay: row.relay_json == null ? undefined : JSON.parse(String(row.relay_json)),
    memberId: row.member_id,
    epoch: row.epoch,
    status: row.status,
    memberSnapshot: JSON.parse(String(row.member_snapshot_json)),
    workspaceBinding: JSON.parse(String(row.binding_json)),
    ownerId: row.owner_id,
    taskId: row.task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
export function readMessage(row: Row): CrewMessage {
  return crewMessageSchema.parse({
    groupId: row.group_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    epoch: row.epoch,
    sequence: row.sequence,
    sender: row.sender,
    kind: row.kind,
    memberId: row.member_id,
    text: row.text,
    mentions: JSON.parse(String(row.mentions_json)),
    executionId: row.execution_id,
    createdAt: row.created_at,
  });
}

export function readCrewContext(db: DatabaseSync, execution: CrewExecution): CrewMessage[] {
  // SQL 先裁剪行数，避免长群板在执行入口全量读取；只取当前纪元且不读取未来消息。
  const rows = db
    .prepare(`SELECT * FROM agent_crew_messages WHERE group_id=? AND conversation_id=? AND epoch=? AND kind='chat' AND sequence<=
      (SELECT sequence FROM agent_crew_messages WHERE group_id=? AND conversation_id=? AND message_id=?) ORDER BY sequence DESC LIMIT 24`)
    .all(
      execution.groupId,
      execution.conversationId,
      execution.epoch,
      execution.groupId,
      execution.conversationId,
      execution.messageId,
    )
    .map(readMessage);
  let budget = 16000;
  return rows
    .filter((message) => {
      if (message.messageId === execution.messageId) return true;
      if (!budget) return false;
      message.text = message.text.slice(0, Math.min(4000, budget));
      budget -= message.text.length;
      return true;
    })
    .reverse();
}
