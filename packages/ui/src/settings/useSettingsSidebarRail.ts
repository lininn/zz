import { useCallback, useState, useSyncExternalStore } from "react";

// 与 Tailwind lg 一致；使用 min-width 的反值也覆盖 1023.xpx，避免缩放后断点出现缝隙。
const WIDE_SETTINGS_QUERY = "(min-width: 1024px)";
const desktopSnapshot = () => false;
const noopSubscribe = () => () => {};

export function getNarrowSettingsSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? !window.matchMedia(WIDE_SETTINGS_QUERY).matches
    : false;
}

export function subscribeSettingsViewport(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(WIDE_SETTINGS_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

type SidebarRailState = { isNarrowViewport: boolean; isRail: boolean };
type SidebarRailAction = { type: "viewport"; isNarrowViewport: boolean } | { type: "toggle" };

export function transitionSettingsSidebarRail(
  state: SidebarRailState,
  action: SidebarRailAction,
): SidebarRailState {
  if (action.type === "viewport") {
    // 跨断点重置为目标视口的默认值：窄窗口默认图标 rail，宽窗口默认完整导航。
    return state.isNarrowViewport === action.isNarrowViewport
      ? state
      : { isNarrowViewport: action.isNarrowViewport, isRail: action.isNarrowViewport };
  }
  // 开关常驻：用户可随时在 68px 图标 rail 与 268px 完整导航间手动切换。
  return { ...state, isRail: !state.isRail };
}

/**
 * 设置页桌面侧栏的 rail/expanded 状态（仅 Electron 桌面分支渲染；Web 恒为覆盖抽屉，不启用）。
 * 会话级 UI 状态：不持久化、不广播；默认值跟随视口，跨断点重置，toggle 随时可覆盖。
 */
export function useSettingsSidebarRail(enabled: boolean) {
  const isNarrowViewport = useSyncExternalStore(
    enabled ? subscribeSettingsViewport : noopSubscribe,
    enabled ? getNarrowSettingsSnapshot : desktopSnapshot,
    desktopSnapshot,
  );
  const [state, setState] = useState<SidebarRailState>(() => ({
    isNarrowViewport,
    isRail: isNarrowViewport,
  }));
  const current = transitionSettingsSidebarRail(state, {
    type: "viewport",
    isNarrowViewport,
  });
  // 渲染期间同步视口模式，避免 effect 晚一帧留下与断点不符的列宽。
  if (current !== state) setState(current);

  const handleToggleSidebarRail = useCallback(() => {
    setState((previous) => transitionSettingsSidebarRail(previous, { type: "toggle" }));
  }, []);
  return {
    isRail: current.isRail,
    handleToggleSidebarRail,
  };
}
