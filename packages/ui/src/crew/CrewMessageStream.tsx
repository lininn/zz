import { useId, useMemo, useState } from "react";
import { ArrowRight, MessageSquare, UserRound } from "lucide-react";
import type { CrewGroupDetail, CrewPermissionParams } from "@zcode/shared";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation.js";
import { avatarColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import type { CrewRelayResponse } from "./CrewRelayCard.js";
import { crewRelayApprovalBlocked, crewRelayDisplayText } from "./crewRelayUi.js";
import { CrewExecutionRow } from "./CrewExecutionRow.js";
import { crewChatEntries, crewReplyPreview, type CrewChatMessage } from "./crewChatPresentation.js";
import { crewErrorKey } from "./crewErrors.js";

function CrewMessageBody({ item, senderName }: { item: CrewChatMessage; senderName: string }) {
  const t = useCrewText();
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const { message, execution, mentions } = item;
  const errorKey = crewErrorKey(message.text);
  const text =
    message.sender === "member" &&
    execution &&
    execution.status !== "succeeded" &&
    errorKey !== "commandError"
      ? t(errorKey)
      : message.sender === "member"
        ? crewRelayDisplayText(message.text)
        : message.text;
  const preview = message.sender === "member" ? crewReplyPreview(text) : null;
  return (
    <div className="min-w-0 space-y-2" data-message-id={message.messageId}>
      {mentions.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1 text-ui-caption"
          data-testid="crew-handoff"
        >
          <span className="min-w-0 break-words text-muted-foreground">{senderName}</span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          {mentions.map((mention) => (
            <span
              key={mention.memberId}
              className="min-w-0 break-words rounded-md border border-border bg-selected px-1.5 py-0.5 font-medium"
              aria-label={t("home.handoff", {
                from: senderName,
                to: mention.name ?? t("formerMember"),
              })}
            >
              @{mention.name ?? t("formerMember")}
            </span>
          ))}
        </div>
      )}
      <p
        id={textId}
        className="whitespace-pre-wrap break-words text-ui-base [overflow-wrap:anywhere]"
      >
        {preview !== null && !expanded ? preview : text}
      </p>
      {preview !== null && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-auto px-1 py-1 text-ui-caption text-muted-foreground"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((value) => !value)}
        >
          {t(expanded ? "home.collapseReply" : "home.expandReply")}
        </Button>
      )}
    </div>
  );
}

export function CrewMessageStream({
  visible = true,
  detail,
  pending,
  onCancel,
  onRespondPermission,
  onRespondRelay,
}: {
  visible?: boolean;
  onRespondRelay?: CrewRelayResponse;
  detail: CrewGroupDetail;
  pending: boolean;
  onCancel: (executionId: string) => Promise<void>;
  onRespondPermission: (params: CrewPermissionParams & { conversationId: string }) => Promise<void>;
}) {
  const t = useCrewText();
  const entries = useMemo(() => crewChatEntries(detail), [detail]);
  return (
    <Conversation
      className="min-h-0 min-w-0 flex-1"
      aria-label={t("home.messages")}
      aria-live="polite"
      aria-relevant="additions text"
    >
      <ConversationContent className="mx-auto w-full max-w-4xl space-y-5 px-3 py-4 sm:px-6">
        {entries.length === 0 && (
          <ConversationEmptyState
            title={t("emptyBoard")}
            description={t("home.emptyHint")}
            icon={<MessageSquare className="size-6" />}
          />
        )}
        {entries.map((entry) => {
          if (entry.kind === "execution")
            return (
              <CrewExecutionRow
                visible={visible}
                key={entry.key}
                execution={entry.execution}
                pending={pending}
                onCancel={onCancel}
                onRespondPermission={onRespondPermission}
                onRespondRelay={onRespondRelay}
                relayApprovalBlocked={crewRelayApprovalBlocked(detail, entry.execution)}
              />
            );
          const user = entry.sender.kind === "user";
          const system = entry.sender.kind === "system";
          const name = user
            ? t("you")
            : system
              ? t("home.system")
              : (entry.sender.name ?? t("formerMember"));
          return (
            <article
              key={entry.key}
              className="flex min-w-0 gap-2.5"
              data-testid="crew-message-group"
              data-sender={entry.sender.memberId ?? entry.sender.kind}
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ui-caption font-semibold"
                style={
                  user || system
                    ? undefined
                    : { borderColor: avatarColor(entry.sender.memberId ?? name) }
                }
                aria-hidden="true"
              >
                {user ? (
                  <UserRound className="size-4 text-muted-foreground" />
                ) : system ? (
                  <ArrowRight className="size-4 text-muted-foreground" />
                ) : (
                  <span style={{ color: avatarColor(entry.sender.memberId ?? name) }}>
                    {Array.from(name)[0]}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <header className="min-w-0 break-words text-ui-caption font-semibold">
                  {name}
                </header>
                <div className={user ? "space-y-3 rounded-xl bg-secondary px-3 py-2" : "space-y-3"}>
                  {entry.messages.map((item) => (
                    <CrewMessageBody key={item.message.messageId} item={item} senderName={name} />
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </ConversationContent>
      <ConversationScrollButton aria-label={t("home.scrollToLatest")} />
    </Conversation>
  );
}
