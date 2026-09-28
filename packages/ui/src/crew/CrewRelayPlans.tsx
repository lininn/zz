import type { CrewGroupDetail } from "@zcode/shared";
import { CrewRelayCard, type CrewRelayResponse } from "./CrewRelayCard.js";
import { crewPendingPlan, crewRelayApprovalBlocked, crewRelayDisplayText } from "./crewRelayUi.js";

export function CrewRelayPlans({
  detail,
  pending,
  onRespond,
}: {
  detail: CrewGroupDetail;
  pending: boolean;
  onRespond?: CrewRelayResponse;
}) {
  if (detail.conversation.groupId !== detail.group.groupId) return null;
  const plans = detail.executions.filter(
    (execution) =>
      execution.groupId === detail.group.groupId &&
      execution.conversationId === detail.conversation.conversationId &&
      crewPendingPlan(execution),
  );
  if (!plans.length) return null;
  return (
    <div
      className="max-h-[45vh] shrink-0 space-y-2 overflow-y-auto p-3"
      data-testid="crew-relay-plans"
    >
      {plans.map((execution) => {
        const reply = detail.messages.findLast(
          (message) =>
            message.groupId === execution.groupId &&
            message.conversationId === execution.conversationId &&
            message.epoch === execution.epoch &&
            message.sender === "member" &&
            message.executionId === execution.executionId,
        );
        return (
          <CrewRelayCard
            key={execution.executionId}
            execution={execution}
            pending={pending}
            approvalBlocked={crewRelayApprovalBlocked(detail, execution)}
            summary={reply ? crewRelayDisplayText(reply.text) : undefined}
            onRespond={onRespond}
          />
        );
      })}
    </div>
  );
}
