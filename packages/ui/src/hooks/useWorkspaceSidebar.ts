import { useCallback, useState, useSyncExternalStore } from "react";

// 与 Tailwind lg 一致；使用 min-width 的反值也覆盖 1023.xpx，避免缩放后断点出现缝隙。
const WIDE_WORKSPACE_QUERY = "(min-width: 1024px)";
const desktopSnapshot = () => false;
const noopSubscribe = () => () => {};

export function getMobileSidebarSnapshot(): boolean {
  // 视口 ≥1024px 为停靠侧栏（挤压内容、无遮罩，点击内容区不收起）；
  // <1024px 为覆盖抽屉（点外部关闭是窄屏惯例）。SSR 快照保持桌面语义。
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? !window.matchMedia(WIDE_WORKSPACE_QUERY).matches
    : false;
}

export function subscribeWorkspaceSidebarViewport(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(WIDE_WORKSPACE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

type SidebarVisibility = { isMobile: boolean; visible: boolean };
type SidebarAction = { type: "viewport"; isMobile: boolean } | { type: "toggle" | "navigate" };

export function transitionWorkspaceSidebar(
  state: SidebarVisibility,
  action: SidebarAction,
): SidebarVisibility {
  if (action.type === "viewport") {
    return state.isMobile === action.isMobile
      ? state
      : { isMobile: action.isMobile, visible: !action.isMobile };
  }
  if (action.type === "toggle") return { ...state, visible: !state.visible };
  // 导航关闭必须幂等，不能复用 toggle；桌面显隐选择不受导航影响。
  return state.isMobile && state.visible ? { ...state, visible: false } : state;
}

export function useWorkspaceSidebar(isDesktop = false) {
  const isMobileSidebar = useSyncExternalStore(
    isDesktop ? noopSubscribe : subscribeWorkspaceSidebarViewport,
    isDesktop ? desktopSnapshot : getMobileSidebarSnapshot,
    desktopSnapshot,
  );
  const [visibility, setVisibility] = useState<SidebarVisibility>(() => ({
    isMobile: isMobileSidebar,
    visible: !isMobileSidebar,
  }));
  const current = transitionWorkspaceSidebar(visibility, {
    type: "viewport",
    isMobile: isMobileSidebar,
  });
  // 在本组件渲染期间同步模式，避免 effect 晚一帧留下挤压内容的展开态。
  // 服务端快照固定为桌面；hydration 后再由外部 viewport 快照应用移动端规则。
  if (current !== visibility) setVisibility(current);

  const handleToggleSidebar = useCallback(() => {
    setVisibility((state) => transitionWorkspaceSidebar(state, { type: "toggle" }));
  }, []);
  const handleDismissMobileSidebar = useCallback(() => {
    setVisibility((state) => transitionWorkspaceSidebar(state, { type: "navigate" }));
  }, []);
  return {
    isSidebarVisible: current.visible,
    isMobileSidebar,
    handleToggleSidebar,
    handleDismissMobileSidebar,
  };
}
