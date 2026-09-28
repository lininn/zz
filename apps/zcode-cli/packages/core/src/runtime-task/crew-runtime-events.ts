import {
  ExternalRuntimeEventEnvelopeSchema,
  type ExternalRuntimeEventEnvelope,
  type ExternalRuntimeQueueRecord,
  type ExternalRuntimeTaskRequest,
} from "@zcode/contracts";

/** 每个事件先校验当前 attempt，不能让异步旧流覆盖新的权限状态。 */
export function validateCrewRuntimeEvent(
  input: ExternalRuntimeEventEnvelope,
  request: ExternalRuntimeTaskRequest,
  sequence: number,
): ExternalRuntimeEventEnvelope {
  const event = ExternalRuntimeEventEnvelopeSchema.parse(input);
  if (
    event.taskId !== request.taskId ||
    event.attemptId !== request.attemptId ||
    event.runtimeId !== request.runtimeId ||
    event.sequence !== sequence
  ) {
    throw new Error("protocol_error: event does not belong to the current runtime attempt");
  }
  if (sequence === 1 && event.type !== "task.started")
    throw new Error("protocol_error: first event must be task.started");
  return event;
}

export function crewRuntimePermission(
  event: ExternalRuntimeEventEnvelope,
  canRespond: boolean,
): NonNullable<ExternalRuntimeQueueRecord["permission"]> {
  const payload =
    event.payload && typeof event.payload === "object"
      ? (event.payload as Record<string, unknown>)
      : {};
  const text = (value: unknown, fallback: string, limit: number) =>
    typeof value === "string" && value ? value.slice(0, limit) : fallback;
  return {
    requestId: text(payload.requestId ?? payload.request_id ?? payload.id, event.eventId, 128),
    toolName: text(payload.toolName ?? payload.tool_name, "external-runtime", 200),
    description: text(
      payload.description ?? payload.message,
      "External runtime requested permission",
      2000,
    ),
    canRespond,
  };
}
