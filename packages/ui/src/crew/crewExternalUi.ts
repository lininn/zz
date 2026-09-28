import type {
  CrewExecution,
  CrewGroupDetail,
  CrewResolvedMember,
  CrewPermissionParams,
  CrewRuntimeProbe,
} from "@zcode/shared";

/** 同一 CLI 的成员也可能权限不同；缺少当前成员/运行时的探测不能当作可用。 */
export function crewRuntimeAvailability(
  member: CrewResolvedMember,
  probes?: CrewGroupDetail["runtimeAvailability"],
): Pick<CrewRuntimeProbe, "available" | "reason" | "version"> {
  if (member.runtime === "zcode") return { available: true };
  return (
    probes?.find(
      (probe) => probe.memberId === member.memberId && probe.runtimeId === member.runtime,
    ) ?? { available: false }
  );
}

/** 只回应当前运行中的请求；不支持批准时仍允许拒绝，由服务确认安全取消。 */
export function crewPermissionParams(
  execution: CrewExecution,
  approved: boolean,
): (CrewPermissionParams & { conversationId: string }) | null {
  const { permission } = execution;
  if (
    execution.status !== "running" ||
    !execution.taskId ||
    !permission ||
    (approved && !permission.canRespond)
  )
    return null;
  return {
    groupId: execution.groupId,
    conversationId: execution.conversationId,
    executionId: execution.executionId,
    requestId: permission.requestId,
    approved,
  };
}
