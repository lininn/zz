import { lazy, Suspense, useState } from "react";
import type { CrewExecution, CrewExecutionDetail } from "@zcode/shared";
import { useCrewText } from "@/hooks/useCrewText.js";
import { useCrewExecutionDetail } from "@/hooks/useCrewExecutionDetail.js";
import { useCrewTaskTimeline } from "@/hooks/useCrewTaskTimeline.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { crewReplyPreview } from "./crewChatPresentation.js";

const Timeline = lazy(() =>
  import("@/v4/ConversationShareReadonlyTimeline.js").then((module) => ({
    default: module.ConversationShareReadonlyTimeline,
  })),
);

export function CrewExecutionDetails({ execution }: { execution: CrewExecution }) {
  const t = useCrewText();
  const { data, error, isLoading, mutate } = useCrewExecutionDetail(execution);
  if (isLoading)
    return (
      <p role="status" className="p-3 text-ui-caption">
        {t("home.loading")}
      </p>
    );
  if (error || !data)
    return (
      <div className="p-3 text-ui-caption">
        <Unavailable reason="runtimeReadFailed" />
        <Button variant="ghost" size="sm" onClick={() => void mutate()}>
          {t("refresh")}
        </Button>
      </div>
    );
  if (data.execution.memberSnapshot.runtime === "zcode" && data.execution.taskId)
    return <CrewV4Execution key={data.execution.taskId} execution={data.execution} />;
  return <CrewExternalExecution detail={data} />;
}

/**
 * 外部运行时（Codex / Claude CLI）的产出。
 * 后端只在 task.completed 里给内容，所以这里能展示的是**已完成**的产出；
 * 运行中由上游回合头表达「工作中」，不会走到这里。
 */
function CrewExternalExecution({ detail }: { detail: CrewExecutionDetail }) {
  const t = useCrewText();
  const [expanded, setExpanded] = useState(false);
  const task = detail.runtimeTask;
  // 失败时 reason 才是用户要看的那句话；有 summary 时它优先。
  const output = task?.summary?.trim() || task?.reason?.trim() || "";
  const preview = crewReplyPreview(output);
  const reason = detail.unavailableReason ?? "externalEventsUnavailable";
  return (
    <div className="space-y-2 p-3" data-testid="crew-external-detail">
      {output ? (
        // 产出在前：这是该成员这一轮的正文，不该被「过程不可用」的说明盖住。
        <>
          <p
            className="whitespace-pre-wrap break-words text-ui-base [overflow-wrap:anywhere]"
            data-testid="crew-external-output"
          >
            {preview !== null && !expanded ? preview : output}
          </p>
          {preview !== null ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto px-1 py-1 text-ui-caption text-foreground-subtle"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {t(expanded ? "home.collapseReply" : "home.expandReply")}
            </Button>
          ) : null}
        </>
      ) : null}
      {/* 诚实说明放在产出之后：外部运行时确实不导出逐步事件。 */}
      <p role="status" className="text-ui-caption text-foreground-subtle">
        {t("home.detailsUnavailable", { reason: t(`home.reason.${reason}`) })}
      </p>
      {task?.runtimeState ? (
        <p className="text-ui-caption text-foreground-subtle">
          {t("home.runtimeState", { state: task.runtimeState })}
        </p>
      ) : null}
    </div>
  );
}

function Unavailable({ reason }: { reason: string }) {
  const t = useCrewText();
  return (
    <p role="status">{t("home.detailsUnavailable", { reason: t(`home.reason.${reason}`) })}</p>
  );
}

function CrewV4Execution({ execution }: { execution: CrewExecution }) {
  const binding = execution.workspaceBinding;
  const resolution = useWorkspaceServicesResolution(
    binding.workspacePath,
    binding.remoteSessionId,
    binding.workspaceIdentity,
  );
  if (!resolution.rpcReady) return <Unavailable reason="workspaceDisconnected" />;
  return <CrewV4Timeline execution={execution} />;
}

function CrewV4Timeline({ execution }: { execution: CrewExecution }) {
  const t = useCrewText();
  const { locale } = useZCodeIntl();
  const { snapshot, refresh } = useCrewTaskTimeline(execution);
  if (!snapshot)
    return (
      <div className="p-3 text-ui-caption">
        <Unavailable reason="passiveTimelineUnavailable" />
        <Button variant="ghost" size="sm" onClick={refresh}>
          {t("refresh")}
        </Button>
      </div>
    );
  if (!snapshot.rows.window.length) return <Unavailable reason="emptyTimeline" />;
  const partial =
    snapshot.rows.firstRowId !== null && snapshot.rows.window[0]!.rowId > snapshot.rows.firstRowId;
  return (
    <div className="max-h-[60vh] overflow-y-auto overscroll-contain" data-testid="crew-v4-detail">
      {partial && (
        <p role="status" className="p-3 text-ui-caption text-muted-foreground">
          {t("home.partialTimeline")}
        </p>
      )}
      <Suspense fallback={<p role="status">{t("home.loading")}</p>}>
        <Timeline rows={snapshot.rows.window} locale={locale} />
      </Suspense>
    </div>
  );
}
