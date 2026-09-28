import { lazy, Suspense } from "react";
import type { CrewExecution } from "@zcode/shared";
import { useCrewText } from "@/hooks/useCrewText.js";
import { useCrewExecutionDetail } from "@/hooks/useCrewExecutionDetail.js";
import { useCrewTaskTimeline } from "@/hooks/useCrewTaskTimeline.js";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";

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
  return (
    <div className="space-y-3 p-3 text-ui-caption" data-testid="crew-external-detail">
      <Unavailable reason={data.unavailableReason ?? "externalEventsUnavailable"} />
      {data.runtimeTask && (
        <>
          <p>{t("home.runtimeState", { state: data.runtimeTask.runtimeState })}</p>
          {data.runtimeTask.reason && <p className="break-words">{data.runtimeTask.reason}</p>}
          {data.runtimeTask.summary && (
            <section aria-label={t("home.executionSummary")}>
              <h5 className="font-medium">{t("home.executionSummary")}</h5>
              <p className="whitespace-pre-wrap break-words">{data.runtimeTask.summary}</p>
            </section>
          )}
        </>
      )}
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
