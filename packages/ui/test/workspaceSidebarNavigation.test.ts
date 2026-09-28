import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { transitionWorkspaceSidebar } from "../src/hooks/useWorkspaceSidebar.js";

// 执行 shell 中真实的导航回调，而不是在测试里复制“导航后关闭”。
// 只提取 useCallback 的函数体并注入其依赖；不加载整棵 App 或启动服务。
const source = ts.createSourceFile(
  "WorkspaceShellLayout.tsx",
  await readFile(new URL("../src/app-shell/WorkspaceShellLayout.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const callbacks = new Map<string, string>();
const sidebarBindings = new Map<string, string>();
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(source) === "useCallback"
  ) {
    callbacks.set(node.name.text, node.initializer.arguments[0]!.getText(source));
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "WorkspaceSidebar") {
    for (const prop of node.attributes.properties) {
      if (ts.isJsxAttribute(prop) && prop.initializer && ts.isJsxExpression(prop.initializer)) {
        sidebarBindings.set(
          prop.name.getText(source),
          prop.initializer.expression!.getText(source),
        );
      }
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);

function fixture(isMobile: boolean, visible = true, accepted = true, readOnly = false) {
  let visibility = { isMobile, visible };
  const calls: { kind: string; args: unknown[] }[] = [];
  const record =
    (kind: string) =>
    (...args: unknown[]) => {
      calls.push({ kind, args });
    };
  const context: Record<string, unknown> = {
    workspaceReadOnlyReason: readOnly ? "readonly" : undefined,
    showChatMainView: record("chat"),
    onCreateTask: record("new-task"),
    onCreateConversationTask: record("conversation"),
    handleSelectTask: record("task"),
    handleStartDraftInWorkspace: record("workspace"),
    handleDismissMobileSidebar: () => {
      calls.push({ kind: "dismiss", args: [] });
      visibility = transitionWorkspaceSidebar(visibility, { type: "navigate" });
    },
    ensureTaskNavigationWorkspace: () => ({ accepted, openedLocalTab: false }),
    tabStoreApi: { getState: () => ({ activateTabByPath: () => {}, addTab: () => {} }) },
    workspaceTabs: [],
    shellWorkbenchBinding: null,
    selectWorkbenchSession: record("placement"),
    logger: { warn: record("warn"), info: record("info") },
    toast: record("toast"),
    intl: { formatMessage: () => "navigation failed" },
  };
  const compile = (name: string) => {
    assert(callbacks.has(name), `missing production callback: ${name}`);
    const js = ts.transpileModule(`(${callbacks.get(name)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2024, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    return runInNewContext(js, context) as (...args: unknown[]) => void;
  };
  context.handleStartDraftInWorkspaceInChat = compile("handleStartDraftInWorkspaceInChat");
  context.handleCreateTaskInChat = compile("handleCreateTaskInChat");
  return { compile, calls, context, visible: () => visibility.visible };
}

test("rendered sidebar routes use the tested production callbacks", () => {
  assert.equal(sidebarBindings.get("onSelectTask"), "handleSelectTaskInChat");
  assert.equal(sidebarBindings.get("onStartDraftInWorkspace"), "handleCreateProjectDraft");
  assert.equal(sidebarBindings.get("onCreateTask"), "handleCreateTaskInChat");
  assert.equal(
    sidebarBindings.get("onCreateConversationTask"),
    "handleSidebarCreateConversationTask",
  );
});

const routes = [
  {
    callback: "handleCreateProjectDraft",
    kind: "workspace",
    args: ["/workspace", "remote-identity"],
  },
  {
    callback: "handleSelectTaskInChat",
    kind: "task",
    args: ["/workspace", "task-a", "remote-identity", "remote-session", 42],
  },
  {
    callback: "handleCreateTaskInChat",
    kind: "new-task",
    args: [{ groupedDraftPlacement: { type: "top" } }],
  },
  { callback: "handleSidebarCreateConversationTask", kind: "conversation", args: [] },
];
for (const route of routes) {
  for (const isMobile of [true, false]) {
    test(`${route.callback} dispatches before dismissal and preserves desktop state (mobile=${isMobile})`, () => {
      const f = fixture(isMobile);
      f.compile(route.callback)(...route.args);
      assert.equal(f.visible(), !isMobile);
      assert(
        f.calls.findIndex((call) => call.kind === route.kind) <
          f.calls.findIndex((call) => call.kind === "dismiss"),
      );
      const dispatched = f.calls.find((call) => call.kind === route.kind)!;
      assert(dispatched);
      if (route.kind === "workspace") {
        assert.deepEqual(dispatched.args, ["/workspace", "remote-identity", undefined, "project"]);
      } else if (route.kind === "task") {
        assert.deepEqual(dispatched.args, ["/workspace", "task-a", "remote-identity", 42]);
        const target = f.calls.find((call) => call.kind === "placement")!.args[1] as Record<
          string,
          unknown
        >;
        assert.equal(target.workspaceIdentity, "remote-identity");
        assert.equal(target.remoteSessionId, "remote-session");
      } else if (route.kind === "new-task") assert.equal(dispatched.args[0], route.args[0]);
      const hiddenDesktop = fixture(false, false);
      hiddenDesktop.compile(route.callback)(...route.args);
      assert.equal(hiddenDesktop.visible(), false);
    });
  }
}

test("rejected remote workspace navigation does not dismiss the drawer", () => {
  const f = fixture(true, true, false);
  f.compile("handleSelectTaskInChat")("/workspace", "task", "remote-identity");
  assert.equal(f.visible(), true);
  assert.deepEqual(
    f.calls.map((call) => call.kind),
    ["warn", "toast"],
  );
});

test("read-only new-task rejection does not dismiss the drawer", () => {
  const f = fixture(true, true, true, true);
  f.compile("handleCreateTaskInChat")();
  assert.equal(f.visible(), true);
  assert.equal(f.calls.length, 0);
});

for (const readOnly of [false, true]) {
  test(`conversation fallback reuses new-task acceptance and dismisses only once (readOnly=${readOnly})`, () => {
    const f = fixture(true, true, true, readOnly);
    f.context.onCreateConversationTask = undefined;
    f.compile("handleSidebarCreateConversationTask")();
    assert.equal(f.visible(), readOnly);
    assert.equal(f.calls.filter((call) => call.kind === "dismiss").length, readOnly ? 0 : 1);
  });
}
