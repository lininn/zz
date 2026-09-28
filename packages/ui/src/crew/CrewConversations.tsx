import { Plus } from "lucide-react";
import type { CrewConversation } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewStatus } from "./CrewStatus.js";

export function crewConversationTitle(
  conversation: CrewConversation,
  conversations: readonly CrewConversation[],
  t: ReturnType<typeof useCrewText>,
) {
  if (conversation.name.trim()) return conversation.name.trim();
  if (conversation.isDefault) return t("defaultConversation");
  // 服务按 createdAt/rowid 返回创建顺序；保留同毫秒的顺序，不按活动状态或名称重排。
  const number =
    conversations
      .filter((item) => item.groupId === conversation.groupId && !item.isDefault)
      .findIndex((item) => item.conversationId === conversation.conversationId) + 1;
  return t("untitledConversation", { number });
}

export function CrewConversations({
  conversations,
  selectedId,
  pending,
  onSelect,
  onCreate,
}: {
  conversations: CrewConversation[];
  selectedId: string | null;
  pending: boolean;
  onSelect: (id: string) => void;
  onCreate: () => Promise<void>;
}) {
  const t = useCrewText();
  return (
    <section className="min-w-0 space-y-3" aria-label={t("conversations")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-ui-base font-medium">{t("conversations")}</h4>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void onCreate()}>
          <Plus className="size-4" />
          {t("createConversation")}
        </Button>
      </div>
      <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
        {conversations.map((conversation) => (
          <li key={conversation.conversationId} className="min-w-0">
            <button
              type="button"
              data-conversation-id={conversation.conversationId}
              aria-pressed={selectedId === conversation.conversationId}
              onClick={() => onSelect(conversation.conversationId)}
              className={`flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-left text-ui-base transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === conversation.conversationId ? "bg-card-selected" : "bg-card"}`}
            >
              <span className="min-w-0 break-words font-medium">
                {crewConversationTitle(conversation, conversations, t)}
              </span>
              <CrewStatus status={conversation.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
