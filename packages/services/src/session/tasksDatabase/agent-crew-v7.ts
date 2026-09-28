/** 冻结 v7：接力配置与决策沿用群组/执行行，不改写历史迁移和审计快照。 */
export const AGENT_CREW_RELAY_MIGRATION_SQL = `
ALTER TABLE agent_crew_groups ADD COLUMN relay_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK(relay_mode IN ('manual','semi','auto'));
ALTER TABLE agent_crew_groups ADD COLUMN relay_auto_hops INTEGER NOT NULL DEFAULT 2
  CHECK(relay_auto_hops BETWEEN 0 AND 8);
ALTER TABLE agent_crew_groups ADD COLUMN relay_budget_minutes INTEGER NOT NULL DEFAULT 30
  CHECK(relay_budget_minutes BETWEEN 1 AND 1440);
ALTER TABLE agent_crew_groups ADD COLUMN relay_paused INTEGER NOT NULL DEFAULT 0
  CHECK(relay_paused IN (0,1));
ALTER TABLE agent_crew_executions ADD COLUMN root_request_id TEXT NOT NULL DEFAULT '';
UPDATE agent_crew_executions SET root_request_id=message_id;
ALTER TABLE agent_crew_executions ADD COLUMN hop INTEGER NOT NULL DEFAULT 0 CHECK(hop BETWEEN 0 AND 8);
ALTER TABLE agent_crew_executions ADD COLUMN relay_json TEXT;
ALTER TABLE agent_crew_executions ADD COLUMN relay_budget_minutes_snapshot INTEGER NOT NULL DEFAULT 30
  CHECK(relay_budget_minutes_snapshot BETWEEN 1 AND 1440);
ALTER TABLE agent_crew_executions ADD COLUMN relay_objective_hash TEXT;
-- 取消意图先于异步 runtime.cancel 落盘，避免等待期间 finish 越过取消边界自动派工。
ALTER TABLE agent_crew_executions ADD COLUMN relay_cancel_requested INTEGER NOT NULL DEFAULT 0
  CHECK(relay_cancel_requested IN (0,1));
CREATE UNIQUE INDEX idx_agent_crew_relay_objective
  ON agent_crew_executions(group_id,conversation_id,root_request_id,member_id,relay_objective_hash)
  WHERE relay_objective_hash IS NOT NULL;
`;
