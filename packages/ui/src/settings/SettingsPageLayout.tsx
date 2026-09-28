import type { CSSProperties, ReactNode } from "react";
import { TID_SETTINGS_PAGE } from "@zcode/shared";
import { MobileWorkspaceSidebarToggle } from "@/app-shell/MobileWorkspaceSidebarToggle.js";
import { WorkspaceSidebarPanel } from "@/app-shell/WorkspaceSidebarPanel.js";
import { cn } from "@/components/lib/utils.js";
import type { useWorkspaceSidebar } from "@/hooks/useWorkspaceSidebar.js";
import type { SettingsSectionId } from "@/lib/settingsNavigation.js";

export function SettingsPageLayout({
  activeSection,
  sidebarState,
  sidebarRail,
  sidebar,
  windowControls,
  children,
}: {
  activeSection: SettingsSectionId;
  sidebarState: ReturnType<typeof useWorkspaceSidebar>;
  /** 桌面分支（Electron）侧栏是否收成 68px 图标 rail；Web 覆盖抽屉不使用。 */
  sidebarRail?: boolean;
  sidebar: ReactNode;
  windowControls?: ReactNode;
  children: ReactNode;
}) {
  const { isMobileSidebar, isSidebarVisible, handleToggleSidebar, handleDismissMobileSidebar } =
    sidebarState;
  return (
    <div
      data-testid={TID_SETTINGS_PAGE}
      data-active-section={activeSection}
      // 固定单行边界，避免内部 viewer 撑出窗口；桌面保留原 grid，不套用首页 50% 宽度上限。
      className={cn(
        "relative grid w-full grid-rows-[minmax(0,1fr)]",
        // Web 使用外框的动态视口高度，避免手机地址栏使抽屉底部被裁切。
        isMobileSidebar
          ? "h-full min-h-0 grid-cols-[minmax(0,1fr)]"
          : cn(
              "h-screen min-h-full transition-[grid-template-columns] duration-200",
              // 列宽跟随用户显隐状态而不是断点：窄窗口默认 rail，可随时手动展开/收起。
              sidebarRail ? "grid-cols-[68px_minmax(0,1fr)]" : "grid-cols-[268px_minmax(0,1fr)]",
            ),
      )}
      style={
        isMobileSidebar
          ? ({
              "--workspace-sidebar-panel-width": `${isSidebarVisible ? 268 : 0}px`,
              "--workspace-sidebar-width": "268px",
            } as CSSProperties)
          : undefined
      }
    >
      {windowControls}
      {isMobileSidebar ? (
        <>
          <WorkspaceSidebarPanel
            panelId="settings-sidebar"
            mobile
            visible={isSidebarVisible}
            onDismiss={handleDismissMobileSidebar}
          >
            {sidebar}
          </WorkspaceSidebarPanel>
          <div className="absolute left-2 top-1 z-40 [app-region:no-drag]">
            <MobileWorkspaceSidebarToggle
              panelId="settings-sidebar"
              visible={isSidebarVisible}
              onToggle={handleToggleSidebar}
            />
          </div>
        </>
      ) : (
        <aside className="min-w-0">{sidebar}</aside>
      )}
      {children}
    </div>
  );
}
