import { useId } from "react";
import type { CrewRelayMode } from "@zcode/shared";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import type { crewRelaySettings } from "./crewRelayUi.js";

type Settings = ReturnType<typeof crewRelaySettings>;
export function CrewRelaySettings({
  value,
  disabled,
  onChange,
}: {
  value: Settings;
  disabled: boolean;
  onChange: (value: Settings) => void;
}) {
  const t = useCrewText();
  const id = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-xl border border-border p-3">
      <legend className="text-ui-base font-medium">{t("relay.settings")}</legend>
      <Label htmlFor={`${id}-mode`}>{t("relay.mode")}</Label>
      <Select
        value={value.relayMode}
        disabled={disabled}
        onValueChange={(relayMode) => {
          if (!disabled) onChange({ ...value, relayMode: relayMode as CrewRelayMode });
        }}
      >
        <SelectTrigger id={`${id}-mode`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["manual", "semi", "auto"] as const).map((mode) => (
            <SelectItem key={mode} value={mode}>
              {t(`relay.mode.${mode}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-ui-caption text-muted-foreground">{t("relay.modeHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-hops`}>{t("relay.autoHops")}</Label>
          <Input
            id={`${id}-hops`}
            type="number"
            min={0}
            max={8}
            step={1}
            required
            disabled={disabled || value.relayMode !== "semi"}
            value={Number.isNaN(value.relayAutoHops) ? "" : value.relayAutoHops}
            onChange={(event) => {
              if (!disabled && value.relayMode === "semi")
                onChange({ ...value, relayAutoHops: event.target.valueAsNumber });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-budget`}>{t("relay.budgetMinutes")}</Label>
          <Input
            id={`${id}-budget`}
            aria-describedby={`${id}-budget-hint`}
            type="number"
            min={1}
            max={1440}
            step={1}
            required
            value={Number.isNaN(value.relayBudgetMinutes) ? "" : value.relayBudgetMinutes}
            onChange={(event) => {
              if (!disabled) onChange({ ...value, relayBudgetMinutes: event.target.valueAsNumber });
            }}
          />
          <p id={`${id}-budget-hint`} className="text-ui-caption text-muted-foreground">
            {t("relay.budgetHint")}
          </p>
        </div>
      </div>
      <p className="text-ui-caption text-muted-foreground">{t("relay.hopLimit")}</p>
    </fieldset>
  );
}
