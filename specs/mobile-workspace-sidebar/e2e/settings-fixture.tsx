import { useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceSidebarPanel } from "../../../packages/ui/src/app-shell/WorkspaceSidebarPanel.js";
import { MobileWorkspaceSidebarToggle } from "../../../packages/ui/src/app-shell/MobileWorkspaceSidebarToggle.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
import { useWorkspaceSidebar } from "../../../packages/ui/src/hooks/useWorkspaceSidebar.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import type { SettingsSectionId } from "../../../packages/ui/src/lib/settingsNavigation.js";
import { SettingsPageLayout } from "../../../packages/ui/src/settings/SettingsPageLayout.js";
import { SettingsSidebarNavigation } from "../../../packages/ui/src/settings/SettingsSidebarNavigation.js";
import { createSettingsPageConfig } from "../../../packages/ui/src/settings/settingsPageConfig.js";

const query = new URLSearchParams(location.search);
const isDesktop = query.has("desktop");
const locale = query.get("locale") === "zh-CN" ? "zh-CN" : "en-US";
const { settingsSectionGroups } = createSettingsPageConfig({
  isDesktop,
  isMacDesktop: false,
  isWindowsDesktop: false,
});

function Fixture() {
  const sidebar = useWorkspaceSidebar(isDesktop);
  const [section, setSection] = useState<SettingsSectionId>("appearance");
  const [selectionCount, setSelectionCount] = useState(0);
  const [contentClicks, setContentClicks] = useState(0);
  const [backgroundDismissals, setBackgroundDismissals] = useState(0);
  return (
    <div
      data-testid="settings-sidebar-fixture"
      data-visible={sidebar.isSidebarVisible}
      data-mobile={sidebar.isMobileSidebar}
      data-selections={selectionCount}
      data-content-clicks={contentClicks}
      data-background-dismissals={backgroundDismissals}
      className="h-dvh bg-background text-foreground"
    >
      {/* 复现 RootWorkspaceContent：底层首页仍挂载但 inert，不能抢焦点或响应 Escape。 */}
      <div inert className="pointer-events-none absolute inset-0 opacity-0">
        <MobileWorkspaceSidebarToggle visible onToggle={() => {}} />
        <WorkspaceSidebarPanel
          visible
          mobile
          onDismiss={() => setBackgroundDismissals((count) => count + 1)}
        >
          <button type="button">Background workspace</button>
        </WorkspaceSidebarPanel>
      </div>
      <SettingsPageLayout
        activeSection={section}
        sidebarState={sidebar}
        sidebar={
          <div className="flex h-full flex-col">
            <div className="h-12 shrink-0" />
            <SettingsSidebarNavigation
              groups={settingsSectionGroups}
              activeSection={section}
              mobile={sidebar.isMobileSidebar}
              onSelectSection={(next) => {
                // 本地导航替身；生产导航接线另由 settingsSidebarNavigation.test.ts 执行验证。
                setSection(next);
                setSelectionCount((count) => count + 1);
                sidebar.handleDismissMobileSidebar();
              }}
              onOpenOnboarding={() => {}}
            />
          </div>
        }
      >
        <section
          data-settings-content-frame="true"
          inert={sidebar.isMobileSidebar && sidebar.isSidebarVisible}
          className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-background"
        >
          <header
            className={`flex h-12 shrink-0 items-center ${sidebar.isMobileSidebar ? "pl-14" : "pl-4"}`}
          >
            Settings
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto p-4">
            <h1 className="text-ui-lg">{section}</h1>
            <p className="text-ui-base">
              Real settings layout/navigation, shared hook/panel/toggle and production CSS.
            </p>
            <p className="text-ui-caption">
              Local section state only; no SettingsPage services, Host, Agent, or persistence.
            </p>
            <button
              type="button"
              data-testid="content-action"
              className="h-10"
              onClick={() => setContentClicks((count) => count + 1)}
            >
              Content action
            </button>
          </main>
        </section>
      </SettingsPageLayout>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ZCodeIntlProvider initialLocale={locale}>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </ZCodeIntlProvider>,
);
