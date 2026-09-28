export const EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL = `
  create table if not exists external_runtime_task (
    task_id text not null,
    attempt_id text not null,
    request_json text not null,
    runtime_state text not null,
    pause_reason text,
    enqueued_at text not null,
    updated_at text not null,
    primary key(task_id, attempt_id)
  );

  create index if not exists external_runtime_task_state_idx
    on external_runtime_task(runtime_state, updated_at);

  create table if not exists external_runtime_queue_meta (
    id integer primary key check(id = 1),
    pause_reason text,
    updated_at text not null
  );
`;
