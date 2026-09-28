import { useId } from "react";
import type { CrewExecution, CrewPermissionParams } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { crewPermissionParams } from "./crewExternalUi.js";

export function CrewPermissionRequest({
  execution,
  pending,
  onRespond,
}: {
  execution: CrewExecution;
  pending: boolean;
  onRespond: (params: CrewPermissionParams & { conversationId: string }) => Promise<void>;
}) {
  const t = useCrewText();
  const hintId = useId();
  const deny = crewPermissionParams(execution, false);
  const approve = crewPermissionParams(execution, true);
  const permission = execution.permission;
  if (!deny || !permission) return null;
  return (
    <section
      aria-label={t("permissionTitle", { name: execution.memberSnapshot.name })}
      className="w-full min-w-0 space-y-2 border-t border-border pt-3"
      data-testid="crew-permission"
    >
      <h5 className="break-words text-ui-base font-medium">
        {t("permissionTitle", { name: execution.memberSnapshot.name })}
      </h5>
      <p className="break-words text-ui-caption text-muted-foreground">
        {t(`runtime.${execution.memberSnapshot.runtime}`)} · {permission.toolName}
      </p>
      <p className="whitespace-pre-wrap break-words text-ui-caption">{permission.description}</p>
      <p id={hintId} className="text-ui-caption text-muted-foreground">
        {approve ? t("permissionDenyHint") : t("permissionUnsupported")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !approve}
          aria-describedby={hintId}
          onClick={() => {
            if (!pending && approve) void onRespond(approve);
          }}
        >
          {t("permissionApprove")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-describedby={hintId}
          onClick={() => {
            if (!pending) void onRespond(deny);
          }}
        >
          {t("permissionDeny")}
        </Button>
      </div>
    </section>
  );
}
