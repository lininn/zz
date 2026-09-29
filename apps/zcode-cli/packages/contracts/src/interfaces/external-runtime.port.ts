// ============================================================
// External Runtime Port - vendor-neutral agent runtime boundary
// ============================================================

import { z } from "zod";
import type { SubagentTaskStatus } from "./subagent.port.js";

export const EXTERNAL_RUNTIME_SCHEMA_VERSION = 1 as const;

const externalRuntimeIdSchema = z.string().min(1).max(128);
const externalRuntimeTaskIdSchema = z.string().min(1).max(128);
const externalRuntimeTimestampSchema = z.string().datetime();

export const ExternalRuntimeIdSchema = externalRuntimeIdSchema;
export type ExternalRuntimeId = z.infer<typeof ExternalRuntimeIdSchema>;

export const EXTERNAL_RUNTIME_STATES = [
  "queued",
  "preflight",
  "running",
  "awaiting_permission",
  "needs_verification",
  "interrupted",
  "recovery_required",
  "runtime_unavailable",
  "protocol_error",
  "policy_violation",
  "apply_conflict",
  "workspace_unsupported",
  "waiting_for_integration",
  "stale_base",
  "merge_conflict",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const ExternalRuntimeStateSchema = z.enum(EXTERNAL_RUNTIME_STATES);
export type ExternalRuntimeState = z.infer<typeof ExternalRuntimeStateSchema>;

const TERMINAL_EXTERNAL_RUNTIME_STATES: readonly ExternalRuntimeState[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export function isTerminalExternalRuntimeState(state: ExternalRuntimeState): boolean {
  return TERMINAL_EXTERNAL_RUNTIME_STATES.includes(state);
}

export function mapExternalRuntimeStateToSubagentStatus(
  state: ExternalRuntimeState,
): SubagentTaskStatus {
  if (state === "succeeded") return "completed";
  if (state === "failed") return "failed";
  if (state === "cancelled") return "killed";
  return "running";
}

export const ExternalRuntimeRoleSchema = z.enum([
  "reviewer",
  "researcher",
  "explore",
  "executor",
  "debugger",
  "general",
]);
export type ExternalRuntimeRole = z.infer<typeof ExternalRuntimeRoleSchema>;

export const ExternalRuntimeAccessModeSchema = z.enum(["read", "write"]);
export type ExternalRuntimeAccessMode = z.infer<typeof ExternalRuntimeAccessModeSchema>;

export const ExternalRuntimeNetworkProfileSchema = z.enum(["allowed", "restricted", "disabled"]);
export type ExternalRuntimeNetworkProfile = z.infer<typeof ExternalRuntimeNetworkProfileSchema>;

export const ExternalRuntimeSessionModeSchema = z.enum(["one-shot", "chat"]);
export type ExternalRuntimeSessionMode = z.infer<typeof ExternalRuntimeSessionModeSchema>;

export const ExternalRuntimeExecutionModeSchema = z.enum(["sequential", "parallel"]);
export type ExternalRuntimeExecutionMode = z.infer<typeof ExternalRuntimeExecutionModeSchema>;

export const ExternalRuntimeFailoverPolicySchema = z.enum(["none", "read-only"]);
export type ExternalRuntimeFailoverPolicy = z.infer<typeof ExternalRuntimeFailoverPolicySchema>;

const READ_ONLY_RUNTIME_ROLES: readonly ExternalRuntimeRole[] = ["reviewer", "researcher", "explore"];

export const ExternalRuntimeTaskRequestSchema = z
  .object({
    schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
    taskId: externalRuntimeTaskIdSchema,
    attemptId: externalRuntimeTaskIdSchema,
    sessionId: z.string().min(1),
    traceId: z.string().min(1),
    runtimeId: ExternalRuntimeIdSchema,
    role: ExternalRuntimeRoleSchema,
    accessMode: ExternalRuntimeAccessModeSchema,
    networkProfile: ExternalRuntimeNetworkProfileSchema,
    objective: z.string().min(1).max(8000),
    boundaries: z.array(z.string().min(1).max(500)).max(32),
    workspace: z.object({
      identity: z.string().min(1),
      path: z.string().min(1),
      kind: z.enum(["git", "non-git"]),
      branch: z.string().min(1).max(256).optional(),
      isolated: z.boolean().optional(),
    }),
    baseline: z.object({
      kind: z.enum(["git", "non-git"]),
      ref: z.string().min(1),
    }),
    instructionSnapshotRef: z.string().min(1),
    // 上限与群级接力预算上限对齐（1440 分钟）；子任务超时由群预算下发。
    timeoutMs: z.number().int().positive().max(86_400_000),
    budget: z.object({
      wallTimeMs: z.number().int().positive().max(86_400_000),
      maxOutputBytes: z.number().int().positive().optional(),
      maxCostUsd: z.number().nonnegative().optional(),
    }),
    verification: z.object({
      commandIds: z.array(z.string().min(1)).max(16),
      skip: z.boolean().optional(),
    }),
    retention: z.object({
      structuredDays: z.number().int().nonnegative().max(3650),
      rawDays: z.number().int().nonnegative().max(3650),
      pinned: z.boolean().optional(),
    }),
    sessionMode: ExternalRuntimeSessionModeSchema,
    executionMode: ExternalRuntimeExecutionModeSchema.default("sequential"),
    resumeNativeSessionId: z.string().min(1).max(256).optional(),
    failoverPolicy: ExternalRuntimeFailoverPolicySchema,
  })
  .superRefine((request, context) => {
    if (request.accessMode === "write" && request.failoverPolicy !== "none") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failoverPolicy"],
        message: "write tasks cannot enable runtime failover",
      });
    }
    if (request.accessMode === "write" && READ_ONLY_RUNTIME_ROLES.includes(request.role)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessMode"],
        message: `${request.role} tasks must be read-only`,
      });
    }
  });
export type ExternalRuntimeTaskRequest = z.infer<typeof ExternalRuntimeTaskRequestSchema>;

export const ExternalRuntimeCapabilityReportSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  runtimeId: ExternalRuntimeIdSchema,
  available: z.boolean(),
  binaryPath: z.string().min(1).optional(),
  version: z.string().min(1).max(128).optional(),
  testedRange: z.string().min(1).max(128).optional(),
  testedVersion: z.boolean().default(false),
  authenticated: z.boolean(),
  capabilities: z.record(z.string(), z.boolean()),
  requiredCapabilities: z.array(z.string().min(1)).max(32),
  warnings: z.array(z.string().min(1).max(500)).default([]),
  probedAt: externalRuntimeTimestampSchema,
});
export type ExternalRuntimeCapabilityReport = z.infer<typeof ExternalRuntimeCapabilityReportSchema>;

export const KNOWN_EXTERNAL_RUNTIME_EVENT_TYPES = [
  "task.started",
  "task.state_changed",
  "assistant.delta",
  "assistant.message",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "permission.requested",
  "permission.resolved",
  "workspace.changed",
  "verification.recorded",
  "warning",
  "error",
  "task.completed",
] as const;
export type KnownExternalRuntimeEventType = (typeof KNOWN_EXTERNAL_RUNTIME_EVENT_TYPES)[number];

export function normalizeExternalRuntimeEventType(type: string): KnownExternalRuntimeEventType | "unknown" {
  return (KNOWN_EXTERNAL_RUNTIME_EVENT_TYPES as readonly string[]).includes(type)
    ? (type as KnownExternalRuntimeEventType)
    : "unknown";
}

export const ExternalRuntimeEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  eventId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  taskId: externalRuntimeTaskIdSchema,
  attemptId: externalRuntimeTaskIdSchema,
  runtimeId: ExternalRuntimeIdSchema,
  nativeSessionId: z.string().min(1).max(256).optional(),
  timestamp: externalRuntimeTimestampSchema,
  type: z.string().min(1).max(128),
  payload: z.unknown(),
  rawRef: z.string().min(1).max(512).optional(),
});
export type ExternalRuntimeEventEnvelope = z.infer<typeof ExternalRuntimeEventEnvelopeSchema>;

export function validateExternalRuntimeEventSequence(
  input: readonly unknown[],
): ExternalRuntimeEventEnvelope[] {
  const events = input.map((event) => ExternalRuntimeEventEnvelopeSchema.parse(event));
  if (events.length === 0 || events[0]?.type !== "task.started") {
    throw new Error("runtime event sequence must begin with task.started");
  }
  if (events[0].sequence !== 1) {
    throw new Error("runtime event sequence must begin at sequence 1");
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]?.sequence !== (events[index - 1]?.sequence ?? 0) + 1) {
      throw new Error("runtime event sequence must be contiguous and monotonic");
    }
    if (
      events[index]?.taskId !== events[0]?.taskId ||
      events[index]?.attemptId !== events[0]?.attemptId
    ) {
      throw new Error("runtime event sequence cannot cross task attempts");
    }
  }
  const terminal = events.find((event) => event.type === "task.completed");
  if (!terminal) throw new Error("runtime event sequence is missing task.completed");
  ExternalRuntimeResultSchema.parse(terminal.payload);
  if (terminal !== events.at(-1)) {
    throw new Error("task.completed must be the final runtime event");
  }
  return events;
}

const ExternalRuntimeResultBaseSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  taskId: externalRuntimeTaskIdSchema,
  attemptId: externalRuntimeTaskIdSchema,
  runtimeId: ExternalRuntimeIdSchema,
  status: z.enum(["succeeded", "failed", "cancelled"]),
  runtimeState: ExternalRuntimeStateSchema,
  summary: z.string().min(1).max(8000),
  completedAt: externalRuntimeTimestampSchema,
  nativeSessionId: z.string().min(1).max(256).optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  artifacts: z.array(z.string().min(1).max(512)).default([]),
  unverified: z.boolean().optional(),
});

export const ExternalRuntimeResultSchema = ExternalRuntimeResultBaseSchema.superRefine(
  (result, context) => {
    if (!isTerminalExternalRuntimeState(result.runtimeState) || result.status !== result.runtimeState) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtimeState"],
        message: "terminal result status must match runtimeState",
      });
    }
  },
);
export type ExternalRuntimeResult = z.infer<typeof ExternalRuntimeResultSchema>;

export const ExternalRuntimeVerificationRecordSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  verificationId: z.string().min(1).max(128),
  taskId: externalRuntimeTaskIdSchema,
  attemptId: externalRuntimeTaskIdSchema,
  commandId: z.string().min(1).max(128),
  command: z.array(z.string().min(1).max(512)).min(1).max(32),
  exitCode: z.number().int().nullable(),
  signal: z.string().min(1).max(64).nullable().optional(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["passed", "failed", "timed_out", "skipped"]),
  recordedAt: externalRuntimeTimestampSchema,
  outputRef: z.string().min(1).max(512).optional(),
});
export type ExternalRuntimeVerificationRecord = z.infer<typeof ExternalRuntimeVerificationRecordSchema>;

export const ExternalRuntimeHandoffRecordSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  handoffId: z.string().min(1).max(128),
  taskId: externalRuntimeTaskIdSchema,
  attemptId: externalRuntimeTaskIdSchema,
  summary: z.string().min(1).max(8000),
  resultRef: z.string().min(1).max(512),
  diffRef: z.string().min(1).max(512).optional(),
  verificationRefs: z.array(z.string().min(1).max(512)).max(16),
  artifactRefs: z.array(z.string().min(1).max(512)).default([]),
  createdAt: externalRuntimeTimestampSchema,
});
export type ExternalRuntimeHandoffRecord = z.infer<typeof ExternalRuntimeHandoffRecordSchema>;

export const ExternalRuntimeReviewRecordSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  reviewId: z.string().min(1).max(128),
  taskId: externalRuntimeTaskIdSchema,
  attemptId: externalRuntimeTaskIdSchema,
  verdict: z.enum(["approved", "changes_requested", "commented"]),
  findings: z.array(z.record(z.string(), z.unknown())).max(64),
  createdAt: externalRuntimeTimestampSchema,
});
export type ExternalRuntimeReviewRecord = z.infer<typeof ExternalRuntimeReviewRecordSchema>;

export const ExternalRuntimeRecoveryRecordSchema = z.object({
  schemaVersion: z.literal(EXTERNAL_RUNTIME_SCHEMA_VERSION),
  recoveryId: z.string().min(1).max(128),
  taskId: externalRuntimeTaskIdSchema,
  attemptId: externalRuntimeTaskIdSchema,
  previousAttemptId: externalRuntimeTaskIdSchema.optional(),
  runtimeState: z.literal("recovery_required"),
  observedWorkspace: z.record(z.string(), z.unknown()),
  process: z.record(z.string(), z.unknown()).optional(),
  createdAt: externalRuntimeTimestampSchema,
});
export type ExternalRuntimeRecoveryRecord = z.infer<typeof ExternalRuntimeRecoveryRecordSchema>;

export interface ExternalRuntimeHandle {
  taskId: string;
  attemptId: string;
  runtimeId: string;
  pid?: number;
  nativeSessionId?: string;
}

export interface ExternalRuntimeProbeContext {
  runtimeId: string;
  requiredCapabilities: string[];
}

export interface ExternalRuntimePort {
  probe(context: ExternalRuntimeProbeContext): Promise<ExternalRuntimeCapabilityReport>;
  /** Normal completion and protocol/policy errors require awaited process cleanup.
   * If cleanup cannot be proven, throw `recovery_required: ...` instead. */
  start(request: ExternalRuntimeTaskRequest): AsyncIterable<ExternalRuntimeEventEnvelope>;
  interrupt(handle: ExternalRuntimeHandle): Promise<void>;
  cancel(handle: ExternalRuntimeHandle): Promise<void>;
  /** Only implement when the vendor exposes a verified live permission reply channel. */
  respondPermission?(handle: ExternalRuntimeHandle, input: { requestId: string; approved: boolean }): Promise<void>;
}
