import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ExternalRuntimeTaskRequestSchema,
  type ExternalRuntimeQueueSnapshot,
} from "@zcode/contracts";
import { SqliteExternalRuntimeQueueStore } from "../../../adapters/src/storage/session-store/repositories/external-runtime-queue.js";
import { EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0023-external-runtime-queue.js";
import { EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL } from "../../../adapters/src/storage/session-store/migrations/0024-external-runtime-native-session.js";
import { request, timestamp } from "../../../core/test/runtime-task/crew-runtime-fixture.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(EXTERNAL_RUNTIME_QUEUE_MIGRATION_SQL);
  db.exec(EXTERNAL_RUNTIME_NATIVE_SESSION_MIGRATION_SQL);
  return db;
}
function snapshot(id: string): ExternalRuntimeQueueSnapshot {
  return {
    version: 1,
    entries: [
      {
        request: request({ taskId: id }),
        runtimeState: "succeeded",
        summary: "saved summary",
        settled: true,
        enqueuedAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}

test("crew metadata and queue state persist atomically even at identical timestamps", () => {
  const db = database();
  try {
    const store = new SqliteExternalRuntimeQueueStore(db);
    const value = snapshot("crew-1");
    store.save(value);
    const encoded = JSON.parse(
      (
        db.prepare("select request_json from external_runtime_task").get() as {
          request_json: string;
        }
      ).request_json,
    );
    assert.deepEqual(ExternalRuntimeTaskRequestSchema.parse(encoded), value.entries[0]!.request);
    assert.deepEqual(store.load(), value);
    const invalid = structuredClone(value);
    invalid.entries[0]!.summary = "x".repeat(8001);
    invalid.entries[0]!.settled = false;
    assert.throws(() => store.save(invalid));
    assert.deepEqual(store.load(), value);
  } finally {
    db.close();
  }
});

test("crew scoped storage partitions remote attachments without dropping other queued tasks", () => {
  const db = database();
  try {
    const scope = { workspaceIdentity: "workspace-1", workspacePath: "/workspace" };
    const first = new SqliteExternalRuntimeQueueStore(db, {
      ...scope,
      remoteSessionId: "attachment-1",
    });
    const second = new SqliteExternalRuntimeQueueStore(db, {
      ...scope,
      remoteSessionId: "attachment-2",
    });
    const queued = snapshot("crew-2");
    queued.entries[0]!.runtimeState = "queued";
    queued.entries[0]!.settled = false;
    second.save(queued);
    first.save(snapshot("crew-1"));
    assert.deepEqual(second.load(), queued);
    assert.equal(first.load()?.entries.length, 1);
    first.save({ version: 1, entries: [] });
    assert.deepEqual(second.load(), queued);
  } finally {
    db.close();
  }
});
