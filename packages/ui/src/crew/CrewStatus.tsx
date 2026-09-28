import type { CrewConversation, CrewExecutionStatus, CrewGroup } from "@zcode/shared";
import { Badge } from "@/components/ui/badge.js";
import { useCrewText } from "@/hooks/useCrewText.js";

export function CrewStatus({
  status,
  className,
}: {
  status: CrewGroup["status"] | CrewConversation["status"] | CrewExecutionStatus;
  className?: string;
}) {
  const t = useCrewText();
  return (
    <Badge
      className={[
        status === "awaiting_user_approval"
          ? "bg-interaction-confirmation-surface text-interaction-confirmation-foreground"
          : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      variant={status === "failed" || status === "recovery_required" ? "destructive" : "secondary"}
    >
      {t(`status.${status}`)}
    </Badge>
  );
}
