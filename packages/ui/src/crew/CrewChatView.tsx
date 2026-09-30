import type { CrewGroupDetail } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { avatarColor } from "@/components/workflow-timeline/WorkflowAgentFace.js";
import type { CrewController } from "@/hooks/useCrew.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewRelayPlans } from "./CrewRelayPlans.js";
import { CrewRelayControl } from "./CrewRelayControl.js";
import { CrewComposer } from "./CrewComposer.js";
import { crewConversationTitle } from "./CrewConversations.js";
import { CrewMessageStream } from "./CrewMessageStream.js";
import { CrewRuntimeStatus } from "./CrewRuntimeStatus.js";
import { CrewStatus } from "./CrewStatus.js";

export function CrewChatView({
  detail,
  crew,
  visible = true,
}: {
  detail: CrewGroupDetail;
  crew: CrewController;
  visible?: boolean;
}) {
  const t = useCrewText();
  const { group, conversation } = detail;
  const target = { groupId: group.groupId, conversationId: conversation.conversationId };
  const viewKey = `${group.groupId}:${conversation.conversationId}:${group.epoch}`;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      data-testid="crew-chat"
      data-conversation-id={conversation.conversationId}
    >
      <header className="shrink-0 space-y-2 border-b border-border px-3 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-ui-lg font-semibold">
            {crewConversationTitle(conversation, detail.conversations, t)}
          </h2>
          <CrewStatus status={conversation.status} />
          <span className="min-w-0 break-words text-ui-caption text-muted-foreground">
            {group.name}
          </span>
        </div>
        <CrewRelayControl
          group={group}
          pending={crew.pending}
          onUpdate={async (params) => {
            await crew.update(params);
          }}
        />
        <ul className="flex max-h-24 flex-wrap gap-2 overflow-y-auto" aria-label={t("members")}>
          {detail.resolvedMembers.map((member) => {
            const color = avatarColor(member.memberId);
            return (
              <li key={member.memberId} className="min-w-0">
                <details className="group min-w-0 rounded-lg bg-surface px-2 py-1">
                  <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 text-ui-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {/* 与消息流里的头像同一套身份色，避免同一成员在两处换色。 */}
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-full text-ui-xs font-semibold"
                      style={{ backgroundColor: `${color}1f`, color }}
                      aria-hidden="true"
                    >
                      {Array.from(member.name)[0]}
                    </span>
                    <span className="min-w-0 break-words">{member.name}</span>
                  </summary>
                  <CrewRuntimeStatus member={member} availability={detail.runtimeAvailability} />
                </details>
              </li>
            );
          })}
        </ul>
      </header>
      {(conversation.status === "active" || conversation.status === "recovery_required") && (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:px-6"
          role="status"
        >
          <p className="min-w-0 flex-1 text-ui-caption text-muted-foreground">
            {t(conversation.status === "recovery_required" ? "recoveryHint" : "activeHint")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={crew.pending}
            onClick={() => {
              if (!crew.pending) void crew.recover({ ...target, confirm: true });
            }}
          >
            {t("recover")}
          </Button>
        </div>
      )}
      <CrewRelayPlans
        detail={detail}
        pending={crew.pending}
        onRespond={async (params) => {
          await crew.respondRelay(params);
        }}
      />
      <CrewMessageStream
        visible={visible}
        key={viewKey}
        detail={detail}
        pending={crew.pending}
        onCancel={async (executionId) => {
          await crew.cancel({ ...target, executionId });
        }}
        onRespondRelay={async (params) => {
          await crew.respondRelay(params);
        }}
        onRespondPermission={async (params) => {
          await crew.respondPermission(params);
        }}
      />
      <div className="shrink-0 border-t border-border bg-background px-3 pt-3 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-4xl">
          <CrewComposer
            key={viewKey}
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
        </div>
      </div>
    </section>
  );
}
