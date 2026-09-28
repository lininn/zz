import { useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import type { CrewExecution, CrewPermissionParams } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { avatarColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewRelayCard, type CrewRelayResponse } from "./CrewRelayCard.js";
import { crewPendingPlan } from "./crewRelayUi.js";
import { CrewExecutionDetails } from "./CrewExecutionDetails.js";
import { CrewPermissionRequest } from "./CrewPermissionRequest.js";
import { CrewStatus } from "./CrewStatus.js";
import { crewExecutionElapsed } from "./crewChatPresentation.js";

export function CrewExecutionRow({
  visible = true,
  execution,
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
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <article
      className="min-w-0 rounded-xl border border-border bg-surface"
      data-testid="crew-execution-row"
      data-sender="system"
      data-execution-id={execution.executionId}
    >
      <div className="flex min-w-0 items-center gap-1 p-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg p-2 text-left text-ui-caption hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={t(expanded ? "home.hideExecution" : "home.showExecution", { name })}
          onClick={() => setExpanded((value) => !value)}
        >
          <Chevron className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: avatarColor(execution.memberId) }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{t("home.system")}</span>
          <span className="min-w-0 break-words font-medium">{name}</span>
          <CrewStatus status={execution.status} />
          <span className="text-muted-foreground">
            {t(`runtime.${execution.memberSnapshot.runtime}`)}
          </span>
          <span
            className="inline-flex items-center gap-1 text-muted-foreground"
            aria-label={t("home.elapsed")}
          >
            <Clock3 className="size-3 shrink-0" aria-hidden="true" />
            <span className="font-mono tabular-nums">{crewExecutionElapsed(execution, now)}</span>
          </span>
        </button>
        {canCancel && (
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
        )}
      </div>
      {expanded && visible && (
        <div
          id={panelId}
          className="min-w-0 border-t border-border p-3"
          role="region"
          aria-label={t("home.executionDetails", { name })}
        >
          <CrewExecutionDetails execution={execution} />
        </div>
      )}
      {execution.relay && !crewPendingPlan(execution) && (
        <div className="px-3 pb-3">
          <CrewRelayCard
            execution={execution}
            pending={pending}
            approvalBlocked={relayApprovalBlocked}
            onRespond={onRespondRelay}
          />
        </div>
      )}
      {execution.status === "running" && execution.permission && (
        <div className="px-3 pb-3">
          <CrewPermissionRequest
            execution={execution}
            pending={pending}
            onRespond={onRespondPermission}
          />
        </div>
      )}
    </article>
  );
}
