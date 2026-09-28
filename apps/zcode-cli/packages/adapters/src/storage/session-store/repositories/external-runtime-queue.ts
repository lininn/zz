import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  ExternalRuntimeTaskRequestSchema,
  type ExternalRuntimeQueueRecord,
  type ExternalRuntimeQueueSnapshot,
  type ExternalRuntimeQueueStore,
} from "@zcode/contracts";

const crewQueueMetadataSchema = z.object({
  version: z.literal(1),
  summary: z.string().max(8000).optional(),
  settled: z.boolean().optional(),
  queuePauseReason: z.string().optional(),
  remoteSessionId: z.string().optional(),
}).strict();

export interface ExternalRuntimeQueueScope {
  workspaceIdentity: string;
  workspacePath: string;
  remoteSessionId?: string;
}

interface ExternalRuntimeTaskRow {
  task_id: string;
  attempt_id: string;
  request_json: string;
  runtime_state: string;
  pause_reason: string | null;
  native_session_id: string | null;
  enqueued_at: string;
  updated_at: string;
}

interface ExternalRuntimeQueueMetaRow {
  pause_reason: string | null;
  updated_at: string;
}

function decodeRecord(row: ExternalRuntimeTaskRow): ExternalRuntimeQueueRecord {
  let request: unknown;
  try {
    request = JSON.parse(row.request_json);
  } catch {
    throw new Error(
      `external runtime queue: corrupt request payload for task ${row.task_id} attempt ${row.attempt_id}`,
    );
  }
  const parsed = ExternalRuntimeTaskRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new Error(
      `external runtime queue: invalid request payload for task ${row.task_id} attempt ${row.attempt_id}`,
    );
  }
  const metadata = decodeCrewMetadata(request);
  return {
    request: parsed.data,
    ...(metadata?.summary === undefined ? {} : { summary: metadata.summary }),
    ...(metadata?.settled === undefined ? {} : { settled: metadata.settled }),
    runtimeState: row.runtime_state as ExternalRuntimeQueueRecord["runtimeState"],
    ...(row.pause_reason === null ? {} : { pauseReason: row.pause_reason }),
    ...(row.native_session_id === null ? {} : { nativeSessionId: row.native_session_id }),
    enqueuedAt: row.enqueued_at,
    updatedAt: row.updated_at,
  };
}

function decodeCrewMetadata(request: unknown) {
  const metadata = (request as Record<string, unknown>)._crewRuntime;
  return metadata === undefined ? undefined : crewQueueMetadataSchema.parse(metadata);
}

export class SqliteExternalRuntimeQueueStore implements ExternalRuntimeQueueStore {
  constructor(private readonly db: DatabaseSync, private readonly scope?: ExternalRuntimeQueueScope) {}

  private owns(entry: ExternalRuntimeQueueRecord): boolean {
    return !this.scope || (entry.request.workspace.identity === this.scope.workspaceIdentity &&
      (entry.request.workspace.path === this.scope.workspacePath || entry.request.workspace.isolated === true));
  }

  load(): ExternalRuntimeQueueSnapshot | undefined {
    const meta = this.db
      .prepare("select pause_reason, updated_at from external_runtime_queue_meta where id = 1")
      .get() as ExternalRuntimeQueueMetaRow | undefined;
    const rows = this.db
      .prepare(
        `
        select task_id, attempt_id, request_json, runtime_state, pause_reason, native_session_id,
          enqueued_at, updated_at
        from external_runtime_task
        order by rowid
        `,
      )
      .all() as unknown as ExternalRuntimeTaskRow[];
    const owned = rows.filter((row) => this.owns(decodeRecord(row)) &&
      (!this.scope || decodeCrewMetadata(JSON.parse(row.request_json))?.remoteSessionId === this.scope.remoteSessionId));
    if (owned.length === 0 && (this.scope || !meta)) return undefined;
    // Scoped queues cannot inherit another workspace's pause or pending execution.
    const pauseReason = this.scope
      ? owned.map((row) => decodeCrewMetadata(JSON.parse(row.request_json))?.queuePauseReason).find(Boolean)
      : meta?.pause_reason;
    return {
      version: 1,
      ...(pauseReason == null ? {} : { pauseReason }),
      entries: owned.map(decodeRecord),
    };
  }

  save(snapshot: ExternalRuntimeQueueSnapshot): void {
    if (snapshot.version !== 1) throw new Error("external runtime queue: unsupported snapshot version");
    const now = Date.now();
    this.db.exec("begin immediate");
    try {
      if (snapshot.entries.some((entry) => !this.owns(entry))) throw new Error("external runtime queue scope mismatch");
      if (this.scope) {
        // 旧整表替换会删除别的 workspace 队列；只在同一事务中替换当前 owner 的行。
        const owned = this.load()?.entries ?? [];
        const remove = this.db.prepare("delete from external_runtime_task where task_id = ? and attempt_id = ?");
        for (const entry of owned) remove.run(entry.request.taskId, entry.request.attemptId);
      } else this.db.prepare("delete from external_runtime_task").run();
      const insert = this.db.prepare(
        `
        insert into external_runtime_task (
          task_id, attempt_id, request_json, runtime_state, pause_reason, native_session_id,
          enqueued_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      );
      for (const entry of snapshot.entries) {
        insert.run(
          entry.request.taskId,
          entry.request.attemptId,
          JSON.stringify({ ...entry.request, _crewRuntime: crewQueueMetadataSchema.parse({
            version: 1, summary: entry.summary, settled: entry.settled, queuePauseReason: snapshot.pauseReason, remoteSessionId: this.scope?.remoteSessionId,
          }) }),
          entry.runtimeState,
          entry.pauseReason ?? null,
          entry.nativeSessionId ?? null,
          entry.enqueuedAt,
          entry.updatedAt,
        );
      }
      this.db
        .prepare(
          `
          insert into external_runtime_queue_meta (id, pause_reason, updated_at)
          values (1, ?, ?)
          on conflict(id) do update set pause_reason = excluded.pause_reason, updated_at = excluded.updated_at
          `,
        )
        .run(snapshot.pauseReason ?? null, now);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

export function createSqliteExternalRuntimeQueueStore(db: DatabaseSync, scope?: ExternalRuntimeQueueScope): ExternalRuntimeQueueStore {
  return new SqliteExternalRuntimeQueueStore(db, scope);
}
