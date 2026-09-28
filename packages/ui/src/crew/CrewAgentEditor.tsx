import { useId, useState, type FormEvent } from "react";
import { crewAgentInputSchema } from "@zcode/shared";
import type { CrewAgent, CrewAgentInput } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Input } from "@/components/ui/input.js";
import { Label } from "@/components/ui/label.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewAgentModelField } from "./CrewAgentModelField.js";

export function CrewAgentEditor({
  agent,
  pending,
  onSave,
  onCancel,
}: {
  agent?: CrewAgent;
  pending: boolean;
  onSave: (input: CrewAgentInput) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useCrewText();
  const id = useId();
  const [input, setInput] = useState<CrewAgentInput>(() =>
    agent
      ? {
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          runtime: agent.runtime,
          accessMode: agent.accessMode,
          modelSelection: agent.modelSelection,
          toolAllowlist: agent.toolAllowlist,
        }
      : { name: "", systemPrompt: "", runtime: "zcode", accessMode: "read" },
  );
  const [tools, setTools] = useState(() => agent?.toolAllowlist?.join("\n") ?? "");
  const [limitTools, setLimitTools] = useState(agent?.toolAllowlist !== undefined);
  const [invalid, setInvalid] = useState(false);
  const change = (patch: Partial<CrewAgentInput>) =>
    setInput((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const result = crewAgentInputSchema.safeParse({
      ...input,
      name: input.name.trim(),
      modelSelection: input.runtime === "zcode" ? input.modelSelection : undefined,
      toolAllowlist:
        input.runtime === "zcode" && limitTools
          ? [
              ...new Set(
                tools
                  .split(/\r?\n/)
                  .map((tool) => tool.trim())
                  .filter(Boolean),
              ),
            ]
          : undefined,
    });
    setInvalid(!result.success);
    if (result.success) void onSave(result.data);
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="crew-agent-editor">
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <legend className="mb-4 text-ui-lg font-semibold">
          {t(agent ? "editAgent" : "createAgent")}
        </legend>
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>{t("agentName")}</Label>
          <Input
            id={`${id}-name`}
            required
            maxLength={200}
            value={input.name}
            className="text-mobile-input-safe md:text-ui-base"
            onChange={(event) => change({ name: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-prompt`}>{t("systemPrompt")}</Label>
          <Textarea
            id={`${id}-prompt`}
            maxLength={32000}
            value={input.systemPrompt}
            className="min-h-28 text-mobile-input-safe md:text-ui-base"
            placeholder={t("rolePlaceholder")}
            onChange={(event) => change({ systemPrompt: event.target.value })}
          />
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-runtime`}>{t("runtimeLabel")}</Label>
            <Select
              value={input.runtime}
              disabled={pending}
              onValueChange={(value) => {
                const runtime = crewAgentInputSchema.shape.runtime.safeParse(value);
                if (!runtime.success) return;
                // 外部 CLI 不支持目录级模型/工具覆盖；不能把隐藏的 ZCode 配置继续提交。
                change({
                  runtime: runtime.data,
                  ...(runtime.data !== "zcode"
                    ? { modelSelection: undefined, toolAllowlist: undefined }
                    : {}),
                });
              }}
            >
              <SelectTrigger
                id={`${id}-runtime`}
                className="w-full"
                data-testid="crew-runtime-select"
              >
                <SelectValue>{t(`runtime.${input.runtime}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["zcode", "claude-cli", "codex-cli", "opencode-cli"] as const).map((runtime) => (
                  <SelectItem key={runtime} value={runtime}>
                    {t(`runtime.${runtime}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-access`}>{t("defaultAccessMode")}</Label>
            <Select
              value={input.accessMode}
              disabled={pending}
              onValueChange={(value) =>
                change({ accessMode: value === "write" ? "write" : "read" })
              }
            >
              <SelectTrigger id={`${id}-access`} className="w-full">
                <SelectValue>{t(`access.${input.accessMode}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t("access.read")}</SelectItem>
                <SelectItem value="write">{t("access.write")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {input.runtime === "zcode" ? (
          <>
            <CrewAgentModelField
              value={input.modelSelection}
              disabled={pending}
              onChange={(modelSelection) => change({ modelSelection })}
            />
            <div className="space-y-2" data-testid="crew-agent-tools">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-limit`}
                  checked={limitTools}
                  disabled={pending}
                  onCheckedChange={(value) => setLimitTools(value === true)}
                />
                <Label htmlFor={`${id}-limit`}>{t("limitTools")}</Label>
              </div>
              {limitTools && (
                <>
                  <Label htmlFor={`${id}-tools`}>{t("toolAllowlist")}</Label>
                  <Textarea
                    id={`${id}-tools`}
                    value={tools}
                    className="font-mono text-mobile-input-safe md:text-ui-base"
                    onChange={(event) => setTools(event.target.value)}
                  />
                </>
              )}
              <p className="text-ui-caption text-muted-foreground">
                {t(limitTools ? "toolAllowlistHint" : "inheritToolsHint")}
              </p>
            </div>
          </>
        ) : (
          <p className="text-ui-caption text-muted-foreground">
            {t("externalModel")} {t("externalCapabilities")}
          </p>
        )}
        {invalid && (
          <p role="alert" className="text-ui-caption text-destructive">
            {t("agentValidation")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t(pending ? "saving" : "save")}</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
