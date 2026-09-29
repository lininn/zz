import { z } from "zod";
import { zcodeWorkspaceRefSchema } from "./zcode-protocol-legacy-types.js";

/** Crew selects concrete registered adapter IDs; no fallback to the internal runtime. */
export const crewExternalRuntimeIdSchema = z.enum(["claude-cli", "codex-cli", "opencode-cli"]);
export const CREW_EXTERNAL_OBJECTIVE_MAX_CHARS = 8000;
/** 子任务超时上限与群预算上限一致（1440 分钟）；子任务不自设超时，一律采用群级预算。 */
export const CREW_EXTERNAL_TIMEOUT_MAX_MS = 86_400_000;
const id = z.string().min(1).max(128);
export const crewRuntimePermissionSchema = z
  .object({
    requestId: id,
    toolName: z.string().max(200),
    description: z.string().max(2000),
    canRespond: z.boolean(),
  })
  .strict();
export const crewRuntimeProbeSchema = z
  .object({
    runtimeId: crewExternalRuntimeIdSchema,
    available: z.boolean(),
    reason: z.string().max(2000).optional(),
    version: z.string().max(128).optional(),
  })
  .strict();
export const crewRuntimeTaskSchema = z
  .object({
    taskId: id,
    runtimeId: crewExternalRuntimeIdSchema,
    runtimeState: z.string().min(1).max(80),
    summary: z.string().max(64000).optional(),
    reason: z.string().max(2000).optional(),
    nativeSessionId: id.optional(),
    permission: crewRuntimePermissionSchema.optional(),
    /** True only after dispatch execution/process supervision has settled. */
    settled: z.boolean(),
  })
  .strict();
export const crewRuntimeCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("probe"),
      runtimeId: crewExternalRuntimeIdSchema,
      accessMode: z.enum(["read", "write"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("start"),
      taskId: id,
      runtimeId: crewExternalRuntimeIdSchema,
      sessionId: id,
      traceId: id,
      objective: z.string().min(1).max(CREW_EXTERNAL_OBJECTIVE_MAX_CHARS),
      accessMode: z.enum(["read", "write"]),
      resumeTaskId: id.optional(),
      /** 群级接力预算（毫秒）。子任务不再自设超时，一律由这里下发。 */
      timeoutMs: z.number().int().positive().max(CREW_EXTERNAL_TIMEOUT_MAX_MS).optional(),
    })
    .strict(),
  z.object({ action: z.literal("read"), taskId: id }).strict(),
  z.object({ action: z.literal("cancel"), taskId: id }).strict(),
  z
    .object({ action: z.literal("permission"), taskId: id, requestId: id, approved: z.boolean() })
    .strict(),
]);
export const crewRuntimeReplySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("probe"), probe: crewRuntimeProbeSchema }).strict(),
  z.object({ kind: z.literal("task"), task: crewRuntimeTaskSchema }).strict(),
]);
export type CrewRuntimeCommand = z.infer<typeof crewRuntimeCommandSchema>;
export type CrewRuntimeReply = z.infer<typeof crewRuntimeReplySchema>;
export type CrewRuntimeTask = z.infer<typeof crewRuntimeTaskSchema>;
export type CrewRuntimeProbe = z.infer<typeof crewRuntimeProbeSchema>;
export type CrewRuntimePermission = z.infer<typeof crewRuntimePermissionSchema>;
export type CrewExternalRuntimeId = z.infer<typeof crewExternalRuntimeIdSchema>;

export const crewRuntimeParamsSchema = z
  .object({ workspace: zcodeWorkspaceRefSchema, command: crewRuntimeCommandSchema })
  .strict();
export type CrewRuntimeParams = z.infer<typeof crewRuntimeParamsSchema>;
