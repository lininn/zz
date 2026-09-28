import { useState } from "react";
import { ArrowLeft, Copy, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.js";
import { useCrewAgentCatalog } from "@/hooks/useCrewAgentCatalog.js";
import { CrewAgentCatalog } from "./CrewAgentCatalog.js";
import { useCrew } from "@/hooks/useCrew.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewGroupEditor } from "./CrewGroupEditor.js";
import { CrewBindingControl } from "./CrewBindingControl.js";
import { CrewConversations } from "./CrewConversations.js";
import { CrewConversationView } from "./CrewConversationView.js";
import { CrewStatus } from "./CrewStatus.js";
import { isCrewBusy } from "./crewUiHelpers.js";

export function CrewSection() {
  const t = useCrewText();
  const [tab, setTab] = useState("agents");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [bindingNotice, setBindingNotice] = useState<{ groupId: string; error: string } | null>(
    null,
  );
  const [editor, setEditor] = useState<"create" | "edit" | null>(null);
  const crew = useCrew(groupId, conversationId, tab === "groups" && editor === null);
  const catalog = useCrewAgentCatalog(crew.refresh);
  const pending = crew.pending || catalog.pending;
  const detail = crew.detail;
  const group = detail?.group;
  const locked = group ? isCrewBusy(group, detail?.executions) : false;
  const select = (id: string | null) => {
    crew.clearError();
    setEditor(null);
    setBindingNotice(null);
    setGroupId(id);
    setConversationId(null);
  };
  const openConversation = (id: string) => {
    setBindingNotice(null);
    setConversationId(id);
  };
  return (
    <div className="min-w-0 space-y-5" data-testid="crew-section">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2 text-ui-lg font-semibold">
            <Users className="size-5" />
            {t("title")}
          </h3>
          <p className="text-ui-caption text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void Promise.all([crew.refresh(), catalog.refresh()])}
          >
            <RefreshCw className="size-4" />
            {t("refresh")}
          </Button>
          {tab === "groups" && !groupId && !editor && (
            <Button
              disabled={crew.pending || crew.unavailable}
              onClick={() => {
                crew.clearError();
                setEditor("create");
              }}
            >
              <Plus className="size-4" />
              {t("createGroup")}
            </Button>
          )}
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setBindingNotice(null);
          setTab(next);
        }}
      >
        <TabsList aria-label={t("title")}>
          <TabsTrigger value="agents" disabled={catalog.pending}>
            {t("agentsTab")}
          </TabsTrigger>
          <TabsTrigger value="groups" disabled={catalog.pending}>
            {t("groupsTab")}
          </TabsTrigger>
        </TabsList>
        {catalog.unavailable && (
          <p role="alert" className="text-ui-caption text-destructive">
            {t("catalogUnavailable")}
          </p>
        )}
        {catalog.readError && (
          <p role="alert" className="text-ui-caption text-destructive">
            {t("catalogReadError")}
          </p>
        )}
        {catalog.commandError && (
          <p role="alert" className="text-ui-caption text-destructive">
            {t(catalog.commandError)}
          </p>
        )}
        <TabsContent value="agents">
          <CrewAgentCatalog catalog={catalog} />
        </TabsContent>
        <TabsContent value="groups" className="space-y-4">
          {crew.unavailable && (
            <p role="alert" className="text-ui-caption text-destructive">
              {t("serviceUnavailable")}
            </p>
          )}
          {crew.readError && (
            <p role="alert" className="text-ui-caption text-destructive">
              {t(crew.readErrorKey === "commandError" ? "readError" : crew.readErrorKey)}
            </p>
          )}
          {crew.commandError && (
            <p role="alert" className="text-ui-caption text-destructive">
              {t(crew.commandError)}
            </p>
          )}
          {bindingNotice?.groupId === groupId && !conversationId && !editor && (
            <p role="alert" className="text-ui-caption text-destructive">
              {t(bindingNotice.error)}
            </p>
          )}
          {(groupId || editor) && (
            <Button variant="ghost" size="sm" onClick={() => select(null)}>
              <ArrowLeft className="size-4" />
              {t("back")}
            </Button>
          )}
          {groupId && !editor && (
            <CrewConversations
              conversations={crew.conversations}
              selectedId={conversationId}
              pending={crew.pending || crew.unavailable}
              onSelect={openConversation}
              onCreate={async () => {
                const result = await crew.createConversation({ groupId });
                if (result.ok && result.isCurrent()) openConversation(result.value.conversationId);
              }}
            />
          )}
          {editor && (editor === "create" || group) ? (
            <CrewGroupEditor
              key={editor === "create" ? "new" : groupId}
              group={editor === "edit" ? group : undefined}
              agents={catalog.agents}
              catalogUnavailable={catalog.unavailable || catalog.loading || catalog.readError}
              pending={crew.pending}
              onCancel={() => setEditor(null)}
              onSave={async (params, binding) => {
                const result =
                  editor === "edit" && group
                    ? await crew.update({ groupId: group.groupId, ...params })
                    : await crew.create(params);
                if (result.ok && result.isCurrent()) {
                  // 先保存引用再绑定；绑定失败保留已创建群，不能让重试再次建群。
                  const saved = result.value;
                  if (
                    binding &&
                    JSON.stringify(binding) !== JSON.stringify(saved.workspaceBinding)
                  ) {
                    const bound = await crew.bind({ groupId: saved.groupId, binding });
                    // 只在本次保存仍有效时移交绑定错误；跳转到别的群/会话绝不能带过去。
                    if (!bound.ok && result.isCurrent()) {
                      setBindingNotice({
                        groupId: saved.groupId,
                        error: bound.error ?? "commandError",
                      });
                    }
                  }
                  if (!result.isCurrent()) return;
                  setEditor(null);
                  setGroupId(saved.groupId);
                  setConversationId(null);
                  void catalog.refresh();
                }
              }}
            />
          ) : group && detail ? (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h4 className="break-words text-ui-lg font-semibold">{group.name}</h4>
                  <CrewStatus status={group.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={crew.pending || locked}
                    onClick={() => setEditor("edit")}
                  >
                    <Pencil className="size-4" />
                    {t("edit")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={crew.pending}
                    onClick={async () => {
                      const result = await crew.duplicate({
                        groupId: group.groupId,
                        name: t("copyName", { name: group.name }).slice(0, 200),
                      });
                      if (result.ok && result.isCurrent()) select(result.value.groupId);
                    }}
                  >
                    <Copy className="size-4" />
                    {t("duplicate")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" disabled={crew.pending || locked}>
                        <Trash2 className="size-4" />
                        {t("delete")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("deleteDescription", { name: group.name })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            const result = await crew.remove(group.groupId);
                            if (result.ok && result.isCurrent()) select(null);
                          }}
                        >
                          {t("delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </header>
              <CrewBindingControl
                key={`${group.groupId}:${group.epoch}`}
                group={group}
                pending={crew.pending}
                locked={locked}
                onBind={async (binding) => {
                  await crew.bind({ groupId: group.groupId, binding });
                }}
              />
              {conversationId ? (
                <CrewConversationView
                  key={`${group.groupId}:${conversationId}`}
                  detail={detail}
                  crew={crew}
                />
              ) : (
                <p className="text-ui-caption text-muted-foreground">{t("chooseConversation")}</p>
              )}
            </>
          ) : crew.loading ? (
            <p role="status" className="text-ui-caption text-muted-foreground">
              {t("loading")}
            </p>
          ) : !groupId && !editor ? (
            <>
              {crew.groups.length === 0 && !crew.readError && !crew.unavailable && (
                <div className="space-y-2 rounded-xl border border-dashed border-border p-6">
                  <h4 className="text-ui-base font-medium">{t("emptyTitle")}</h4>
                  <p className="text-ui-caption text-muted-foreground">{t("emptyDescription")}</p>
                </div>
              )}
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {crew.groups.map((item) => (
                  <button
                    key={item.groupId}
                    type="button"
                    onClick={() => select(item.groupId)}
                    className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-words text-ui-base font-medium">{item.name}</span>
                      <CrewStatus status={item.status} />
                    </div>
                    <p className="text-ui-caption text-muted-foreground">
                      {t("memberCount", { count: item.members.length })}
                    </p>
                    <p className="break-all font-mono text-ui-caption text-muted-foreground">
                      {item.workspaceBinding?.workspacePath ?? t("status.unbound")}
                    </p>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
