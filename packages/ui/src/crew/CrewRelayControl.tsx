import type { CrewGroup, CrewUpdateParams } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { crewRelaySettings } from "./crewRelayUi.js";

export function CrewRelayControl({
  group,
  pending,
  onUpdate,
}: {
  group: CrewGroup;
  pending: boolean;
  onUpdate: (params: CrewUpdateParams) => Promise<void>;
}) {
  const t = useCrewText();
  const settings = crewRelaySettings(group);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2 text-ui-caption"
      data-testid="crew-relay-control"
    >
      <p className="min-w-0 flex-1 text-muted-foreground">
        {t("relay.summary", {
          mode: t(`relay.mode.${settings.relayMode}`),
          minutes: settings.relayBudgetMinutes,
        })}
        {settings.relayMode === "semi" &&
          ` · ${t("relay.hopsSummary", { hops: settings.relayAutoHops })}`}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-pressed={settings.relayPaused}
        onClick={() => {
          // busy 期间仍允许停止下一跳；恢复只改开关，绝不代替用户处理待审批记录。
          if (!pending)
            void onUpdate({ groupId: group.groupId, relayPaused: !settings.relayPaused });
        }}
      >
        {t(settings.relayPaused ? "relay.resume" : "relay.pause")}
      </Button>
      {settings.relayPaused && (
        <p role="status" className="w-full text-muted-foreground">
          {t("relay.pausedHint")}
        </p>
      )}
    </div>
  );
}
