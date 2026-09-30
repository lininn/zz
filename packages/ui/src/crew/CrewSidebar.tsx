import { useMemo, useRef } from "react";
import { Folder, Plus, Settings2, Users } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useCrew } from "@/hooks/useCrew.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewSidebarGroup } from "./CrewSidebarGroup.js";
import { CrewSidebarFeedback } from "./CrewSidebarFeedback.js";
import { crewSidebarTree } from "./crewSidebarTree.js";

export interface CrewSidebarProps {
  visible?: boolean;
  selectedGroupId: string | null;
  selectedConversationId: string | null;
  onSelect: (groupId: string, conversationId: string) => void;
  onEdit: (groupId: string) => void;
  onCreate?: () => void;
  onManage?: () => void;
}

export function CrewSidebar({
  visible = true,
  selectedGroupId,
  selectedConversationId,
  onSelect,
  onEdit,
  onCreate,
  onManage,
}: CrewSidebarProps) {
  const t = useCrewText();
  const crew = useCrew(null, null, visible);
  const buckets = useMemo(() => crewSidebarTree(crew.groups), [crew.groups]);
  // 群行未卸载时 useCrew scope 不随外部选择变化；此 token 仅阻止迟到命令抢走导航。
  const selection = useMemo(() => ({}), [selectedGroupId, selectedConversationId]);
  const currentSelection = useRef({ selection, revision: 0 });
  if (currentSelection.current.selection !== selection)
    currentSelection.current = { selection, revision: 0 };
  const captureNavigation = () => {
    const scope = currentSelection.current;
    const revision = scope.revision;
    return () => currentSelection.current === scope && scope.revision === revision;
  };
  const navigate = (action: () => void) => {
    currentSelection.current.revision++;
    action();
  };
  return (
    <section
      aria-label={t("home.sidebarTitle")}
      className="flex min-h-0 min-w-0 flex-1 flex-col text-foreground"
    >
      <header className="flex min-w-0 items-center justify-between gap-2 px-2 py-1">
        <h2 className="truncate text-ui-base font-semibold">{t("home.sidebarTitle")}</h2>
        {onManage && (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-9 rounded-lg sm:size-7"
            aria-label={t("home.manage")}
            onClick={() => navigate(onManage)}
          >
            <Settings2 aria-hidden="true" />
          </Button>
        )}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
        <CrewSidebarFeedback crew={crew} />
        {!crew.loading && !crew.readError && !crew.unavailable && buckets.length === 0 && (
          <div className="space-y-2 px-2 py-4">
            <p className="text-ui-base">{t("emptyTitle")}</p>
            <p className="text-ui-sm text-foreground-subtle">{t("emptyDescription")}</p>
          </div>
        )}
        <ul className="min-w-0 space-y-4">
          {buckets.map((bucket) => (
            <li
              key={JSON.stringify(bucket.key)}
              className="min-w-0"
              data-workspace-key={bucket.key ?? undefined}
            >
              <div
                className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-ui-xs font-semibold uppercase tracking-wider text-foreground-subtlest"
                title={bucket.workspacePath ? `${bucket.workspacePath}\n${bucket.key}` : undefined}
              >
                {bucket.workspacePath ? (
                  <Folder aria-hidden="true" className="size-3 shrink-0" />
                ) : (
                  <Users aria-hidden="true" className="size-3 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate">
                    {bucket.workspacePath ?? t("home.unbound")}
                  </h3>
                  {bucket.key !== null && bucket.key !== bucket.workspacePath && (
                    <p className="truncate text-ui-xs text-foreground-subtlest">{bucket.key}</p>
                  )}
                </div>
              </div>
              <ul className="min-w-0 space-y-0.5 py-0.5">
                {bucket.groups.map((group) => (
                  <CrewSidebarGroup
                    key={group.groupId}
                    group={group}
                    visible={visible}
                    selectedGroupId={selectedGroupId}
                    selectedConversationId={selectedConversationId}
                    captureNavigation={captureNavigation}
                    onSelect={(groupId, conversationId) =>
                      navigate(() => onSelect(groupId, conversationId))
                    }
                    onEdit={(groupId) => navigate(() => onEdit(groupId))}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      {onCreate && (
        <div className="shrink-0 border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 w-full justify-start rounded-lg sm:min-h-7"
            onClick={() => navigate(onCreate)}
          >
            <Plus aria-hidden="true" />
            {t("createGroup")}
          </Button>
        </div>
      )}
    </section>
  );
}
