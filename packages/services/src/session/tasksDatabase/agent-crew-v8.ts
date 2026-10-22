/** 冻结 v8：群公告与事件消息只新增列，不改写既有消息和接力审计语义。 */
export const AGENT_CREW_ANNOUNCEMENT_EVENTS_MIGRATION_SQL = `
ALTER TABLE agent_crew_groups ADD COLUMN announcement TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_crew_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
`;
