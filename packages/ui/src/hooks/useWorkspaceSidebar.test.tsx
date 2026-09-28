import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getMobileSidebarSnapshot,
  subscribeWorkspaceSidebarViewport,
  transitionWorkspaceSidebar,
  useWorkspaceSidebar,
} from "./useWorkspaceSidebar.js";

function withWindow(value: unknown, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function matchMediaWindow(matches: boolean) {
  const listeners: Array<() => void> = [];
  return {
    window: {
      matchMedia: (query: string) => {
        assert.equal(query, "(min-width: 1024px)");
        return {
          matches,
          addEventListener: (_: string, listener: () => void) => listeners.push(listener),
          removeEventListener: (_: string, listener: () => void) => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          },
        };
      },
    },
    listeners,
  };
}

for (const [matches, expectedMobile] of [
  [true, false],
  [false, true],
] as const) {
  test(`viewport matchMedia(matches=${matches}) resolves mobile=${expectedMobile}`, () => {
    withWindow(matchMediaWindow(matches).window, () => {
      assert.equal(getMobileSidebarSnapshot(), expectedMobile);
    });
  });
}

for (const action of ["workspace selection", "existing task", "new task", "new conversation"]) {
  test(`${action} dismisses the mobile sidebar idempotently`, () => {
    const opened = transitionWorkspaceSidebar(
      { isMobile: true, visible: false },
      { type: "toggle" },
    );
    assert.equal(opened.visible, true);
    const closed = transitionWorkspaceSidebar(opened, { type: "navigate" });
    assert.equal(closed.visible, false);
    assert.equal(transitionWorkspaceSidebar(closed, { type: "navigate" }), closed);
  });
}

test("desktop navigation preserves expanded and manually collapsed states", () => {
  const expanded = { isMobile: false, visible: true };
  assert.equal(transitionWorkspaceSidebar(expanded, { type: "navigate" }), expanded);
  const collapsed = transitionWorkspaceSidebar(expanded, { type: "toggle" });
  assert.equal(collapsed.visible, false);
  assert.equal(transitionWorkspaceSidebar(collapsed, { type: "navigate" }), collapsed);
  assert.equal(transitionWorkspaceSidebar(collapsed, { type: "toggle" }).visible, true);
});

test("crossing the Web breakpoint resets to the destination default, not a stale open drawer", () => {
  const mobile = { isMobile: true, visible: true };
  const wide = transitionWorkspaceSidebar(mobile, { type: "viewport", isMobile: false });
  assert.equal(wide.visible, true);
  const narrow = transitionWorkspaceSidebar(wide, { type: "viewport", isMobile: true });
  assert.equal(narrow.visible, false);
  assert.equal(transitionWorkspaceSidebar(narrow, { type: "viewport", isMobile: true }), narrow);
});

test("viewport subscription forwards change events and unsubscribes cleanly", () => {
  const { window, listeners } = matchMediaWindow(false);
  withWindow(window, () => {
    let updates = 0;
    const unsubscribe = subscribeWorkspaceSidebarViewport(() => updates++);
    assert.equal(listeners.length, 1);
    listeners[0]!();
    assert.equal(updates, 1);
    unsubscribe();
    assert.equal(listeners.length, 0);
    listeners.forEach((listener) => listener());
    assert.equal(updates, 1);
  });
});

function Snapshot({ isDesktop = false }: { isDesktop?: boolean }) {
  const sidebar = useWorkspaceSidebar(isDesktop);
  return <output data-visible={sidebar.isSidebarVisible} data-mobile={sidebar.isMobileSidebar} />;
}

test("SSR without window keeps the desktop snapshot and never touches matchMedia", () => {
  withWindow(undefined, () => {
    assert.equal(getMobileSidebarSnapshot(), false);
    assert.doesNotThrow(() => subscribeWorkspaceSidebarViewport(() => {})());
    assert.match(renderToStaticMarkup(<Snapshot />), /data-visible="true" data-mobile="false"/);
  });
});

test("SSR snapshot ignores client-only viewport and never collapses Electron", () => {
  withWindow(
    {
      matchMedia: () => {
        throw new Error("must not read viewport during SSR");
      },
    },
    () => {
      assert.match(renderToStaticMarkup(<Snapshot />), /data-visible="true"/);
      assert.match(
        renderToStaticMarkup(<Snapshot isDesktop />),
        /data-visible="true" data-mobile="false"/,
      );
    },
  );
});

test("narrow viewport starts collapsed; crossing to wide starts docked and expanded", () => {
  // 客户端初值：transition 在首次渲染把 hydration 后的视口快照套进状态。
  assert.equal(
    transitionWorkspaceSidebar(
      { isMobile: false, visible: true },
      { type: "viewport", isMobile: true },
    ).visible,
    false,
    "narrow viewport must start collapsed",
  );
  assert.equal(
    transitionWorkspaceSidebar(
      { isMobile: true, visible: false },
      { type: "viewport", isMobile: false },
    ).visible,
    true,
    "wide viewport must start docked and expanded",
  );
});
