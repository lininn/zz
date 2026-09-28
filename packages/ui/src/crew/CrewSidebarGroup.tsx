import { useEffect, useId, useState } from "react";
import { ChevronRight, MessageSquare, Trash2, Users } from "lucide-react";
import type { CrewConversation, CrewGroup } from "@zcode/shared";
import { useCrew } from "@/hooks/useCrew.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { Button } from "@/components/ui/button.js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { CrewStatus } from "./CrewStatus.js";
import { crewConversationTitle } from "./CrewConversations.js";
import { crewSidebarConversations } from "./crewSidebarTree.js";
import { isCrewBusy } from "./crewUiHelpers.js";
import { CrewSidebarActions } from "./CrewSidebarActions.js";
import { CrewSidebarFeedback } from "./CrewSidebarFeedback.js";

export function CrewSidebarGroup({
  visible = true,
  group,
  selectedGroupId,
  selectedConversationId,
  onSelect,
  onEdit,
  captureNavigation,
}: {
  visible?: boolean;
  group: CrewGroup;
  selectedGroupId: string | null;
  selectedConversationId: string | null;
  onSelect: (groupId: string, conversationId: string) => void;
  onEdit: (groupId: string) => void;
  captureNavigation: () => () => boolean;
}) {
  const t = useCrewText();
  const selected = group.groupId === selectedGroupId;
  const [expanded, setExpanded] = useState(selected);
  const contentId = useId();
  useEffect(() => {
    if (selected) setExpanded(true);
  }, [selected, selectedConversationId]);
  // 树只加载展开群的会话列表，禁止详情读取触发每群 runtime preflight 扇出。
  const crew = useCrew(group.groupId, null, expanded && visible, false);
  const conversations = crewSidebarConversations(crew.conversations, group.groupId);
  return (
    <li className="min-w-0" data-crew-group-id={group.groupId}>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left text-ui-base hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3 shrink-0 ${expanded ? "rotate-90" : ""}`}
          />
          <Users aria-hidden="true" className="size-4 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 truncate" title={group.name}>
            {group.name}
          </span>
          <CrewStatus status={group.status} />
        </button>
        <CrewSidebarActions
          name={group.name}
          disabled={crew.pending || crew.unavailable}
          locked={isCrewBusy(group)}
          commandError={crew.commandError}
          onCreate={async () => {
            const isSelectionCurrent = captureNavigation();
            const result = await crew.createConversation({ groupId: group.groupId });
            if (result.ok && result.isCurrent() && isSelectionCurrent()) {
              setExpanded(true);
              onSelect(group.groupId, result.value.conversationId);
            }
          }}
          onDuplicate={async () => {
            const isSelectionCurrent = captureNavigation();
            const result = await crew.duplicate({
              groupId: group.groupId,
              name: t("copyName", { name: group.name }).slice(0, 200),
            });
            // 原服务负责复制为未绑定群；不复制历史，也不在侧栏额外执行 bind。
            if (result.ok && result.isCurrent() && isSelectionCurrent())
              onEdit(result.value.groupId);
          }}
          onEdit={() => onEdit(group.groupId)}
          onDelete={async () => {
            const result = await crew.remove(group.groupId);
            return result.ok && result.isCurrent();
          }}
        />
      </div>
      <CrewSidebarFeedback crew={crew} />
      <ul
        id={contentId}
        hidden={!expanded}
        className="ml-4 min-w-0 space-y-0.5 border-l border-border pl-1"
      >
        {expanded &&
          conversations.map((conversation) => {
            const title = crewConversationTitle(conversation, conversations, t);
            return (
              <li key={conversation.conversationId} className="min-w-0">
                <div className="group/conversation relative flex min-w-0 items-center">
                  <button
                    type="button"
                    data-conversation-id={conversation.conversationId}
                    aria-current={
                      selected && selectedConversationId === conversation.conversationId
                        ? "page"
                        : undefined
                    }
                    onClick={() => onSelect(group.groupId, conversation.conversationId)}
                    className={`flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-ui-base hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 ${selected && selectedConversationId === conversation.conversationId ? "bg-selected" : ""}`}
                  >
                    <MessageSquare
                      aria-hidden="true"
                      className="size-3 shrink-0 text-foreground-subtle"
                    />
                    <span className="min-w-0 flex-1 truncate" title={title}>
                      {title}
                    </span>
                    <CrewStatus
                      status={conversation.status}
                      // 悬停时让位于删除按钮，避免图标重叠。
                      className="transition-opacity group-hover/conversation:opacity-0"
                    />
                  </button>
                  <ConversationDeleteButton
                    conversation={conversation}
                    title={title}
                    disabled={crew.pending || crew.unavailable}
                    onDelete={async () => {
                      const result = await crew.deleteConversation({
                        groupId: group.groupId,
                        conversationId: conversation.conversationId,
                      });
                      return result.ok && result.isCurrent();
                    }}
                  />
                </div>
              </li>
            );
          })}
        {expanded &&
          !crew.loading &&
          !crew.readError &&
          !crew.unavailable &&
          conversations.length === 0 && (
            <li className="px-2 py-1 text-ui-sm text-foreground-subtle">
              {t("home.emptyConversations")}
            </li>
          )}
      </ul>
    </li>
  );
}

function ConversationDeleteButton({
  conversation,
  title,
  disabled,
  onDelete,
}: {
  conversation: CrewConversation;
  title: string;
  disabled: boolean;
  onDelete: () => Promise<boolean>;
}) {
  const t = useCrewText();
  const [confirming, setConfirming] = useState(false);
  // 默认会话与执行中的会话不可删除，与服务端护栏一致。
  const locked =
    conversation.isDefault ||
    conversation.status === "active" ||
    conversation.status === "recovery_required" ||
    conversation.status === "awaiting_user_approval";
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="absolute right-1 z-10 size-7 rounded-lg opacity-0 transition-opacity focus-visible:opacity-100 group-hover/conversation:opacity-100 group-focus-within/conversation:opacity-100"
        disabled={disabled || locked}
        aria-label={t("deleteConversation", { name: title })}
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConversationTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConversationDescription", { name: title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (await onDelete()) setConfirming(false);
              }}
            >
              {t("delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
