export const EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL = `
  alter table external_runtime_task add column native_session_id text;
`;
