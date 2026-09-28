/** 冻结 v6：默认对话 ID 等于历史 group_id；迁移只新增分区，不重写历史字段。 */
export const AGENT_CREW_CONVERSATIONS_MIGRATION_SQL = `
CREATE TABLE agent_crew_conversations (
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL CHECK(is_default IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_id,conversation_id)
);
CREATE UNIQUE INDEX idx_agent_crew_default_conversation
  ON agent_crew_conversations(group_id) WHERE is_default=1;
INSERT INTO agent_crew_conversations
  SELECT group_id,group_id,'',1,created_at,updated_at FROM agent_crew_groups;

CREATE TABLE agent_crew_messages_v6 (
  group_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  sender TEXT NOT NULL CHECK(sender IN ('user','member')),
  member_id TEXT,
  text TEXT NOT NULL,
  mentions_json TEXT NOT NULL,
  execution_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(group_id,conversation_id,message_id),
  UNIQUE(group_id,conversation_id,sequence),
  FOREIGN KEY(group_id,conversation_id) REFERENCES agent_crew_conversations(group_id,conversation_id) ON DELETE CASCADE
);
INSERT INTO agent_crew_messages_v6
  SELECT group_id,group_id,message_id,epoch,sequence,sender,member_id,text,mentions_json,execution_id,created_at
  FROM agent_crew_messages ORDER BY rowid;

CREATE TABLE agent_crew_executions_v6 (
  execution_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled','recovery_required')),
  member_snapshot_json TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  owner_id TEXT,
  task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(group_id,conversation_id,message_id,member_id),
  FOREIGN KEY(group_id,conversation_id,message_id) REFERENCES agent_crew_messages_v6(group_id,conversation_id,message_id) ON DELETE CASCADE
);
INSERT INTO agent_crew_executions_v6
  SELECT execution_id,group_id,group_id,message_id,member_id,epoch,status,member_snapshot_json,binding_json,owner_id,task_id,created_at,updated_at
  FROM agent_crew_executions ORDER BY rowid;

DROP TABLE agent_crew_executions;
DROP TABLE agent_crew_messages;
ALTER TABLE agent_crew_messages_v6 RENAME TO agent_crew_messages;
ALTER TABLE agent_crew_executions_v6 RENAME TO agent_crew_executions;
CREATE INDEX idx_agent_crew_executions_queue
  ON agent_crew_executions(group_id,conversation_id,status,created_at);
`;
