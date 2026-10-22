CREATE TABLE agent_crew_agents (
  agent_id TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL
);

CREATE TABLE agent_crew_conversations (
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL CHECK(is_default IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_id,conversation_id)
);

CREATE TABLE "agent_crew_executions" (
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
  updated_at INTEGER NOT NULL, root_request_id TEXT NOT NULL DEFAULT '', hop INTEGER NOT NULL DEFAULT 0 CHECK(hop BETWEEN 0 AND 8), relay_json TEXT, relay_budget_minutes_snapshot INTEGER NOT NULL DEFAULT 30
  CHECK(relay_budget_minutes_snapshot BETWEEN 1 AND 1440), relay_objective_hash TEXT, relay_cancel_requested INTEGER NOT NULL DEFAULT 0
  CHECK(relay_cancel_requested IN (0,1)),
  UNIQUE(group_id,conversation_id,message_id,member_id),
  FOREIGN KEY(group_id,conversation_id,message_id) REFERENCES "agent_crew_messages"(group_id,conversation_id,message_id) ON DELETE CASCADE
);

CREATE TABLE agent_crew_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  binding_json TEXT,
  epoch INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
, relay_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK(relay_mode IN ('manual','semi','auto')), relay_auto_hops INTEGER NOT NULL DEFAULT 2
  CHECK(relay_auto_hops BETWEEN 0 AND 8), relay_budget_minutes INTEGER NOT NULL DEFAULT 30
  CHECK(relay_budget_minutes BETWEEN 1 AND 1440), relay_paused INTEGER NOT NULL DEFAULT 0
  CHECK(relay_paused IN (0,1)), announcement TEXT NOT NULL DEFAULT '');

CREATE TABLE "agent_crew_members" (
  group_id TEXT NOT NULL REFERENCES agent_crew_groups(group_id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agent_crew_agents(agent_id) ON DELETE RESTRICT,
  access_mode TEXT CHECK(access_mode IN ('read','write')),
  PRIMARY KEY(group_id,member_id),
  UNIQUE(group_id,sort_order),
  UNIQUE(group_id,agent_id)
);

CREATE TABLE "agent_crew_messages" (
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
  created_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'chat',
  PRIMARY KEY(group_id,conversation_id,message_id),
  UNIQUE(group_id,conversation_id,sequence),
  FOREIGN KEY(group_id,conversation_id) REFERENCES agent_crew_conversations(group_id,conversation_id) ON DELETE CASCADE
);

CREATE TABLE agent_crew_workspace_leases (
  workspace_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  runtime_pid INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE automation_runs (
        run_id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        scheduled_at INTEGER,
        trigger TEXT NOT NULL DEFAULT 'schedule',
        model_selection TEXT,
        dispatch_status TEXT NOT NULL DEFAULT 'claimed',
        outcome TEXT,
        session_id TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

CREATE TABLE automations (
        automation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        cron_expr TEXT NOT NULL,
        prompt TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        mode TEXT,
        thought_level TEXT,
        model_selection TEXT,
        workspace_key TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        workspace_identity TEXT,
        target_task_id TEXT,
        bot_delivery_target TEXT,
        location_kind TEXT NOT NULL DEFAULT 'local',
        recurring INTEGER NOT NULL DEFAULT 1,
        max_runs INTEGER,
        end_at INTEGER,
        schedule_rule TEXT,
        schedule_edited_by_user INTEGER NOT NULL DEFAULT 0,
        run_count INTEGER NOT NULL DEFAULT 0,
        scheduled_run_count INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        lifecycle_status TEXT NOT NULL DEFAULT 'active',
        next_run_at INTEGER,
        last_run_at INTEGER,
        running INTEGER NOT NULL DEFAULT 0,
        claimed_at INTEGER,
        dispatch_status TEXT NOT NULL DEFAULT 'idle',
        dispatch_attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      , project_id TEXT, host_id TEXT, additional_directories TEXT);

CREATE TABLE hosts (
 host_id TEXT PRIMARY KEY, kind TEXT NOT NULL, target_json TEXT, membership_id TEXT,
 position INTEGER NOT NULL DEFAULT 0, last_connection_status TEXT, last_connection_error TEXT, last_opened_at INTEGER);

CREATE TABLE off_peak_tasks (
        off_peak_task_id   TEXT PRIMARY KEY,
        server_ticket_id   TEXT,
        title              TEXT NOT NULL DEFAULT '',
        conversation_id    TEXT,
        session_id         TEXT,
        prompt             TEXT NOT NULL,
        permission_mode    TEXT NOT NULL,
        model              TEXT,
        thought_level      TEXT,
        model_selection    TEXT,
        workspace_key      TEXT NOT NULL,
        workspace_path     TEXT NOT NULL,
        workspace_identity TEXT,
        status             TEXT NOT NULL,
        queued_at          INTEGER NOT NULL,
        started_at         INTEGER,
        ended_at           INTEGER,
        failure_reason     TEXT,
        files_changed      INTEGER,
        settled_at         INTEGER,
        history_deleted_at INTEGER,
        registered_at      INTEGER,
        schedulable        INTEGER NOT NULL DEFAULT 0,
        queue_position     INTEGER,
        next_poll_at       INTEGER,
        claim_running      INTEGER NOT NULL DEFAULT 0,
        claimed_at         INTEGER,
        attempt_count      INTEGER NOT NULL DEFAULT 0,
        last_error         TEXT,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
      , project_id TEXT, host_id TEXT, additional_directories TEXT);

CREATE TABLE project_roots (
 project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
 root_path TEXT NOT NULL, position INTEGER NOT NULL, is_primary INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,root_path));

CREATE TABLE projects (
 project_id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES hosts(host_id), name TEXT NOT NULL,
 name_overridden INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
 pinned_at INTEGER, deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE remote_project_entries (
 entry_id TEXT PRIMARY KEY, host_id TEXT NOT NULL REFERENCES hosts(host_id) ON DELETE CASCADE,
 remote_project_id TEXT, cached_name TEXT NOT NULL, cached_roots_json TEXT NOT NULL DEFAULT '[]',
 legacy_workspace_json TEXT, last_synced_at INTEGER, initial_position INTEGER, UNIQUE(host_id,remote_project_id));

CREATE TABLE "schema_migration" (id text primary key, checksum text not null, app_version text, "applied_at" integer not null);

CREATE TABLE task_group_admissions (
  workspace_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  system_kind TEXT,
  user_organized INTEGER NOT NULL DEFAULT 0,
  creation_id TEXT,
  PRIMARY KEY (workspace_key, task_id)
);

CREATE TABLE task_group_members (
        group_id TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        workspace_identity TEXT,
        task_id TEXT NOT NULL,
        sort_order INTEGER,
        added_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_key, task_id),
        FOREIGN KEY (group_id) REFERENCES task_groups(group_id) ON DELETE CASCADE
      );

CREATE TABLE task_group_view_node_orders (
        node_type TEXT NOT NULL,
        node_key TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (node_type, node_key)
      );

CREATE TABLE task_group_workspace_bootstraps (
        workspace_key TEXT PRIMARY KEY,
        group_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

CREATE TABLE task_groups (
        group_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'gray',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

CREATE TABLE tasks (
        workspace_key TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        workspace_identity TEXT,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        task_status TEXT,
        provider TEXT,
        mode TEXT NOT NULL DEFAULT 'build',
        model TEXT,
        migration_source TEXT,
        forked_from_task_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        unread_at INTEGER,
        last_unread_at INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        title_overridden INTEGER NOT NULL DEFAULT 0,
        meta_json TEXT NOT NULL DEFAULT '{}', searchable_text TEXT NOT NULL DEFAULT '', cron_automation_id TEXT, off_peak_task_id TEXT, host_id TEXT, root_path TEXT, project_id TEXT, execution_directories TEXT, sort_order INTEGER, cli_title TEXT, handoff_pending INTEGER NOT NULL DEFAULT 0, cli_title_source TEXT, cli_created_at INTEGER, cli_updated_at INTEGER, cli_last_outcome TEXT, cli_deleted INTEGER,
        PRIMARY KEY (workspace_key, task_id)
      );

CREATE TABLE "tasks_schema_migration" (id text primary key, checksum text not null,  "time_applied" integer not null);

CREATE UNIQUE INDEX idx_agent_crew_default_conversation
  ON agent_crew_conversations(group_id) WHERE is_default=1;

CREATE INDEX idx_agent_crew_executions_queue
  ON agent_crew_executions(group_id,conversation_id,status,created_at);

CREATE UNIQUE INDEX idx_agent_crew_relay_objective
  ON agent_crew_executions(group_id,conversation_id,root_request_id,member_id,relay_objective_hash)
  WHERE relay_objective_hash IS NOT NULL;

CREATE INDEX idx_automation_runs_by_automation
      ON automation_runs (automation_id, created_at DESC);

CREATE INDEX idx_automations_due
      ON automations (enabled, next_run_at);

CREATE INDEX idx_automations_retry
      ON automations (enabled, retry_at);

CREATE INDEX idx_automations_target_task ON automations(target_task_id) WHERE target_task_id IS NOT NULL;

CREATE INDEX idx_automations_workspace
      ON automations (workspace_key);

CREATE UNIQUE INDEX idx_off_peak_bound_active ON off_peak_tasks(workspace_key,session_id) WHERE session_id IS NOT NULL AND status NOT IN ('completed','failed','cancelled');

CREATE INDEX idx_off_peak_pick
      ON off_peak_tasks (status, queued_at);

CREATE INDEX idx_off_peak_ws
      ON off_peak_tasks (workspace_key, status);

CREATE UNIQUE INDEX idx_projects_host_name ON projects(host_id,name) WHERE deleted=0;

CREATE INDEX idx_task_group_members_group_order
      ON task_group_members (group_id, sort_order, added_at);

CREATE INDEX idx_task_group_view_node_orders_order
      ON task_group_view_node_orders (sort_order, created_at);

CREATE INDEX idx_tasks_cron_automation ON tasks(cron_automation_id, updated_at DESC)
    WHERE cron_automation_id IS NOT NULL AND deleted=0;

CREATE UNIQUE INDEX idx_tasks_host_task ON tasks(host_id,task_id);

CREATE INDEX idx_tasks_off_peak_task ON tasks(off_peak_task_id, updated_at DESC)
    WHERE off_peak_task_id IS NOT NULL AND deleted=0;

CREATE INDEX idx_tasks_project ON tasks(project_id,archived,cli_updated_at DESC) WHERE deleted=0;

CREATE INDEX idx_tasks_workspace_archived_updated
      ON tasks (workspace_key, archived, updated_at DESC)
      WHERE deleted = 0;

CREATE INDEX idx_tasks_workspace_pinned_updated
      ON tasks (workspace_key, pinned, updated_at DESC)
      WHERE deleted = 0;
