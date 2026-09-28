import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getNarrowSettingsSnapshot,
  subscribeSettingsViewport,
  transitionSettingsSidebarRail,
  useSettingsSidebarRail,
} from "./useSettingsSidebarRail.js";

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
  return {
    matchMedia: (query: string) => {
      assert.equal(query, "(min-width: 1024px)");
      return { matches, addEventListener() {}, removeEventListener() {} };
    },
  };
}

test("narrow viewport defaults to the icon rail; wide viewport defaults to full navigation", () => {
  const narrow = transitionSettingsSidebarRail(
    { isNarrowViewport: false, isRail: false },
    { type: "viewport", isNarrowViewport: true },
  );
  assert.equal(narrow.isRail, true);
  const wide = transitionSettingsSidebarRail(narrow, { type: "viewport", isNarrowViewport: false });
  assert.equal(wide.isRail, false);
  assert.equal(
    transitionSettingsSidebarRail(wide, { type: "viewport", isNarrowViewport: false }),
    wide,
    "same-viewport updates must be idempotent",
  );
});

test("toggle flips the rail state in both directions", () => {
  const expanded = { isNarrowViewport: false, isRail: false };
  assert.equal(transitionSettingsSidebarRail(expanded, { type: "toggle" }).isRail, true);
  const rail = { isNarrowViewport: true, isRail: true };
  assert.equal(transitionSettingsSidebarRail(rail, { type: "toggle" }).isRail, false);
});

test("crossing the breakpoint resets to the destination default instead of carrying the manual choice", () => {
  const manuallyCollapsedOnWide = { isNarrowViewport: false, isRail: true };
  const narrow = transitionSettingsSidebarRail(manuallyCollapsedOnWide, {
    type: "viewport",
    isNarrowViewport: true,
  });
  assert.equal(narrow.isRail, true);
  const manuallyExpandedOnNarrow = { isNarrowViewport: true, isRail: false };
  const wide = transitionSettingsSidebarRail(manuallyExpandedOnNarrow, {
    type: "viewport",
    isNarrowViewport: false,
  });
  assert.equal(wide.isRail, false);
});

function Rail({ enabled = true }: { enabled?: boolean }) {
  const rail = useSettingsSidebarRail(enabled);
  return <output data-rail={rail.isRail} />;
}

test("SSR without window keeps the desktop snapshot and never touches matchMedia", () => {
  withWindow(undefined, () => {
    assert.equal(getNarrowSettingsSnapshot(), false);
    assert.doesNotThrow(() => subscribeSettingsViewport(() => {})());
    assert.match(renderToStaticMarkup(<Rail />), /data-rail="false"/);
  });
});

test("disabled hook keeps the expanded default regardless of viewport", () => {
  withWindow(matchMediaWindow(true), () => {
    assert.match(renderToStaticMarkup(<Rail enabled={false} />), /data-rail="false"/);
  });
});

test("browser snapshot follows the lg breakpoint via matchMedia", () => {
  withWindow(matchMediaWindow(true), () => {
    // matches=true 即视口 ≥1024px（宽），narrow 快照为 false。
    assert.equal(getNarrowSettingsSnapshot(), false);
  });
  withWindow(matchMediaWindow(false), () => {
    assert.equal(getNarrowSettingsSnapshot(), true);
  });
});

test("viewport subscription without matchMedia stays a safe no-op", () => {
  withWindow({}, () => {
    let updates = 0;
    const unsubscribe = subscribeSettingsViewport(() => updates++);
    assert.equal(updates, 0);
    assert.doesNotThrow(() => unsubscribe());
  });
});
