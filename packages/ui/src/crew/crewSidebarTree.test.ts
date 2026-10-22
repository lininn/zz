import assert from "node:assert/strict";
import test from "node:test";
import type { CrewConversation, CrewGroup } from "@zcode/shared";
import { crewSidebarConversations, crewSidebarTree } from "./crewSidebarTree.js";

const group = (groupId: string, workspaceBinding: CrewGroup["workspaceBinding"]): CrewGroup => ({
  groupId,
  name: groupId,
  announcement: "",
  workspaceBinding,
  members: [],
  epoch: 0,
  status: workspaceBinding ? "idle" : "unbound",
  createdAt: 0,
  updatedAt: 0,
});

test("workspace identities isolate equal paths and merge aliases without mutating list order", () => {
  const groups = [
    group("a", { workspacePath: "/same", workspaceIdentity: " remote-a " }),
    group("b", { workspacePath: "/same", workspaceIdentity: "remote-b" }),
    group("c", { workspacePath: "/alias", workspaceIdentity: "remote-a" }),
    group("local", { workspacePath: "/same" }),
    group("fallback", { workspacePath: "/same", workspaceIdentity: "  " }),
  ];
  const before = structuredClone(groups);
  const tree = crewSidebarTree(groups);
  assert.deepEqual(
    tree.map(({ key, groups }) => [key, groups.map(({ groupId }) => groupId)]),
    [
      ["remote-a", ["a", "c"]],
      ["remote-b", ["b"]],
      ["/same", ["local", "fallback"]],
    ],
  );
  assert.equal(tree[0]?.workspacePath, "/same");
  assert.deepEqual(groups, before);
});

test("unbound bucket cannot collide with a bound identity or path called unbound", () => {
  const tree = crewSidebarTree([
    group("draft", null),
    group("bound", { workspacePath: "unbound" }),
    group("draft-two", null),
    group("windows", { workspacePath: "C:\\work\\repo" }),
  ]);
  assert.deepEqual(
    tree.map(({ key }) => key),
    [null, "unbound", "C:\\work\\repo"],
  );
  assert.deepEqual(
    tree[0]?.groups.map(({ groupId }) => groupId),
    ["draft", "draft-two"],
  );
  assert.deepEqual(crewSidebarTree([]), []);
});

test("conversation projection isolates group even when IDs collide, preserving failed status/order", () => {
  const base: CrewConversation = {
    groupId: "a",
    conversationId: "same",
    name: "",
    isDefault: true,
    status: "failed",
    createdAt: 0,
    updatedAt: 0,
  };
  const items = [
    base,
    { ...base, groupId: "b", name: "Foreign history" },
    { ...base, conversationId: "second", isDefault: false, status: "active" as const },
  ];
  assert.deepEqual(crewSidebarConversations(items, "a"), [items[0], items[2]]);
  assert.deepEqual(crewSidebarConversations(items, "absent"), []);
  assert.equal(items.length, 3);
});
