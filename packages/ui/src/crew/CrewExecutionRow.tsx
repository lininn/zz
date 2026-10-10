import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import type { CrewExecution, CrewPermissionParams } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { avatarColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewRelayCard, type CrewRelayResponse } from "./CrewRelayCard.js";
import { crewPendingPlan } from "./crewRelayUi.js";
import { CrewExecutionDetails } from "./CrewExecutionDetails.js";
import { CrewPermissionRequest } from "./CrewPermissionRequest.js";
import { CrewStatus } from "./CrewStatus.js";
import { crewChatTimestamp, crewExecutionElapsed } from "./crewChatPresentation.js";

/**
 * 一次派工是一个「成员回合」：头像/名字按成员身份呈现，
 * 运行时产出作为该回合的正文，而不是无主的系统事件。
 */
export function CrewExecutionRow({
  visible = true,
  execution,
  showHeader = true,
  pending,
  onCancel,
  onRespondPermission,
  onRespondRelay,
  relayApprovalBlocked = false,
}: {
  visible?: boolean;
  onRespondRelay?: CrewRelayResponse;
  relayApprovalBlocked?: boolean;
  execution: CrewExecution;
  /** 同一成员连续派工时，只有该回合第一条画头像与名字。 */
  showHeader?: boolean;
  pending: boolean;
  onCancel: (executionId: string) => Promise<void>;
  onRespondPermission: (params: CrewPermissionParams & { conversationId: string }) => Promise<void>;
}) {
  const t = useCrewText();
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now);
  const live = execution.status === "queued" || execution.status === "running";
  // 待恢复不是终态；服务支持安全取消。取消权限不能与运行计时条件混用。
  const canCancel = live || execution.status === "recovery_required";
  useEffect(() => {
    if (!live || !visible) return;
    // 计时仅用于展示；运行状态始终来自服务投影，不用计时器推断完成或恢复。
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, visible]);
  const name = execution.memberSnapshot.name;
  const identityColor = avatarColor(execution.memberId);
  const timestamp = crewChatTimestamp(execution.createdAt);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <article
      className="flex min-w-0 gap-2.5"
      data-testid="crew-execution-row"
      data-sender={execution.memberId}
      data-execution-id={execution.executionId}
      data-execution-status={execution.status}
    >
      {showHeader ? (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ui-caption font-semibold"
          style={{ backgroundColor: `${identityColor}1f`, color: identityColor }}
          aria-hidden="true"
        >
          {Array.from(name)[0]}
        </div>
      ) : null}
      <div className="min-w-0 flex-1 space-y-2">
        {showHeader ? (
          <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 break-words text-ui-base font-medium text-foreground">
              {name}
            </span>
            {timestamp ? (
              <time
                className="shrink-0 text-ui-caption text-foreground-subtlest"
                data-crew-timestamp="true"
                dateTime={new Date(execution.createdAt).toISOString()}
              >
                {timestamp}
              </time>
            ) : null}
            {live ? (
              // 后端在运行中只上报状态，没有内容可给；这里如实表达「在跑」，不假装有流式输出。
              <span
                role="status"
                className="inline-flex shrink-0 items-center gap-1.5 text-ui-caption font-medium text-foreground-subtle"
                data-testid="crew-execution-working"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full"
                  style={{ backgroundColor: identityColor }}
                />
                {t("home.working")}
              </span>
            ) : null}
          </header>
        ) : null}
        <div className="min-w-0 rounded-2xl rounded-tl-sm border border-border/60 bg-surface/50">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-ui-caption">
            <CrewStatus status={execution.status} />
            <span className="text-foreground-subtle">
              {t(`runtime.${execution.memberSnapshot.runtime}`)}
            </span>
            <span
              className="inline-flex items-center gap-1 text-foreground-subtle"
              aria-label={t("home.elapsed")}
            >
              <Clock3 className="size-3 shrink-0" aria-hidden="true" />
              <span className="font-mono tabular-nums">{crewExecutionElapsed(execution, now)}</span>
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              {canCancel ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (!pending) void onCancel(execution.executionId);
                  }}
                >
                  {t("cancel")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-0.5 text-foreground-subtle"
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-label={t(expanded ? "home.hideExecution" : "home.showExecution", { name })}
                onClick={() => setExpanded((value) => !value)}
              >
                <Chevron className="size-3.5 shrink-0" aria-hidden="true" />
                {t(expanded ? "home.hideOutput" : "home.showOutput")}
              </Button>
            </div>
          </div>
          {expanded && visible ? (
            <div
              id={panelId}
              className={cn("min-w-0 border-t border-border/60")}
              role="region"
              aria-label={t("home.executionDetails", { name })}
            >
              <CrewExecutionDetails execution={execution} />
            </div>
          ) : null}
        </div>
        {execution.relay && !crewPendingPlan(execution) && (
          <CrewRelayCard
            execution={execution}
            pending={pending}
            approvalBlocked={relayApprovalBlocked}
            onRespond={onRespondRelay}
          />
        )}
        {execution.status === "running" && execution.permission && (
          <CrewPermissionRequest
            execution={execution}
            pending={pending}
            onRespond={onRespondPermission}
          />
        )}
      </div>
    </article>
  );
}
