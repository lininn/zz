import type { CrewGroupDetail, CrewResolvedMember } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { crewRuntimeAvailability } from "./crewExternalUi.js";
import { crewErrorKey } from "./crewErrors.js";

export function CrewRuntimeStatus({
  member,
  availability,
  variant = "full",
}: {
  member: CrewResolvedMember;
  availability?: CrewGroupDetail["runtimeAvailability"];
  /** compact：列表候选用的单行徽标，只表达可用性；full：卡片用的完整说明（含版本与失败原因）。 */
  variant?: "full" | "compact";
}) {
  const t = useCrewText();
  const probe = crewRuntimeAvailability(member, availability);
  // 已安装 binary 不等于已具备部署隔离；明确区分安全拒绝和旧协议，不能伪报可用。
  const reasonKey =
    probe.reason === "outer_isolation_missing"
      ? "home.runtimeIsolationMissing"
      : probe.reason?.startsWith("crew/runtime unavailable:") ||
          probe.reason === "external runtime facade unavailable"
        ? "home.runtimeBridgeUnavailable"
        : crewErrorKey(probe.reason);

  if (variant === "compact") {
    // ZCode 内置运行时恒可用，列表里不必再挂徽标，避免每行都出现无信息量的绿点。
    if (member.runtime === "zcode") {
      return null;
    }
    const reasonText = reasonKey !== "commandError" ? t(reasonKey) : probe.reason;
    return (
      <span
        role="status"
        aria-label={t("memberRuntime", { name: member.name })}
        // 徽标放不下失败原因，退化成 title；完整说明仍在卡片（full）里可见。
        title={probe.available ? undefined : reasonText}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-ui-xs font-medium",
          probe.available
            ? "bg-success/14 text-success"
            : "bg-destructive/12 text-destructive",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", probe.available ? "bg-success" : "bg-destructive")}
        />
        {t(probe.available ? "runtimeAvailable" : "runtimeUnavailableShort")}
      </span>
    );
  }

  return (
    <span
      role="status"
      aria-label={t("memberRuntime", { name: member.name })}
      className="mt-1 block break-words text-ui-caption font-normal text-muted-foreground"
    >
      <span>{t(`runtime.${member.runtime}`)}</span>
      {member.runtime !== "zcode" && (
        <>
          {probe.version && <span> · {t("runtimeVersion", { version: probe.version })}</span>}
          <span className={probe.available ? "ml-2" : "ml-2 text-destructive"}>
            {t(probe.available ? "runtimeAvailable" : "runtimeUnavailable")}
          </span>
          {!probe.available && (
            <span className="mt-1 block whitespace-pre-wrap">
              {reasonKey !== "commandError" ? t(reasonKey) : probe.reason || t("runtimeUnchecked")}
            </span>
          )}
        </>
      )}
    </span>
  );
}
