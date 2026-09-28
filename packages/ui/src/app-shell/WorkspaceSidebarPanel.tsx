import { useEffect, useImperativeHandle, useRef } from "react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WorkspaceSidebarPanel({
  panelId = "sidebar",
  visible,
  mobile,
  onDismiss,
  panelRef,
  sidebarRef,
  children,
}: {
  panelId?: string;
  visible: boolean;
  mobile: boolean;
  onDismiss: () => void;
  panelRef?: Ref<HTMLDivElement>;
  sidebarRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const elementRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(panelRef, () => elementRef.current!, []);
  useEffect(() => {
    if (!mobile || !visible) return;
    // 设置页覆盖时首页仍在 DOM 中；按目标面板找开关，避免回焦到 inert 的底层首页。
    const toggle = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="mobile-sidebar-toggle"]'),
    ).find((button) => button.getAttribute("aria-controls") === panelId);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // 后台层不能消费前台 Escape，也不能改变原先的侧栏显隐选择。
      if (elementRef.current?.closest("[inert]")) return;
      onDismiss();
      toggle?.focus();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      // 导航/遮罩收起时，不能把焦点留在即将 inert 的侧栏中。
      if (elementRef.current?.contains(document.activeElement)) toggle?.focus();
    };
  }, [mobile, visible, onDismiss, panelId]);

  return (
    <>
      {mobile && visible ? (
        <button
          type="button"
          tabIndex={-1}
          data-testid="mobile-sidebar-backdrop"
          className="absolute inset-0 z-20 bg-background/60"
          aria-label={intl.formatMessage({ id: "workspaceSidebar.toggleSidebar" })}
          onClick={onDismiss}
        />
      ) : null}
      <div
        ref={elementRef}
        data-panel=""
        data-workspace-sidebar-panel="true"
        id={panelId}
        inert={!visible}
        className={cn(
          "w-[var(--workspace-sidebar-panel-width)] flex-none overflow-hidden duration-200 ease-out transition-[width,opacity] data-[workspace-sidebar-resizing=true]:transition-opacity",
          // 移动端取消 50% 上限与 flex 占位，仍沿用同一个宽度变量和动画，不改桌面记忆宽度。
          mobile
            ? "absolute inset-y-0 left-0 z-30 max-w-[calc(100%_-_3rem)] bg-background-alt"
            : "max-w-[50%]",
          visible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <aside
          ref={sidebarRef}
          className="h-full overflow-hidden select-none"
          aria-hidden={!visible}
        >
          {children}
        </aside>
      </div>
    </>
  );
}
