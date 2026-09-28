import { useId, useState, type FormEvent } from "react";
import { crewCreateParamsSchema } from "@zcode/shared";
import type {
  CrewAgent,
  CrewCreateParams,
  CrewGroup,
  CrewMemberInput,
  CrewWorkspaceBinding,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Checkbox } from "@/components/ui/checkbox.js";
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
import { crewEditorMembers, crewGroupInput, toggleCrewAgent } from "./crewCatalogUi.js";
import { crewErrorKey } from "./crewErrors.js";
import { crewRelaySettings } from "./crewRelayUi.js";
import { CrewRelaySettings } from "./CrewRelaySettings.js";
import { CrewWorkspaceField } from "./CrewWorkspaceField.js";

export function CrewGroupEditor({
  group,
  agents,
  pending,
  catalogUnavailable = false,
  onSave,
  onCancel,
}: {
  group?: CrewGroup;
  agents: CrewAgent[];
  pending: boolean;
  catalogUnavailable?: boolean;
  onSave: (params: CrewCreateParams, binding: CrewWorkspaceBinding | null) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useCrewText();
  const id = useId();
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<CrewMemberInput[]>(() => group?.members ?? []);
  const [binding, setBinding] = useState(group?.workspaceBinding ?? null);
  const [relay, setRelay] = useState(() => crewRelaySettings(group));
  const [error, setError] = useState<string | null>(null);
  const effectiveMembers = crewEditorMembers(members, agents);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || catalogUnavailable) return;
    let params: CrewCreateParams;
    try {
      params = crewCreateParamsSchema.parse({
        ...crewGroupInput(name, effectiveMembers, agents),
        ...relay,
      });
    } catch (cause) {
      const key = crewErrorKey(cause);
      setError(key === "commandError" ? "validation" : key);
      return;
    }
    setError(null);
    void onSave(params, binding);
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="crew-editor">
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <legend className="mb-4 text-ui-lg font-semibold">
          {t(group ? "editGroup" : "createGroup")}
        </legend>
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`}>{t("groupName")}</Label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={200}
            required
            className="text-mobile-input-safe md:text-ui-base"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <CrewRelaySettings value={relay} disabled={pending} onChange={setRelay} />
        <CrewWorkspaceField
          value={binding}
          disabled={pending}
          allowUnbound={!group?.workspaceBinding}
          onChange={setBinding}
        />
        <p className="text-ui-caption text-muted-foreground">{t("groupReferencesHint")}</p>
        {agents.length === 0 && (
          <p role="status" className="text-ui-caption text-muted-foreground">
            {t("catalogEmptyForGroup")}
          </p>
        )}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2" aria-label={t("chooseAgents")}>
          {agents.map((agent, index) => {
            const member = effectiveMembers.find((item) => item.agentId === agent.agentId);
            return (
              <section
                key={agent.agentId}
                className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-agent-${index}`}
                    checked={Boolean(member)}
                    disabled={pending || catalogUnavailable || (!member && members.length >= 32)}
                    onCheckedChange={() =>
                      setMembers((current) => toggleCrewAgent(current, agent.agentId))
                    }
                  />
                  <Label htmlFor={`${id}-agent-${index}`} className="break-words">
                    {agent.name}
                  </Label>
                </div>
                <p className="text-ui-caption text-muted-foreground">
                  {t(`runtime.${agent.runtime}`)}
                </p>
                <p className="break-all text-ui-caption text-muted-foreground">
                  {t("configVersion", { version: agent.configVersion })}
                </p>
                {member && (
                  <div className="space-y-2">
                    <Label htmlFor={`${id}-access-${index}`}>{t("groupAccessMode")}</Label>
                    <Select
                      value={member.accessMode ?? "inherit"}
                      disabled={pending}
                      onValueChange={(value) =>
                        setMembers((current) =>
                          current.map((item) =>
                            item.agentId === agent.agentId
                              ? {
                                  ...item,
                                  accessMode:
                                    value === "read" || value === "write" ? value : undefined,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger id={`${id}-access-${index}`} className="w-full">
                        <SelectValue>
                          {member.accessMode
                            ? t(`access.${member.accessMode}`)
                            : t("inheritAccess", { access: t(`access.${agent.accessMode}`) })}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          {t("inheritAccess", { access: t(`access.${agent.accessMode}`) })}
                        </SelectItem>
                        <SelectItem value="read">{t("access.read")}</SelectItem>
                        <SelectItem value="write" disabled={agent.accessMode === "read"}>
                          {t("access.write")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {agent.accessMode === "read" && (
                      <p className="text-ui-caption text-muted-foreground">
                        {t("readCannotEscalate")}
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {members
          .filter((member) => !agents.some((agent) => agent.agentId === member.agentId))
          .map((member) => (
            <div key={member.agentId} className="space-y-2">
              <p role="alert" className="text-ui-caption text-destructive">
                {t("error.agentNotFound")}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setMembers((current) => current.filter((item) => item.agentId !== member.agentId))
                }
              >
                {t("remove")}
              </Button>
            </div>
          ))}
        {error && (
          <p role="alert" className="text-ui-caption text-destructive">
            {t(error)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={catalogUnavailable}>
            {t(pending ? "saving" : "save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
