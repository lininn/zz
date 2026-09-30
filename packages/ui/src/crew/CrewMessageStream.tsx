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
import { cn } from "@/components/lib/utils.js";
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
          className="flex flex-wrap items-center gap-1.5 text-ui-caption"
          data-testid="crew-handoff"
        >
          <span className="min-w-0 break-words font-medium text-foreground-subtle">
            {senderName}
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-foreground-subtlest" aria-hidden="true" />
          {mentions.map((mention) => {
            const mentionName = mention.name ?? t("formerMember");
            const color = avatarColor(mention.memberId);
            return (
              <span
                key={mention.memberId}
                className="inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium"
                style={{ backgroundColor: `${color}1f`, color }}
                aria-label={t("home.handoff", { from: senderName, to: mentionName })}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="min-w-0 break-words">@{mentionName}</span>
              </span>
            );
          })}
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
          // 身份色同时用于头像底色与成员名，让同一成员在长流里能被一眼扫到。
          const identityColor =
            user || system ? null : avatarColor(entry.sender.memberId ?? name);
          return (
            <article
              key={entry.key}
              className="flex min-w-0 gap-2.5"
              data-testid="crew-message-group"
              data-sender={entry.sender.memberId ?? entry.sender.kind}
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-ui-caption font-semibold",
                  user || system ? "bg-surface text-foreground-subtle" : undefined,
                )}
                style={identityColor ? { backgroundColor: `${identityColor}1f`, color: identityColor } : undefined}
                aria-hidden="true"
              >
                {user ? (
                  <UserRound className="size-4" />
                ) : system ? (
                  <ArrowRight className="size-4" />
                ) : (
                  <span>{Array.from(name)[0]}</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <header
                  className={cn(
                    "min-w-0 break-words text-ui-base font-medium",
                    system ? "text-foreground-subtle" : "text-foreground",
                  )}
                >
                  {name}
                </header>
                <div
                  className={cn(
                    "space-y-3 px-3.5 py-2.5",
                    user
                      ? "rounded-2xl rounded-tr-sm bg-secondary"
                      : system
                        ? // 系统消息是协议/接力派工，不是人说的话：虚线边界把它和成员发言分开。
                          "rounded-2xl rounded-tl-sm border border-dashed border-border"
                        : "rounded-2xl rounded-tl-sm border border-border/60 bg-surface/50",
                  )}
                >
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
