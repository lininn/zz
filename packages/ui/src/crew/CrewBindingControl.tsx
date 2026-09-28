import { useState } from "react";
import type { CrewGroup, CrewWorkspaceBinding } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewWorkspaceField } from "./CrewWorkspaceField.js";

export function CrewBindingControl({
  group,
  locked,
  pending,
  onBind,
}: {
  group: CrewGroup;
  locked: boolean;
  pending: boolean;
  onBind: (binding: CrewWorkspaceBinding) => Promise<void>;
}) {
  const t = useCrewText();
  const [selected, setSelected] = useState<CrewWorkspaceBinding | null>(group.workspaceBinding);
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      data-testid="crew-binding"
    >
      <p className="text-ui-caption text-muted-foreground">{t("epoch", { epoch: group.epoch })}</p>
      <p className="break-all font-mono text-ui-caption text-muted-foreground">
        {group.workspaceBinding?.workspacePath ?? t("unboundHint")}
      </p>
      <CrewWorkspaceField
        value={selected}
        disabled={pending || locked}
        allowUnbound={!group.workspaceBinding}
        onChange={setSelected}
      />
      <Button
        disabled={!selected || pending || locked}
        onClick={() => selected && void onBind(selected)}
      >
        {t(group.workspaceBinding ? "rebind" : "bind")}
      </Button>
      <p className="text-ui-caption text-muted-foreground">
        {t(locked ? "lockedHint" : "rebindHint")}
      </p>
    </div>
  );
}
