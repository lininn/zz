import { useId } from "react";
import type { ModelSelection } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useCrewAgentModels } from "@/hooks/useCrewAgentModels.js";
import { useCrewText } from "@/hooks/useCrewText.js";

export function CrewAgentModelField({
  value,
  disabled,
  onChange,
}: {
  value?: ModelSelection;
  disabled: boolean;
  onChange: (value: ModelSelection | undefined) => void;
}) {
  const t = useCrewText();
  const id = useId();
  const read = useCrewAgentModels();
  const providers = read.state.status === "ready" ? read.state.view.providers : [];
  const choices = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      key: JSON.stringify([provider.providerId, model.modelId]),
      label: `${provider.providerName || provider.providerId} / ${model.modelId}`,
      providerId: provider.providerId,
      modelId: model.modelId,
      levels: model.config.optionSpecs.reasoningLevel.values,
    })),
  );
  const key = value ? JSON.stringify([value.providerId, value.modelId]) : "inherit";
  const selected = choices.find((item) => item.key === key);
  return (
    <div className="space-y-2" data-testid="crew-agent-model">
      <Label htmlFor={id}>{t("agentModel")}</Label>
      <Select
        value={key}
        disabled={disabled}
        onValueChange={(next) => {
          const choice = choices.find((item) => item.key === next);
          if (!choice) {
            if (next === "inherit") onChange(undefined);
            return;
          }
          const reasoningLevel = choice.levels.at(-1);
          onChange({
            providerId: choice.providerId,
            modelId: choice.modelId,
            ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
          });
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            {value ? `${value.providerId} / ${value.modelId}` : t("defaultModel")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{t("defaultModel")}</SelectItem>
          {value && !selected && (
            <SelectItem value={key} disabled>{`${value.providerId} / ${value.modelId}`}</SelectItem>
          )}
          {choices.map((choice) => (
            <SelectItem key={choice.key} value={choice.key}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && selected.levels.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-reasoning`}>{t("reasoningLevel")}</Label>
          <Select
            value={value?.options?.reasoningLevel ?? ""}
            disabled={disabled}
            onValueChange={(reasoningLevel) => {
              if (value) onChange({ ...value, options: { reasoningLevel } });
            }}
          >
            <SelectTrigger id={`${id}-reasoning`} className="w-full">
              <SelectValue placeholder={t("reasoningLevel")} />
            </SelectTrigger>
            <SelectContent>
              {selected.levels.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {read.state.status !== "ready" && (
        <p role="status" className="text-ui-caption text-muted-foreground">
          {t(read.state.status === "loading" ? "loading" : "modelReadUnavailable")}
        </p>
      )}
      {read.state.status === "error" && (
        <Button type="button" variant="outline" onClick={read.reload}>
          {t("refresh")}
        </Button>
      )}
      {read.state.status === "ready" && value && !selected && (
        <p role="alert" className="text-ui-caption text-destructive">
          {t("modelNotAvailable")}
        </p>
      )}
    </div>
  );
}
