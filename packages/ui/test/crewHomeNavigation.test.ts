import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const shell = await readFile(
  new URL("../src/app-shell/WorkspaceShellLayout.tsx", import.meta.url),
  "utf8",
);
const sidebar = await readFile(new URL("../src/WorkspaceSidebar.tsx", import.meta.url), "utf8");
function callback(source: string, name: string, context: Record<string, unknown>) {
  const ast = ts.createSourceFile(
    "component.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let body = "";
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      body = node.initializer.arguments[0]!.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(body, `Missing actual callback: ${name}`);
  const code = ts.transpileModule(`const fn = ${body}; fn;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2024 },
  }).outputText;
  return runInNewContext(code, context) as (...args: string[]) => void;
}

for (const mobile of [false, true])
  test(`crew selection preserves exact IDs and dismisses only mobile drawer (${mobile})`, () => {
    const events: unknown[] = [];
    callback(shell, "selectCrewConversation", {
      crewHome: { select: (...ids: string[]) => events.push(ids) },
      onWorkspaceMainViewChange: (view: string) => events.push(view),
      isMobileSidebar: mobile,
      isSidebarVisible: true,
      handleToggleSidebar: () => events.push("close"),
    })("group-A", "conversation-B");
    assert.deepEqual(
      events,
      mobile
        ? [["group-A", "conversation-B"], "crew", "close"]
        : [["group-A", "conversation-B"], "crew"],
    );
  });

test("crew primary tab does not overwrite task grouping preference", () => {
  const events: unknown[] = [];
  callback(sidebar, "handlePrimaryTaskModeChange", {
    onCrewViewChange: (active: boolean) => events.push(active),
    setIsFileTreeOpen: (open: boolean) => events.push(open),
    setTaskOrganizeBy: () => {
      throw new Error("Crew is not task grouping");
    },
  })("crew");
  assert.deepEqual(events, [true, false]);
});

test("leaving crew restores the existing grouped tab command", () => {
  const events: unknown[] = [];
  callback(sidebar, "handlePrimaryTaskModeChange", {
    onCrewViewChange: (active: boolean) => events.push(active),
    setTaskOrganizeBy: (mode: string) => events.push(mode),
    setGroupedTaskGroupIdsHydrated: (value: boolean) => events.push(value),
    logger: { debug() {} },
    taskOrganizeBy: "project",
    groupedTaskGroupIdsHydrated: true,
    groupedTaskGroupIds: [],
    lastNonEmptyGroupedTaskGroupIds: [],
  })("grouped");
  assert.deepEqual(events, [false, false, "grouped"]);
});

for (const mobile of [false, true])
  for (const visible of [false, true])
    test(`crew create enters main editor before dismissing open mobile drawer (${mobile}/${visible})`, () => {
      const events: string[] = [];
      callback(shell, "createCrewGroup", {
        crewHome: { create: () => events.push("create") },
        onWorkspaceMainViewChange: (view: string) => events.push(view),
        isMobileSidebar: mobile,
        isSidebarVisible: visible,
        handleToggleSidebar: () => events.push("close"),
      })();
      assert.deepEqual(
        events,
        mobile && visible ? ["create", "crew", "close"] : ["create", "crew"],
      );
    });

test("shell connects sidebar create to main editor separately from settings", () => {
  assert.match(shell, /onCreate=\{createCrewGroup\}/);
  assert.match(shell, /onManage=\{openCrewSettings\}/);
});
