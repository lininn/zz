import { useMemo } from "react";
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
  // 在场：正在跑的派工。同一成员可能在跑多条，按成员去重后再展示名字。
  const workingMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const execution of detail.executions) {
      if (execution.groupId !== group.groupId) continue;
      if (execution.conversationId !== conversation.conversationId) continue;
      if (execution.status !== "queued" && execution.status !== "running") continue;
      ids.add(execution.memberId);
    }
    return ids;
  }, [conversation.conversationId, detail.executions, group.groupId]);
  const workingNames = detail.resolvedMembers
    .filter((member) => workingMemberIds.has(member.memberId))
    .map((member) => member.name);
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
          <span className="min-w-0 break-words text-ui-caption text-foreground-subtle">
            {group.name}
          </span>
          <span className="text-ui-caption text-foreground-subtlest">
            {t("memberCount", { count: detail.resolvedMembers.length })}
          </span>
          {workingNames.length > 0 ? (
            // 群聊的在场感：谁在跑一眼可见，不用逐条展开执行。
            <span
              role="status"
              className="inline-flex min-w-0 items-center gap-1.5 text-ui-caption text-foreground-subtle"
              data-testid="crew-working-members"
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-foreground-subtle"
              />
              <span className="min-w-0 truncate">
                {t("home.workingMembers", { names: workingNames.join("、") })}
              </span>
            </span>
          ) : null}
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
            const working = workingMemberIds.has(member.memberId);
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
                    {working ? (
                      <span
                        role="status"
                        className="size-1.5 shrink-0 animate-pulse rounded-full"
                        style={{ backgroundColor: color }}
                        aria-label={t("home.working")}
                        data-testid="crew-member-working"
                      />
                    ) : null}
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
