/** 冻结的 v4 SQL：历史 checksum 不依赖实时 service 类型或表定义。 */
export const AGENT_CREW_MIGRATION_SQL = `
CREATE TABLE agent_crew_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  binding_json TEXT,
  epoch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE agent_crew_members (
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY(group_id, member_id),
  UNIQUE(group_id, sort_order)
);
CREATE TABLE agent_crew_messages (
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  sender TEXT NOT NULL CHECK(sender IN ('user','member')),
  member_id TEXT,
  text TEXT NOT NULL,
  mentions_json TEXT NOT NULL,
  execution_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, message_id),
  UNIQUE(group_id, sequence)
);
CREATE TABLE agent_crew_executions (
  execution_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
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
  UNIQUE(group_id, message_id, member_id),
  FOREIGN KEY(group_id, message_id) REFERENCES agent_crew_messages(group_id, message_id) ON DELETE CASCADE
);
CREATE INDEX idx_agent_crew_executions_queue ON agent_crew_executions(group_id,status,created_at);
CREATE TABLE agent_crew_workspace_leases (
  workspace_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  runtime_pid INTEGER,
  created_at INTEGER NOT NULL
);
`;
