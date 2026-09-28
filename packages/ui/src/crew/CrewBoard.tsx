import type { CrewGroupDetail, CrewPermissionParams } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewRelayPlans } from "./CrewRelayPlans.js";
import { CrewRelayCard, type CrewRelayResponse } from "./CrewRelayCard.js";
import { crewPendingPlan, crewRelayApprovalBlocked, crewRelayDisplayText } from "./crewRelayUi.js";
import { CrewStatus } from "./CrewStatus.js";
import { CrewRuntimeStatus } from "./CrewRuntimeStatus.js";
import { CrewPermissionRequest } from "./CrewPermissionRequest.js";
import { crewIsRelayDispatch } from "./crewChatPresentation.js";
import { crewErrorKey } from "./crewErrors.js";

export function CrewBoard({
  detail,
  pending,
  onCancel,
  onRespondPermission,
  onRespondRelay,
}: {
  detail: CrewGroupDetail;
  onRespondRelay?: CrewRelayResponse;
  pending: boolean;
  onCancel: (executionId: string) => Promise<void>;
  onRespondPermission: (params: CrewPermissionParams & { conversationId: string }) => Promise<void>;
}) {
  const t = useCrewText();
  const { resolvedMembers, conversation } = detail;
  // 只展示当前会话的记录，防止旧投影/异常数据把别的会话审批入口带入当前群板。
  const belongs = (record: { groupId: string; conversationId: string }) =>
    record.groupId === detail.group.groupId &&
    record.conversationId === conversation.conversationId;
  const messages = detail.messages.filter(belongs);
  const executions = detail.executions.filter(belongs);
  const memberName = (memberId: string | null) =>
    resolvedMembers.find((member) => member.memberId === memberId)?.name ?? t("formerMember");
  return (
    <div className="space-y-5">
      <CrewRelayPlans detail={detail} pending={pending} onRespond={onRespondRelay} />
      <section className="space-y-3" aria-label={t("members")}>
        <h4 className="text-ui-base font-medium">{t("members")}</h4>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {resolvedMembers.map((member) => (
            <details
              key={member.memberId}
              className="min-w-0 rounded-xl border border-border bg-card p-3"
            >
              <summary className="cursor-pointer break-words text-ui-base font-medium">
                {member.name}
                <span className="ml-2 text-ui-caption font-normal text-muted-foreground">
                  {t(`access.${member.accessMode}`)}
                </span>
                <CrewRuntimeStatus member={member} availability={detail.runtimeAvailability} />
              </summary>
              <p className="mt-1 break-all text-ui-caption text-muted-foreground">
                {t("configVersion", { version: member.configVersion })}
              </p>
            </details>
          ))}
        </div>
      </section>
      <section className="space-y-3" aria-label={t("board")}>
        <h4 className="text-ui-base font-medium">{t("board")}</h4>
        <div
          role="log"
          aria-label={t("board")}
          aria-live="polite"
          className="max-h-96 space-y-3 overflow-y-auto"
        >
          {messages.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-ui-caption text-muted-foreground">
              {t("emptyBoard")}
            </p>
          )}
          {messages.map((message) => {
            const execution = executions.find(
              (candidate) => candidate.executionId === message.executionId,
            );
            return (
              <article
                key={message.messageId}
                className="space-y-2 rounded-xl border border-border bg-card p-4"
              >
                <header className="flex flex-wrap items-center gap-2 text-ui-caption">
                  <span className="break-words font-medium">
                    {message.sender === "user"
                      ? t(crewIsRelayDispatch(message, executions) ? "home.system" : "you")
                      : (execution?.memberSnapshot.name ?? memberName(message.memberId))}
                  </span>
                  {message.mentions.map((memberId) => (
                    <span key={memberId} className="break-words text-muted-foreground">
                      @{memberName(memberId)}
                    </span>
                  ))}
                  <span className="ml-auto text-muted-foreground">
                    {t("epoch", { epoch: message.epoch })}
                  </span>
                </header>
                <p className="whitespace-pre-wrap break-words text-ui-base">
                  {message.sender === "member" &&
                  execution &&
                  execution.status !== "succeeded" &&
                  crewErrorKey(message.text) !== "commandError"
                    ? t(crewErrorKey(message.text))
                    : message.sender === "member"
                      ? crewRelayDisplayText(message.text)
                      : message.text}
                </p>
              </article>
            );
          })}
        </div>
      </section>
      {executions.length > 0 && (
        <section className="space-y-3" aria-label={t("executions")}>
          <h4 className="text-ui-base font-medium">{t("executions")}</h4>
          <ul className="space-y-2">
            {executions.map((execution) => (
              <li
                key={execution.executionId}
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-ui-base font-medium">
                    {execution.memberSnapshot.name}
                  </p>
                  <p className="break-all font-mono text-ui-xs text-muted-foreground">
                    {execution.executionId}
                  </p>
                  {execution.status === "recovery_required" && !execution.taskId && (
                    <p className="mt-1 text-ui-caption text-muted-foreground">
                      {t("missingTaskHint")}
                    </p>
                  )}
                </div>
                <CrewStatus status={execution.status} />
                {execution.relay && !crewPendingPlan(execution) && (
                  <div className="w-full">
                    <CrewRelayCard
                      execution={execution}
                      pending={pending}
                      approvalBlocked={crewRelayApprovalBlocked(detail, execution)}
                      onRespond={onRespondRelay}
                    />
                  </div>
                )}
                {["queued", "running", "recovery_required"].includes(execution.status) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => void onCancel(execution.executionId)}
                  >
                    {t("cancelExecution")}
                  </Button>
                )}
                <CrewPermissionRequest
                  execution={execution}
                  pending={pending}
                  onRespond={onRespondPermission}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
