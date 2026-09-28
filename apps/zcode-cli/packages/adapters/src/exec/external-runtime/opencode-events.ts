import { isExternalRuntimePolicyViolationEvent } from "./process-host.js";
import {
  record,
  type VendorNativeEvent,
  type VendorTranslatedEvent,
} from "./vendor-cli-support.js";

export function translateOpenCodeEvent(event: VendorNativeEvent): VendorTranslatedEvent[] {
  const part = record(event.part);
  if (
    isExternalRuntimePolicyViolationEvent(event) ||
    (event.type === "tool_use" && part.tool === "task")
  ) {
    throw new Error("policy_violation: OpenCode attempted delegation");
  }
  const nativeSessionId = typeof event.sessionID === "string" ? event.sessionID : undefined;
  const wrap = (type: string, payload: unknown): VendorTranslatedEvent => ({
    type,
    payload,
    nativeSessionId,
  });
  if (event.type === "step_start") return [wrap("task.state_changed", { runtimeState: "running" })];
  if (event.type === "text" && typeof part.text === "string") {
    return [{ ...wrap("assistant.message", { text: part.text }), finalText: part.text }];
  }
  if (event.type === "tool_use") {
    const state = record(part.state);
    const type =
      state.status === "completed" || state.status === "error" ? "tool.completed" : "tool.started";
    return [wrap(type, { toolUseId: part.callID, name: part.tool, ...state })];
  }
  if (event.type === "step_finish") {
    if (part.reason === "stop") {
      return [
        {
          ...wrap("task.state_changed", { runtimeState: "needs_verification" }),
          terminal: "succeeded",
        },
      ];
    }
    if (part.reason === "tool-calls") return [wrap("tool.progress", part)];
    return [wrap("warning", { nativeType: event.type, reason: part.reason })];
  }
  if (["permission.asked", "permission.requested", "permission_request"].includes(event.type)) {
    return [
      wrap("permission.requested", {
        ...record(event.properties),
        ...event,
        replySupported: false,
      }),
    ];
  }
  if (event.type === "error") {
    return [
      { ...wrap("error", event.error), terminal: "failed", failure: "OpenCode runtime failed" },
    ];
  }
  return [wrap("warning", { nativeType: event.type })];
}
