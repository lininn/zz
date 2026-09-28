import { Rocket, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { TID_SETTINGS_SECTION_NAV, testId } from "@zcode/shared";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SettingsSectionId } from "@/lib/settingsNavigation.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";
import type { createSettingsPageConfig } from "./settingsPageConfig.js";

function SettingsSidebarButton({
  icon: Icon,
  label,
  active,
  mobile,
  rail,
  children,
  className,
  ...buttonProps
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  mobile: boolean;
  rail?: boolean;
  children?: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  // rail 仅作用于桌面分支（68px 图标栏）；移动抽屉始终显示完整文字。
  const collapsed = !mobile && rail;
  return (
    <ControlHintTooltip title={label} side="right" align="center">
      <button
        {...buttonProps}
        type={buttonProps.type ?? "button"}
        aria-label={label}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-2.5 text-left transition-colors",
          mobile ? "h-10" : collapsed ? "h-8 mx-auto size-10 justify-center px-0" : "h-8",
          active
            ? "bg-surface-hover text-foreground"
            : "text-foreground-subtle hover:bg-surface-hover hover:text-foreground",
          className,
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-current">
          <Icon className="size-4 text-foreground" />
        </span>
        <span className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
          {children ?? <span className="truncate text-ui-base text-foreground">{label}</span>}
        </span>
      </button>
    </ControlHintTooltip>
  );
}

export function SettingsSidebarNavigation({
  groups,
  activeSection,
  mobile,
  rail,
  onSelectSection,
  onOpenOnboarding,
}: {
  groups: ReturnType<typeof createSettingsPageConfig>["settingsSectionGroups"];
  activeSection: SettingsSectionId;
  mobile: boolean;
  rail?: boolean;
  onSelectSection: (section: SettingsSectionId) => void;
  onOpenOnboarding: () => void;
}) {
  const { intl } = useZCodeIntl();
  const collapsed = !mobile && rail;
  return (
    <nav
      id="settings-section-nav"
      aria-label={intl.formatMessage({ id: "settings.navLabel" })}
      className="flex-1 overflow-y-auto px-2 pb-3"
    >
      <div className="space-y-4">
        {groups.map((group, groupIndex) => {
          const groupLabel = intl.formatMessage({
            id: group.titleId,
          });
          const groupLabelId = `settings-sidebar-group-${group.id}`;

          return (
            <div
              key={group.id}
              role="group"
              aria-labelledby={groupLabelId}
              className={cn(
                "space-y-1",
                collapsed && groupIndex > 0 && "border-t border-border pt-3",
              )}
            >
              <div
                id={groupLabelId}
                className={cn(
                  "px-2.5 pb-1 text-ui-sm font-medium text-foreground-subtlest",
                  collapsed && "sr-only",
                )}
              >
                {groupLabel}
              </div>
              {group.sections.map(({ id, icon: Icon, titleId }) => {
                const isActive = activeSection === id;
                const label = intl.formatMessage({ id: titleId });

                return (
                  <SettingsSidebarButton
                    mobile={mobile}
                    rail={rail}
                    key={id}
                    icon={Icon}
                    label={label}
                    active={isActive}
                    aria-current={isActive ? "page" : undefined}
                    data-testid={testId(TID_SETTINGS_SECTION_NAV, id)}
                    onClick={() => {
                      runUserAction({
                        input: {
                          featureId: "settings.navigation",
                          action: "open_section",
                          trigger: "button",
                        },
                        operation: () => {
                          onSelectSection(id);
                        },
                        completed: { resultSource: "local_commit", sectionId: id },
                        failureStage: "navigation_commit",
                      });
                    }}
                  >
                    <span className="truncate text-ui-base text-foreground">{label}</span>
                  </SettingsSidebarButton>
                );
              })}
            </div>
          );
        })}
      </div>

      <SettingsSidebarButton
        mobile={mobile}
        rail={rail}
        icon={Rocket}
        label={intl.formatMessage({ id: "settings.onboarding" })}
        className="mt-4 border border-dashed border-border hover:border-border-hover"
        onClick={() => {
          runUserAction({
            input: {
              featureId: "settings.navigation",
              action: "open_onboarding",
              trigger: "button",
            },
            operation: onOpenOnboarding,
            completed: { resultSource: "local_commit" },
            failureStage: "dialog_open",
          });
        }}
      >
        <span className="text-ui-base text-foreground">
          {intl.formatMessage({ id: "settings.onboarding" })}
        </span>
      </SettingsSidebarButton>
    </nav>
  );
}
