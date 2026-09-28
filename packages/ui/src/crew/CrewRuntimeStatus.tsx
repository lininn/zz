import type { CrewGroupDetail, CrewResolvedMember } from "@zcode/shared";
import { useCrewText } from "@/hooks/useCrewText.js";
import { crewRuntimeAvailability } from "./crewExternalUi.js";
import { crewErrorKey } from "./crewErrors.js";

export function CrewRuntimeStatus({
  member,
  availability,
}: {
  member: CrewResolvedMember;
  availability?: CrewGroupDetail["runtimeAvailability"];
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
