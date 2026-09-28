// ============================================================
// External Runtime Queue Port - durable dispatch state boundary
// ============================================================

import type {
  ExternalRuntimeState,
  ExternalRuntimeTaskRequest,
} from "./external-runtime.port.js";

export interface ExternalRuntimeDispatchResult {
  runtimeState: ExternalRuntimeState;
  structuredResult: boolean;
  /** False when process cleanup could not be proven. */
  settled?: boolean;
  workspaceChanged?: boolean;
  verification?: "passed" | "failed" | "missing" | "skipped";
  pauseReason?: string;
  nativeSessionId?: string;
  summary?: string;
}

export interface ExternalRuntimeQueueRecord {
  request: ExternalRuntimeTaskRequest;
  runtimeState: ExternalRuntimeState;
  enqueuedAt: string;
  updatedAt: string;
  /** Proof of settled dispatch supervision, never inferred from a cancel request. */
  settled?: boolean;
  permission?: { requestId: string; toolName: string; description: string; canRespond: boolean };
  pauseReason?: string;
  nativeSessionId?: string;
  summary?: string;
}

export interface ExternalRuntimeQueueSnapshot {
  version: 1;
  pauseReason?: string;
  entries: ExternalRuntimeQueueRecord[];
}

export interface ExternalRuntimeQueueStore {
  load(): ExternalRuntimeQueueSnapshot | undefined | Promise<ExternalRuntimeQueueSnapshot | undefined>;
  save(snapshot: ExternalRuntimeQueueSnapshot): void | Promise<void>;
}
