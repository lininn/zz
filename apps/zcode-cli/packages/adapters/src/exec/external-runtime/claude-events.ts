import { z } from "zod";
import type { ExternalRuntimeTaskRequest } from "@zcode/contracts";
import { isExternalRuntimePolicyViolationEvent } from "./process-host.js";

export const CLAUDE_ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR"] as const;

export const CLAUDE_FORBIDDEN_TOOLS = new Set([
  "Agent",
  "Task",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "TaskStop",
  "Workflow",
  "REPL",
  "Monitor",
  "CronCreate",
  "CronDelete",
  "CronList",
  "RemoteTrigger",
]);

const CLAUDE_LEAF_EVENT_TYPES = new Set([
  "agent_started",
  "delegation_started",
  "spawn_agent",
  "subagent_started",
  "subagent_created",
  "slash_command",
]);

const CLAUDE_CONFIGURED_ARG_ARITY: Record<string, 0 | 1> = {
  "--verbose": 0,
  "--max-budget-usd": 1,
};

export const ClaudeFinalOutputSchema = z
  .object({
    summary: z.string().min(1),
    status: z.enum(["succeeded", "failed", "cancelled"]).optional(),
    artifacts: z.array(z.string()).default([]),
  })
  .strict();

export const ClaudeNativeEventSchema = z
  .object({
    type: z.string().min(1),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
  })
  .passthrough();
export type ClaudeNativeEvent = z.infer<typeof ClaudeNativeEventSchema>;

export type TranslatedClaudeEvent = {
  type: string;
  payload: unknown;
  nativeSessionId?: string;
};

export function validateClaudeConfiguredArgs(args: readonly string[] = []): string[] {
  const validated: string[] = [];
  for (let index = 0; index < args.length; ) {
    const flag = args[index]!;
    const arity = CLAUDE_CONFIGURED_ARG_ARITY[flag];
    if (arity === undefined) throw new Error(`Unsafe Claude configured argument: ${flag}`);
    validated.push(flag);
    index += 1;
    if (arity === 1) {
      const value = args[index];
      if (!value || value.startsWith("-") || value.includes(String.fromCharCode(0))) {
        throw new Error(`Invalid value for Claude configured argument: ${flag}`);
      }
      validated.push(value);
      index += 1;
    }
  }
  return validated;
}

export function claudeModelArgs(model: string | undefined): string[] {
  if (model === undefined || model.trim() === "") return [];
  const value = model.trim();
  if (value.startsWith("-") || value.includes(String.fromCharCode(0))) {
    throw new Error("Invalid Claude default model");
  }
  return ["--model", value];
}

export function buildClaudePrompt(request: ExternalRuntimeTaskRequest): string {
  return [
    request.objective,
    "",
    "Boundaries:",
    ...request.boundaries.map((boundary) => `- ${boundary}`),
    "- Remain a leaf worker. Do not delegate, start subagents, or invoke zcode, claude, or codex.",
    "",
    "Finish by describing what you did in plain text. JSON is OPTIONAL: if (and only if) you can emit it reliably, you may end with {\"summary\": \"...\", \"status\": \"succeeded\"|\"failed\", \"artifacts\": [...]}; otherwise plain prose is fine and will be used as-is.",
    "If another member should continue, mention them by name in your final reply (for example \"@设计师 …\"); that alone hands the task over.",
  ].join("\n");
}

function contentBlocks(event: ClaudeNativeEvent): Record<string, unknown>[] {
  const message = event.message;
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object")
    : [];
}

export function isClaudeLeafEvent(event: ClaudeNativeEvent): boolean {
  const type = event.type.toLowerCase();
  if (CLAUDE_LEAF_EVENT_TYPES.has(type)) return true;
  if (event.type === "assistant") {
    return contentBlocks(event).some(
      (block) =>
        block.type === "tool_use" && typeof block.name === "string" && CLAUDE_FORBIDDEN_TOOLS.has(block.name),
    );
  }
  return isExternalRuntimePolicyViolationEvent(event);
}

export function translateClaudeEvent(event: ClaudeNativeEvent): TranslatedClaudeEvent[] {
  const nativeSessionId = event.session_id;
  const wrap = (type: string, payload: unknown): TranslatedClaudeEvent => ({ type, payload, nativeSessionId });
  if (event.type === "system" && event.subtype === "init") {
    return [wrap("task.state_changed", { runtimeState: "running", model: event.model })];
  }
  if (event.type === "system" && (event.subtype === "hook_started" || event.subtype === "hook_response")) {
    return [wrap("tool.progress", event)];
  }
  if (event.type === "assistant") {
    return contentBlocks(event).flatMap((block) => {
      if (block.type === "text" && typeof block.text === "string") {
        return [wrap("assistant.message", { text: block.text })];
      }
      if (block.type === "tool_use") {
        return [wrap("tool.started", { toolUseId: block.id, name: block.name, input: block.input })];
      }
      return [];
    });
  }
  if (event.type === "user") {
    return contentBlocks(event).flatMap((block) =>
      block.type === "tool_result"
        ? [wrap("tool.completed", { toolUseId: block.tool_use_id, content: block.content, isError: block.is_error === true })]
        : [],
    );
  }
  if (event.type === "stream_event") {
    const record = (event.event ?? {}) as Record<string, unknown>;
    const delta = record.delta as Record<string, unknown> | undefined;
    if (record.type === "content_block_delta" && delta?.type === "text_delta") {
      return [wrap("assistant.delta", { text: delta.text })];
    }
    return [];
  }
  if (event.type === "permission_request") return [wrap("permission.requested", event)];
  if (event.type === "permission_response") return [wrap("permission.resolved", event)];
  if (event.type.startsWith("hook_")) return [wrap("tool.progress", event)];
  if (event.type === "error") return [wrap("error", event)];
  return [wrap("warning", { nativeType: event.type, raw: event })];
}
