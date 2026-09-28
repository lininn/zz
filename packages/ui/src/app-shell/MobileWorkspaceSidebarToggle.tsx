import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function MobileWorkspaceSidebarToggle({
  panelId = "sidebar",
  visible,
  onToggle,
}: {
  panelId?: string;
  visible: boolean;
  onToggle: () => void;
}) {
  const { intl } = useZCodeIntl();
  const Icon = visible ? PanelLeftClose : PanelLeftOpen;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-md"
      className="size-10 [app-region:no-drag]"
      data-testid="mobile-sidebar-toggle"
      aria-label={intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" })}
      aria-expanded={visible}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <Icon className="size-5" />
    </Button>
  );
}
