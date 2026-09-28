import type { CrewExecution, CrewGroup, CrewGroupDetail } from "@zcode/shared";

export function crewRelaySettings(group?: CrewGroup) {
  return {
    relayMode: group?.relayMode ?? "manual",
    relayAutoHops: group?.relayAutoHops ?? 2,
    relayBudgetMinutes: group?.relayBudgetMinutes ?? 30,
    relayPaused: group?.relayPaused ?? false,
  };
}

export function crewPendingPlan(execution: CrewExecution): boolean {
  // 根规划者必须先审批；后续交回同一成员不应再次冒充根计划。
  return (
    (execution.hop ?? 0) === 0 &&
    execution.relay?.kind === "plan" &&
    execution.relay.status === "awaiting_user_approval"
  );
}

export function crewRelayApprovalBlocked(detail: CrewGroupDetail, execution: CrewExecution) {
  return (
    detail.group.relayPaused === true ||
    detail.conversation.status === "recovery_required" ||
    // 群级 recovery 是跨会话汇总，不能阻断其他正常会话的接力审批。
    detail.executions.some(
      (item) =>
        item.groupId === detail.group.groupId &&
        item.conversationId === detail.conversation.conversationId &&
        item.status === "recovery_required",
    ) ||
    execution.epoch !== detail.group.epoch
  );
}

/** 仅清理成员回复展示；不读取 JSON、不生成目标、更不发起派工。 */
export function crewRelayDisplayText(text: string): string {
  return text.replace(/<crew-handoff>[\s\S]*?<\/crew-handoff>/g, "").trim();
}
