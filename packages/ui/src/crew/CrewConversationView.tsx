import type { CrewGroupDetail } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import type { CrewController } from "@/hooks/useCrew.js";
import { CrewBoard } from "./CrewBoard.js";
import { CrewRelayControl } from "./CrewRelayControl.js";
import { CrewComposer } from "./CrewComposer.js";
import { CrewStatus } from "./CrewStatus.js";
import { crewConversationTitle } from "./CrewConversations.js";

export function CrewConversationView({
  detail,
  crew,
}: {
  detail: CrewGroupDetail;
  crew: CrewController;
}) {
  const t = useCrewText();
  const { group, conversation } = detail;
  const target = { groupId: group.groupId, conversationId: conversation.conversationId };
  return (
    <section
      className="min-w-0 space-y-4"
      data-testid="crew-conversation"
      data-conversation-id={conversation.conversationId}
    >
      <header className="flex flex-wrap items-center gap-2">
        <h4 className="break-words text-ui-lg font-semibold">
          {crewConversationTitle(conversation, detail.conversations, t)}
        </h4>
        <CrewStatus status={conversation.status} />
      </header>
      {(conversation.status === "active" || conversation.status === "recovery_required") && (
        <div className="space-y-2 rounded-xl border border-border p-4" role="status">
          <p className="text-ui-caption">
            {t(conversation.status === "recovery_required" ? "recoveryHint" : "activeHint")}
          </p>
          <Button
            variant="outline"
            disabled={crew.pending}
            onClick={() => void crew.recover({ ...target, confirm: true })}
          >
            {t("recover")}
          </Button>
        </div>
      )}
      <CrewRelayControl
        group={group}
        pending={crew.pending}
        onUpdate={async (params) => {
          await crew.update(params);
        }}
      />
      <CrewBoard
        detail={detail}
        pending={crew.pending}
        onRespondRelay={async (params) => {
          await crew.respondRelay(params);
        }}
        onRespondPermission={async (params) => {
          await crew.respondPermission(params);
        }}
        onCancel={async (executionId) => {
          await crew.cancel({ ...target, executionId });
        }}
      />
      <CrewComposer
        key={`${group.groupId}:${conversation.conversationId}:${group.epoch}`}
        group={group}
        conversation={conversation}
        pending={crew.pending}
        resolvedMembers={detail.resolvedMembers}
        runtimeAvailability={detail.runtimeAvailability}
        onSend={async (params) => {
          const result = await crew.send(params);
          return result.ok && result.isCurrent();
        }}
      />
    </section>
  );
}
