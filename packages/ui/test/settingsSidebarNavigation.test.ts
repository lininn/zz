import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  getMobileSidebarSnapshot,
  transitionWorkspaceSidebar,
} from "../src/hooks/useWorkspaceSidebar.js";

// 与首页回归一致，提取并执行生产回调，避免测试复制“选择后关闭”的接线。
const page = await readFile(new URL("../src/SettingsPage.tsx", import.meta.url), "utf8");
const navigation = await readFile(
  new URL("../src/settings/SettingsSidebarNavigation.tsx", import.meta.url),
  "utf8",
);
const source = ts.createSourceFile(
  "SettingsPage.tsx",
  page,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const callbacks = new Map<string, string>();
const bindings = new Map<string, string>();
let pendingIntentListener: string | undefined;
function visit(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(source) === "addPendingSettingsSectionListener"
  ) {
    pendingIntentListener = node.arguments[0]!.getText(source);
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(source) === "useCallback"
  ) {
    callbacks.set(node.name.text, node.initializer.arguments[0]!.getText(source));
  }
  if (
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(source) === "SettingsSidebarNavigation"
  ) {
    for (const prop of node.attributes.properties) {
      if (ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) {
        bindings.set(prop.name.getText(source), prop.initializer.expression!.getText(source));
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);

function fixture(isMobile: boolean, visible: boolean, reject = false) {
  let state = { isMobile, visible };
  let section = "appearance";
  let version = 7;
  const calls: string[] = [];
  const context = {
    setPluginNavigationOrigin(origin: unknown) {
      assert.equal(origin, undefined);
      calls.push("origin");
    },
    setSettingsSectionNavigationVersion(update: (version: number) => number) {
      version = update(version);
      calls.push("version");
    },
    setActiveSettingsSection(next: string) {
      calls.push("section");
      if (reject) throw new Error("navigation rejected");
      section = next;
    },
    handleDismissMobileSidebar() {
      calls.push("dismiss");
      state = transitionWorkspaceSidebar(state, { type: "navigate" });
    },
  };
  const callback = callbacks.get("handleSelectSidebarSection");
  assert(callback);
  const compiled = ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2024 },
  }).outputText;
  const select = runInNewContext(compiled, context) as (section: string) => void;
  return { select, calls, state: () => state, section: () => section, version: () => version };
}

test("SettingsPage wires shared hook, layout, content inert and original section navigation", () => {
  assert.match(page, /const sidebar = useWorkspaceSidebar\(Boolean\(isDesktop\)\)/);
  assert.match(page, /sidebarState=\{sidebar\}/);
  assert.match(page, /inert=\{sidebar.isMobileSidebar && sidebar.isSidebarVisible\}/);
  assert.equal(bindings.get("mobile"), "sidebar.isMobileSidebar");
  assert.equal(bindings.get("onSelectSection"), "handleSelectSidebarSection");
  assert.equal(bindings.get("groups"), "settingsSectionGroups");
  assert.equal(bindings.get("activeSection"), "activeSection");
  assert.match(navigation, /operation: \(\) => \{\s*onSelectSection\(id\);\s*\}/);
  assert.match(navigation, /completed: \{ resultSource: "local_commit", sectionId: id \}/);
  assert.match(
    callbacks.get("setActiveSettingsSection")!,
    /writeLastSettingsSectionPreference\(resolvedSection\)/,
  );
  assert.doesNotMatch(callbacks.get("setActiveSettingsSection")!, /Dismiss|Toggle/);
  // Bugfix 后侧栏显隐只由用户手动控制，section 导航不得自动收起抽屉。
  assert.doesNotMatch(callbacks.get("handleSelectSidebarSection")!, /Dismiss/);
  // 桌面分支的 rail 状态由 useSettingsSidebarRail 持有并透传给布局与导航。
  assert.match(page, /const settingsRail = useSettingsSidebarRail\(!sidebar\.isMobileSidebar\)/);
  assert.match(page, /sidebarRail=\{settingsRail\.isRail\}/);
  assert.equal(bindings.get("rail"), "settingsRail.isRail");
});

for (const width of [390, 768, 1023, 1023.5, 1024, 1440]) {
  test(`settings sidebar mode follows the viewport breakpoint (${width})`, () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    const matches = width >= 1024;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        matchMedia: (query: string) => {
          assert.equal(query, "(min-width: 1024px)");
          return { matches };
        },
      },
    });
    try {
      // 宽视口（≥1024）停靠侧栏，点内容区不会误关；窄视口走覆盖抽屉。
      const mobile = getMobileSidebarSnapshot();
      assert.equal(mobile, !matches);
      const state = transitionWorkspaceSidebar(
        { isMobile: !mobile, visible: mobile },
        { type: "viewport", isMobile: mobile },
      );
      assert.equal(state.isMobile, mobile);
      assert.equal(state.visible, !mobile);
      // 停靠模式下导航不收起；抽屉模式下打开后导航仍可幂等关闭。
      if (mobile) {
        const opened = transitionWorkspaceSidebar(state, { type: "toggle" });
        assert.equal(opened.visible, true);
        const closed = transitionWorkspaceSidebar(opened, { type: "navigate" });
        assert.equal(closed.visible, false);
      } else {
        assert.equal(transitionWorkspaceSidebar(state, { type: "navigate" }), state);
      }
    } finally {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}

for (const section of ["appearance", "general", "crew"]) {
  test(`select ${section} commits navigation and keeps the overlay sidebar open, including same-section selection`, () => {
    const f = fixture(true, true);
    f.select(section);
    assert.deepEqual(f.calls, ["origin", "version", "section"]);
    assert.equal(f.section(), section);
    assert.equal(f.version(), 8);
    assert.equal(f.state().visible, true, "section switch must not auto-collapse the drawer");
    f.select(section);
    assert.equal(f.state().visible, true);
    assert.equal(f.version(), 9);
  });
}

for (const visible of [false, true]) {
  test(`desktop section selection preserves sidebar visibility (${visible})`, () => {
    const f = fixture(false, visible);
    f.select("crew");
    assert.equal(f.state().visible, visible);
    assert.equal(f.section(), "crew");
  });
}

test("failed section navigation does not dismiss mobile drawer", () => {
  const f = fixture(true, true, true);
  assert.throws(() => f.select("general"), /navigation rejected/);
  assert.equal(f.state().visible, true);
  assert.equal(f.section(), "appearance");
  assert.deepEqual(f.calls, ["origin", "version", "section"]);
});

for (const scenario of [
  {
    section: "usage",
    detail: { usageTab: "app" },
    expected: ["section", "version", "usage", "origin"],
  },
  {
    section: "plugin",
    detail: { pluginTab: "user", pluginOrigin: "plugin-store", pluginScopeKey: "fixture" },
    expected: ["section", "version", "plugin", "origin", "scope"],
  },
  {
    section: "modelProvider",
    detail: { modelProviderId: "example-provider" },
    expected: ["section", "version", "origin", "provider"],
  },
]) {
  test(`external ${scenario.section} navigation intent retains its payload and does not dismiss the drawer`, () => {
    assert(pendingIntentListener);
    const calls: string[] = [];
    const payloads: Record<string, unknown> = {};
    const record = (name: string) => (value: unknown) => {
      calls.push(name);
      payloads[name] = value;
    };
    const context = {
      activeSection: "appearance",
      setActiveSettingsSection: (section: string, fallback: string) => {
        assert.equal(fallback, "appearance");
        record("section")(section);
      },
      setSettingsSectionNavigationVersion: (update: (version: number) => number) =>
        record("version")(update(7)),
      setUsageActiveTab: record("usage"),
      resolveSettingsSection: (section: string) => section,
      setPluginTab: record("plugin"),
      setPluginNavigationOrigin: record("origin"),
      setPluginScopeKey: record("scope"),
      setPendingModelProviderTarget: record("provider"),
      handleDismissMobileSidebar: () => calls.push("dismiss"),
    };
    const code = ts.transpileModule(`(${pendingIntentListener})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2024 },
    }).outputText;
    const dispatch = runInNewContext(code, context) as (section: string, detail: unknown) => void;
    dispatch(scenario.section, scenario.detail);
    assert.deepEqual(calls, scenario.expected);
    assert.equal(payloads.section, scenario.section);
    assert.equal(payloads.version, 8);
    if (scenario.section === "usage") assert.equal(payloads.usage, "app");
    if (scenario.section === "plugin") {
      assert.equal(payloads.plugin, "user");
      assert.equal(payloads.origin, "plugin-store");
      assert.equal(payloads.scope, "fixture");
    }
    if (scenario.section === "modelProvider")
      assert.equal((payloads.provider as { providerId: string }).providerId, "example-provider");
  });
}
