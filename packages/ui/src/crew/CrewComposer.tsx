import { useId, useState } from "react";
import { AtSign, Send, X } from "lucide-react";
import type {
  CrewConversation,
  CrewGroup,
  CrewGroupDetail,
  CrewResolvedMember,
  CrewSendParams,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js";
import { CrewRuntimeStatus } from "./CrewRuntimeStatus.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { mapCrewMembersToMentionItems } from "@/mentions/providers/crewMentionProvider.js";
import {
  crewSendParams,
  editCrewDraft,
  newCrewDraft,
  opensCrewMentionPicker,
} from "./crewUiHelpers.js";

export function CrewComposer({
  group,
  conversation,
  runtimeAvailability,
  resolvedMembers,
  pending,
  onSend,
}: {
  group: CrewGroup;
  conversation: CrewConversation;
  resolvedMembers: CrewResolvedMember[];
  runtimeAvailability?: CrewGroupDetail["runtimeAvailability"];
  pending: boolean;
  onSend: (params: CrewSendParams & { conversationId: string }) => Promise<boolean>;
}) {
  const t = useCrewText();
  const inputId = useId();
  const [draft, setDraft] = useState(newCrewDraft);
  const [pickerOpen, setPickerOpen] = useState(false);
  const candidates = mapCrewMembersToMentionItems(resolvedMembers);
  const selected = candidates.find((item) => item.value === draft.memberId);
  const selectedMember = resolvedMembers.find((member) => member.memberId === draft.memberId);
  const params = crewSendParams(
    group.groupId,
    conversation.conversationId,
    draft,
    resolvedMembers,
    runtimeAvailability,
  );
  const unavailable = !group.workspaceBinding || conversation.status === "recovery_required";
  const submit = async () => {
    if (!params || pending || unavailable) return;
    if (await onSend(params)) setDraft(newCrewDraft());
  };
  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      data-testid="crew-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor={inputId}>{t("message")}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || unavailable || !candidates.length}
            >
              <AtSign className="size-4" />
              {t("chooseMember")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-0">
            <Command>
              <CommandInput
                placeholder={t("searchMembers")}
                aria-label={t("searchMembers")}
                className="text-mobile-input-safe md:text-ui-base"
              />
              <CommandList aria-label={t("chooseMember")}>
                <CommandEmpty>{t("noMembersFound")}</CommandEmpty>
                {candidates.map((item) => {
                  const member = resolvedMembers.find(
                    (candidate) => candidate.memberId === item.value,
                  );
                  return (
                    <CommandItem
                      key={item.id}
                      value={item.value}
                      keywords={item.keywords}
                      onSelect={() => {
                        setDraft((current) => editCrewDraft(current, { memberId: item.value }));
                        setPickerOpen(false);
                      }}
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="break-words text-ui-base">
                          {item.displayLabel ?? item.label}
                        </p>
                        <p className="line-clamp-2 break-words text-ui-caption text-muted-foreground">
                          {item.description}
                        </p>
                        {member && (
                          <CrewRuntimeStatus member={member} availability={runtimeAvailability} />
                        )}
                        <p className="truncate font-mono text-ui-xs text-muted-foreground">
                          {item.value}
                        </p>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {selected && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            aria-label={t("clearMention", { name: selected.label })}
            className="max-w-full"
            onClick={() => setDraft((current) => editCrewDraft(current, { memberId: null }))}
          >
            <span className="truncate">@{selected.label}</span>
            <X className="size-3 shrink-0" />
          </Button>
        )}
        {draft.memberId && !selected && (
          <p role="alert" className="text-ui-caption text-destructive">
            {t("removedRecipient")}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setDraft((current) => editCrewDraft(current, { memberId: null }))}
            >
              {t("clearRecipient")}
            </Button>
          </p>
        )}
      </div>
      {selectedMember && (
        <CrewRuntimeStatus member={selectedMember} availability={runtimeAvailability} />
      )}
      <Textarea
        id={inputId}
        value={draft.text}
        maxLength={64000}
        disabled={pending}
        placeholder={t("messagePlaceholder")}
        className="min-h-24 text-mobile-input-safe md:text-ui-base"
        onKeyDown={(event) => {
          if (
            !pending &&
            !unavailable &&
            candidates.length &&
            opensCrewMentionPicker(
              event.key,
              event.nativeEvent.isComposing,
              draft.text,
              event.currentTarget.selectionStart,
            )
          ) {
            event.preventDefault();
            setPickerOpen(true);
          }
        }}
        onChange={(event) =>
          setDraft((current) => editCrewDraft(current, { text: event.target.value }))
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-ui-caption text-muted-foreground">
          {t(unavailable ? "sendUnavailable" : selected ? "assignedHint" : "boardOnlyHint")}
        </p>
        <Button type="submit" disabled={!params || pending || unavailable}>
          <Send className="size-4" />
          {t(pending ? "sending" : "send")}
        </Button>
      </div>
    </form>
  );
}
