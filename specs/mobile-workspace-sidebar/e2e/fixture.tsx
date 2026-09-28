import { useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { IPlatformService } from "@zcode/shared";
import { useWorkspaceSidebar } from "../../../packages/ui/src/hooks/useWorkspaceSidebar.js";
import { WorkspaceSidebarPanel } from "../../../packages/ui/src/app-shell/WorkspaceSidebarPanel.js";
import { DesktopTopOverlay } from "../../../packages/ui/src/DesktopTopOverlay.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";

const isDesktop = new URLSearchParams(location.search).has("desktop");
const noop = () => {};

function Fixture() {
  const sidebar = useWorkspaceSidebar(isDesktop);
  const [lastAction, setLastAction] = useState("none");
  // 只注入一个已记忆宽度，不写真实应用 localStorage，也不启动 Host/Agent。
  const rememberedWidth = 320;
  const navigate = (action: string) => {
    setLastAction(action);
    sidebar.handleDismissMobileSidebar();
  };
  return (
    <div
      data-testid="sidebar-fixture"
      data-visible={sidebar.isSidebarVisible}
      data-mobile={sidebar.isMobileSidebar}
      data-last-action={lastAction}
      className="relative flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground"
      style={
        {
          "--workspace-sidebar-panel-width": `${sidebar.isSidebarVisible ? rememberedWidth : 0}px`,
          "--workspace-sidebar-width": `${rememberedWidth}px`,
        } as CSSProperties
      }
    >
      <WorkspaceSidebarPanel
        visible={sidebar.isSidebarVisible}
        mobile={sidebar.isMobileSidebar}
        onDismiss={sidebar.handleDismissMobileSidebar}
      >
        <nav className="flex h-full flex-col gap-2 px-2 pt-14">
          {[
            "workspace",
            "same workspace",
            "existing task",
            "new task",
            "grouped task",
            "new conversation",
          ].map((action) => (
            <button
              key={action}
              type="button"
              className="h-10 rounded-md bg-secondary"
              data-action={action}
              onClick={() => navigate(action)}
            >
              {action}
            </button>
          ))}
        </nav>
      </WorkspaceSidebarPanel>
      <main
        id="content"
        className="min-w-[320px] flex-1 p-4 pt-16"
        inert={sidebar.isMobileSidebar && sidebar.isSidebarVisible}
      >
        <h1>Mobile workspace sidebar fixture</h1>
        <p>Real state hook, sidebar panel, top overlay, and production Tailwind styles.</p>
        <p>Navigation buttons are local substitutes; no full-app routing or live services.</p>
        <button type="button" data-testid="content-action" onClick={() => setLastAction("content")}>
          Content action
        </button>
      </main>
      <DesktopTopOverlay
        workspaceAbsPath="/fixture/workspace"
        isDesktop={isDesktop}
        isSidebarVisible={sidebar.isSidebarVisible}
        isMobileSidebar={sidebar.isMobileSidebar}
        updateReadyVersion={null}
        updateState={null}
        toggleSidebarShortcutLabel="Ctrl+B"
        newTaskShortcutLabel="Ctrl+N"
        goBackShortcutLabel="Alt+Left"
        goForwardShortcutLabel="Alt+Right"
        canTaskNavBack={false}
        canTaskNavForward={false}
        canGoBack={false}
        canGoForward={false}
        appLogoUrl="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"
        platform={{} as IPlatformService}
        onToggleSidebar={sidebar.handleToggleSidebar}
        onCreateTask={() => navigate("topbar new task")}
        onGoBack={noop}
        onGoForward={noop}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale="en-US">
    <Fixture />
  </ZCodeIntlProvider>,
);
