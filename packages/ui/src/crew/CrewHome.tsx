import { useRef } from "react";
import type { CrewGroup } from "@zcode/shared";
import { Users } from "lucide-react";
import { useCrew } from "@/hooks/useCrew.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { useCrewAgentCatalog } from "@/hooks/useCrewAgentCatalog.js";
import { Button } from "@/components/ui/button.js";
import { CrewChatView } from "./CrewChatView.js";
import { CrewGroupEditor } from "./CrewGroupEditor.js";
import { crewBindingKey } from "./crewUiHelpers.js";

export function CrewHome({
  visible = true,
  groupId,
  conversationId,
  editing,
  onFinishEditing,
  onManage,
}: {
  visible?: boolean;
  groupId: string | null;
  conversationId: string | null;
  editing: boolean;
  onFinishEditing: () => void;
  onManage: () => void;
}) {
  const t = useCrewText();
  const crew = useCrew(groupId, conversationId, visible);
  const detail = crew.detail;
  const creating = editing && !groupId;
  const selected = Boolean(groupId && (conversationId || editing));
  // 选择意图与详情可用性不是同一状态；读取失败不能倒退成“从左侧选择”。
  const missingDetail = selected && !crew.loading && !detail;
  const readError = crew.readErrorKey?.startsWith("error.") ? crew.readErrorKey : "readError";
  return (
    <main
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      data-testid="crew-home"
      data-group-id={groupId ?? undefined}
      data-conversation-id={conversationId ?? undefined}
    >
      {(crew.readError || crew.unavailable || crew.commandError || missingDetail) && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3 text-ui-caption text-destructive"
        >
          {t(
            crew.unavailable
              ? "serviceUnavailable"
              : (crew.commandError ??
                  (crew.readError ? readError : "home.conversationUnavailable")),
          )}
          <Button variant="outline" size="sm" onClick={() => void crew.refresh()}>
            {t("refresh")}
          </Button>
        </div>
      )}
      {/* 新建草稿不依赖持久群组/默认会话；列表加载不能挡住创建编辑器。 */}
      {editing && (creating || detail) ? (
        <div className="min-h-0 overflow-y-auto p-4 md:p-6">
          <CrewHomeEditor
            key={groupId ?? "new"}
            crew={crew}
            group={creating ? undefined : detail?.group}
            onFinish={onFinishEditing}
          />
        </div>
      ) : crew.loading ? (
        <p role="status" className="p-6 text-ui-caption">
          {t("home.loading")}
        </p>
      ) : detail && conversationId ? (
        <CrewChatView
          visible={visible}
          key={`${groupId}:${conversationId}`}
          detail={detail}
          crew={crew}
        />
      ) : selected ? null : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <Users className="size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-ui-lg font-semibold">{t("title")}</h1>
          <p className="max-w-md text-ui-base text-muted-foreground">
            {t("home.chooseConversation")}
          </p>
          <Button variant="outline" onClick={onManage}>
            {t("home.manage")}
          </Button>
        </div>
      )}
    </main>
  );
}

function CrewHomeEditor({
  crew,
  group,
  onFinish,
}: {
  crew: ReturnType<typeof useCrew>;
  group?: CrewGroup;
  onFinish: () => void;
}) {
  const catalog = useCrewAgentCatalog(crew.refresh);
  // create 已接受但 bind 失败时只保留命令收据，重试更新原群，不能重复创建。
  const createdGroupId = useRef<string | null>(null);
  return (
    <CrewGroupEditor
      group={group}
      agents={catalog.agents}
      catalogUnavailable={catalog.unavailable || catalog.loading || catalog.readError}
      pending={crew.pending || catalog.pending}
      onCancel={onFinish}
      onSave={async (params, binding) => {
        const groupId = group?.groupId ?? createdGroupId.current;
        const saved = groupId
          ? await crew.update({ groupId, ...params })
          : await crew.create(params);
        if (!saved.ok || !saved.isCurrent()) return;
        createdGroupId.current = saved.value.groupId;
        // 绑定失败仍留在编辑器；不能把保存成功误当作目录绑定成功。
        if (
          binding &&
          (!saved.value.workspaceBinding ||
            crewBindingKey(binding) !== crewBindingKey(saved.value.workspaceBinding))
        ) {
          const bound = await crew.bind({ groupId: saved.value.groupId, binding });
          if (!bound.ok || !bound.isCurrent()) return;
        }
        onFinish();
      }}
    />
  );
}
