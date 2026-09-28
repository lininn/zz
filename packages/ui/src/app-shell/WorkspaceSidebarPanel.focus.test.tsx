import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { MobileWorkspaceSidebarToggle } from "./MobileWorkspaceSidebarToggle.js";
import { WorkspaceSidebarPanel } from "./WorkspaceSidebarPanel.js";

const text = await readFile(new URL("./WorkspaceSidebarPanel.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile(
  "WorkspaceSidebarPanel.tsx",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let effect: string | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect")
    effect = node.arguments[0]!.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert(effect);
const effectCode = ts.transpileModule(`(${effect})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2024 },
}).outputText;

function mountEffect({
  panelId = "sidebar",
  inert = false,
  focusedInside = false,
  mobile = true,
  visible = true,
} = {}) {
  const calls: string[] = [];
  let listener: ((event: { key: string; defaultPrevented?: boolean }) => void) | undefined;
  const context = {
    mobile,
    visible,
    panelId,
    onDismiss: () => calls.push("dismiss"),
    elementRef: { current: { closest: () => (inert ? {} : null), contains: () => focusedInside } },
    document: {
      activeElement: {},
      querySelectorAll: () =>
        ["sidebar", "settings-sidebar"].map((id) => ({
          getAttribute: (name: string) => (name === "aria-controls" ? id : null),
          focus: () => calls.push(`focus:${id}`),
        })),
      addEventListener: (name: string, handler: typeof listener) => {
        assert.equal(name, "keydown");
        listener = handler;
      },
      removeEventListener: (name: string, handler: typeof listener) => {
        assert.equal(name, "keydown");
        assert.equal(handler, listener);
        listener = undefined;
      },
    },
  };
  const run = runInNewContext(effectCode, context) as () => (() => void) | undefined;
  const cleanup = run();
  return {
    calls,
    cleanup,
    key: (key: string, defaultPrevented = false) => listener?.({ key, defaultPrevented }),
    listener: () => listener,
  };
}

test("mounted workspace and settings panels have separate controls/IDs", () => {
  const html = renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <div inert>
        <MobileWorkspaceSidebarToggle visible onToggle={() => {}} />
        <WorkspaceSidebarPanel visible mobile onDismiss={() => {}}>
          Workspace
        </WorkspaceSidebarPanel>
      </div>
      <MobileWorkspaceSidebarToggle panelId="settings-sidebar" visible onToggle={() => {}} />
      <WorkspaceSidebarPanel panelId="settings-sidebar" visible mobile onDismiss={() => {}}>
        Settings
      </WorkspaceSidebarPanel>
    </ZCodeIntlProvider>,
  );
  assert.equal((html.match(/id="sidebar"/g) ?? []).length, 1);
  assert.equal((html.match(/id="settings-sidebar"/g) ?? []).length, 1);
  assert.match(html, /aria-controls="sidebar"/);
  assert.match(html, /aria-controls="settings-sidebar"/);
});

for (const panelId of ["sidebar", "settings-sidebar"]) {
  test(`Escape restores the matching toggle (${panelId})`, () => {
    const f = mountEffect({ panelId });
    f.key("Escape");
    assert.deepEqual(f.calls, ["dismiss", `focus:${panelId}`]);
    f.cleanup!();
    assert.equal(f.listener(), undefined);
  });
  test(`navigation/backdrop cleanup restores focus from its own panel (${panelId})`, () => {
    const f = mountEffect({ panelId, focusedInside: true });
    f.cleanup!();
    assert.deepEqual(f.calls, [`focus:${panelId}`]);
  });
}

test("inert workspace background ignores Escape while settings handles it", () => {
  const background = mountEffect({ inert: true });
  const settings = mountEffect({ panelId: "settings-sidebar" });
  background.key("Escape");
  settings.key("Escape");
  assert.deepEqual(background.calls, []);
  assert.deepEqual(settings.calls, ["dismiss", "focus:settings-sidebar"]);
  background.cleanup!();
  settings.cleanup!();
});

test("prevented Escape and other keys do not close a panel", () => {
  const f = mountEffect();
  f.key("Escape", true);
  f.key("Enter");
  assert.deepEqual(f.calls, []);
  f.cleanup!();
});

for (const flags of [
  { mobile: false, visible: true },
  { mobile: true, visible: false },
]) {
  test(`desktop/hidden panel does not install Escape listener (${JSON.stringify(flags)})`, () => {
    const f = mountEffect(flags);
    assert.equal(f.listener(), undefined);
    assert.equal(f.cleanup, undefined);
  });
}
