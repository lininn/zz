import { isExternalRuntimePolicyViolationEvent } from "./process-host.js";
import {
  record,
  type VendorNativeEvent,
  type VendorTranslatedEvent,
} from "./vendor-cli-support.js";

export function translateCodexEvent(event: VendorNativeEvent): VendorTranslatedEvent[] {
  const item = record(event.item);
  const itemType = typeof item.type === "string" ? item.type : "";
  if (isExternalRuntimePolicyViolationEvent(event) || itemType === "collab_tool_call") {
    throw new Error("policy_violation: Codex attempted delegation");
  }
  const nativeSessionId = typeof event.thread_id === "string" ? event.thread_id : undefined;
  const wrap = (type: string, payload: unknown): VendorTranslatedEvent => ({
    type,
    payload,
    nativeSessionId,
  });
  if (event.type === "thread.started" || event.type === "turn.started") {
    return [wrap("task.state_changed", { runtimeState: "running" })];
  }
  if (event.type === "turn.completed") {
    return [
      {
        ...wrap("task.state_changed", { runtimeState: "needs_verification", usage: event.usage }),
        terminal: "succeeded",
      },
    ];
  }
  if (event.type === "turn.failed" || event.type === "error") {
    return [
      {
        ...wrap("error", { nativeType: event.type, error: event.error ?? event.message }),
        ...(event.type === "turn.failed" ? { terminal: "failed" as const } : {}),
        failure: "Codex runtime failed",
      },
    ];
  }
  // exec 当前没有权限回复接口；只归一化来报，绝不把该事件视为隐式批准。
  if (event.type === "permission.requested" || event.type === "permission_request") {
    return [wrap("permission.requested", { ...event, replySupported: false })];
  }
  if (
    event.type === "item.completed" &&
    itemType === "agent_message" &&
    typeof item.text === "string"
  ) {
    return [{ ...wrap("assistant.message", { text: item.text }), finalText: item.text }];
  }
  if (["item.started", "item.updated", "item.completed"].includes(event.type)) {
    if (["command_execution", "mcp_tool_call", "web_search"].includes(itemType)) {
      const type =
        event.type === "item.started"
          ? "tool.started"
          : event.type === "item.completed"
            ? "tool.completed"
            : "tool.progress";
      return [wrap(type, item)];
    }
    if (itemType === "file_change") return [wrap("workspace.changed", item)];
    if (itemType === "reasoning" || itemType === "todo_list") return [wrap("tool.progress", item)];
  }
  return [wrap("warning", { nativeType: event.type, itemType })];
}
