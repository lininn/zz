import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { CrewAgent } from "@zcode/shared";
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
import type { CrewAgentCatalogController } from "@/hooks/useCrewAgentCatalog.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { CrewAgentEditor } from "./CrewAgentEditor.js";

export function CrewAgentCatalog({ catalog }: { catalog: CrewAgentCatalogController }) {
  const t = useCrewText();
  const [editor, setEditor] = useState<CrewAgent | "new" | null>(null);
  if (editor)
    return (
      <CrewAgentEditor
        key={editor === "new" ? "new" : editor.agentId}
        agent={editor === "new" ? undefined : editor}
        pending={catalog.pending}
        onCancel={() => {
          setEditor(null);
          catalog.clearError();
        }}
        onSave={async (input) => {
          const result =
            editor === "new"
              ? await catalog.create(input)
              : await catalog.update(editor.agentId, input);
          if (result.ok) setEditor(null);
        }}
      />
    );
  return (
    <section className="min-w-0 space-y-4" aria-label={t("agentsTab")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-ui-caption text-muted-foreground">{t("catalogDescription")}</p>
        <Button
          disabled={catalog.pending || catalog.unavailable}
          onClick={() => {
            catalog.clearError();
            setEditor("new");
          }}
        >
          <Plus className="size-4" />
          {t("createAgent")}
        </Button>
      </div>
      {catalog.loading ? (
        <p role="status" className="text-ui-caption">
          {t("loading")}
        </p>
      ) : catalog.agents.length === 0 && !catalog.readError && !catalog.unavailable ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-ui-caption text-muted-foreground">
          {t("catalogEmpty")}
        </p>
      ) : null}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {catalog.agents.map((agent) => (
          <article
            key={agent.agentId}
            className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-4"
          >
            <h4 className="break-words text-ui-base font-medium">{agent.name}</h4>
            <p className="text-ui-caption text-muted-foreground">
              {t(`runtime.${agent.runtime}`)} · {t(`access.${agent.accessMode}`)}
            </p>
            <p className="break-all text-ui-caption text-muted-foreground">
              {t("configVersion", { version: agent.configVersion })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={catalog.pending}
                aria-label={t("editAgentNamed", { name: agent.name })}
                onClick={() => {
                  catalog.clearError();
                  setEditor(agent);
                }}
              >
                <Pencil className="size-4" />
                {t("edit")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={catalog.pending}
                    aria-label={t("deleteAgentNamed", { name: agent.name })}
                  >
                    <Trash2 className="size-4" />
                    {t("delete")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("deleteAgentTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("deleteAgentDescription", { name: agent.name })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void catalog.remove(agent.agentId)}>
                      {t("delete")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
