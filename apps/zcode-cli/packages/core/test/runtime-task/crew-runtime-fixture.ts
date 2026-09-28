import type {
  ExternalRuntimeEventEnvelope,
  ExternalRuntimePort,
  ExternalRuntimeQueueSnapshot,
  ExternalRuntimeTaskRequest,
} from "@zcode/contracts";
import { ExternalRuntimeDispatchService } from "../../src/runtime-task/external-runtime-service.js";

export const timestamp = "2026-09-24T00:00:00.000Z";
export function request(
  overrides: Partial<ExternalRuntimeTaskRequest> = {},
): ExternalRuntimeTaskRequest {
  return {
    schemaVersion: 1,
    taskId: "crew_ext_1",
    attemptId: "attempt-1",
    sessionId: "crew_group_member",
    traceId: "trace-1",
    runtimeId: "claude-cli",
    role: "reviewer",
    accessMode: "read",
    networkProfile: "restricted",
    objective: "Review fixture",
    boundaries: ["stay in workspace"],
    workspace: { identity: "workspace-1", path: "/workspace", kind: "git" },
    baseline: { kind: "git", ref: "HEAD" },
    instructionSnapshotRef: "fixture",
    timeoutMs: 60000,
    budget: { wallTimeMs: 60000 },
    verification: { commandIds: [] },
    retention: { structuredDays: 1, rawDays: 1 },
    sessionMode: "one-shot",
    executionMode: "sequential",
    failoverPolicy: "none",
    ...overrides,
  };
}
export function event(
  req: ExternalRuntimeTaskRequest,
  sequence: number,
  type: string,
  payload: unknown = {},
): ExternalRuntimeEventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    taskId: req.taskId,
    attemptId: req.attemptId,
    runtimeId: req.runtimeId,
    timestamp,
    type,
    payload,
  };
}
export function terminal(
  req: ExternalRuntimeTaskRequest,
  sequence: number,
  status: "succeeded" | "failed" | "cancelled" = "succeeded",
) {
  return event(req, sequence, "task.completed", {
    schemaVersion: 1,
    taskId: req.taskId,
    attemptId: req.attemptId,
    runtimeId: req.runtimeId,
    status,
    runtimeState: status,
    summary: "structured fixture summary",
    nativeSessionId: "native-1",
    completedAt: timestamp,
    artifacts: [],
  });
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export function fixture(
  script: (req: ExternalRuntimeTaskRequest) => AsyncIterable<ExternalRuntimeEventEnvelope>,
) {
  let saved: ExternalRuntimeQueueSnapshot | undefined;
  const store = {
    load: () => saved,
    save: (snapshot: ExternalRuntimeQueueSnapshot) => {
      saved = structuredClone(snapshot);
    },
  };
  const starts: ExternalRuntimeTaskRequest[] = [];
  const adapter: ExternalRuntimePort = {
    async probe() {
      return {
        schemaVersion: 1,
        runtimeId: "claude-cli",
        available: true,
        authenticated: true,
        testedVersion: true,
        capabilities: {
          structuredOutput: true,
          structuredTerminalResult: true,
          permissionMode: true,
        },
        requiredCapabilities: [],
        warnings: [],
        probedAt: timestamp,
      };
    },
    async *start(req) {
      starts.push(req);
      yield* script(req);
    },
    async cancel() {},
    async interrupt() {},
  };
  const options = {
    adapters: new Map([["claude-cli", adapter]]),
    store,
    outerSandboxReady: true,
    allowDirtyWorkspace: false,
    beginWorkspaceGuard: async () => ({
      isClean: async () => true,
      detectChanges: async () => ({ changed: true, conflict: false }),
    }),
    resolveVerificationCommands: () => [],
    runVerification: async () => ({ status: "passed" as const }),
  };
  return { adapter, starts, store, options, service: new ExternalRuntimeDispatchService(options) };
}
