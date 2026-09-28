import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import type { CrewController } from "@/hooks/useCrew.js";
import { useCrewText } from "@/hooks/useCrewText.js";

export function CrewSidebarFeedback({ crew }: { crew: CrewController }) {
  const t = useCrewText();
  return (
    <div className="space-y-1 px-2 text-ui-sm text-foreground-subtle">
      {crew.loading && <p role="status">{t("home.loading")}</p>}
      {crew.unavailable && <p role="alert">{t("serviceUnavailable")}</p>}
      {crew.readError && (
        <div role="alert" className="space-y-1">
          <p>{t(crew.readErrorKey === "commandError" ? "readError" : crew.readErrorKey)}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9 sm:min-h-6"
            disabled={crew.loading || crew.unavailable}
            onClick={() => void crew.refresh()}
          >
            <RefreshCw aria-hidden="true" />
            {t("refresh")}
          </Button>
        </div>
      )}
      {crew.commandError && (
        <p role="alert" className="text-destructive">
          {t(crew.commandError)}
        </p>
      )}
    </div>
  );
}
