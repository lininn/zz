import type { CrewExecution, CrewRelayParams } from "@zcode/shared";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { crewErrorKey } from "./crewErrors.js";
import { crewPendingPlan } from "./crewRelayUi.js";

export type CrewRelayResponse = (
  params: CrewRelayParams & { conversationId: string },
) => Promise<void>;

export function CrewRelayCard({
  execution,
  pending,
  approvalBlocked = false,
  summary,
  onRespond,
}: {
  execution: CrewExecution;
  pending: boolean;
  approvalBlocked?: boolean;
  summary?: string;
  onRespond?: CrewRelayResponse;
}) {
  const t = useCrewText();
  const relay = execution.relay;
  if (!relay) return null;
  const plan = crewPendingPlan(execution);
  const waiting = relay.status === "awaiting_user_approval";
  const disabled = pending || !onRespond;
  const approveDisabled = disabled || approvalBlocked || execution.status !== "succeeded";
  const decide = (approved: boolean) => {
    if (!waiting || disabled || (approved && approveDisabled)) return;
    void onRespond?.({
      groupId: execution.groupId,
      conversationId: execution.conversationId,
      executionId: execution.executionId,
      approved,
    });
  };
  return (
    <section
      className={`min-w-0 space-y-2 rounded-xl border p-3 ${plan ? "border-interaction-confirmation-foreground/30 bg-interaction-confirmation-surface" : "border-border bg-surface"}`}
      data-testid={plan ? "crew-relay-plan" : "crew-relay-card"}
      data-execution-id={execution.executionId}
      data-relay-status={relay.status}
      aria-label={t(plan ? "relay.planTitle" : "relay.handoffTitle")}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 text-ui-caption">
        <span className="text-muted-foreground">{t("home.system")}</span>
        <h4 className="text-ui-base font-semibold">
          {t(plan ? "relay.planTitle" : "relay.handoffTitle")}
        </h4>
        <Badge variant="secondary">{t(`relay.status.${relay.status}`)}</Badge>
      </header>
      <p className="break-words text-ui-caption" data-testid="crew-relay-route">
        {t("relay.route", { from: execution.memberSnapshot.name, to: relay.to })}
        {relay.status === "dispatched" && relay.automatic && (
          <Badge className="ml-2" variant="secondary" data-testid="crew-relay-automatic">
            {t("relay.automatic")}
          </Badge>
        )}
      </p>
      {plan && summary && (
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-ui-base [overflow-wrap:anywhere]">
          {summary}
        </p>
      )}
      <dl className="min-w-0 space-y-1 text-ui-caption">
        <dt className="font-medium">{t("relay.objective")}</dt>
        <dd className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {relay.objective}
        </dd>
        {relay.context && (
          <>
            <dt className="font-medium">{t("relay.context")}</dt>
            <dd className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere]">
              {relay.context}
            </dd>
          </>
        )}
      </dl>
      {relay.reason && (
        <p
          role="status"
          className="text-ui-caption text-muted-foreground"
          data-testid="crew-relay-reason"
        >
          {t(crewErrorKey(`crew.${relay.reason}`))}
        </p>
      )}
      {waiting && (
        <div className="space-y-2">
          {approveDisabled && !pending && onRespond && (
            <p className="text-ui-caption text-muted-foreground">{t("relay.approvalBlocked")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={approveDisabled} onClick={() => decide(true)}>
              {t(plan ? "relay.approvePlan" : "relay.approve")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => decide(false)}
            >
              {t("relay.reject")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
