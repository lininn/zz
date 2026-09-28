import assert from "node:assert/strict";
import test from "node:test";
import type { ReactNode } from "react";
import type { CrewConversation, CrewGroup } from "@zcode/shared";
import type { CrewController } from "../hooks/useCrew.js";
import { CrewSidebarActions } from "./CrewSidebarActions.js";
import { CrewSidebarGroup } from "./CrewSidebarGroup.js";
import { crewSidebarHarness, sidebarElements, sidebarText } from "./crewSidebarHarness.js";

const group: CrewGroup = {
  groupId: "group",
  name: "Crew",
  workspaceBinding: null,
  members: [],
  epoch: 0,
  status: "unbound",
  createdAt: 0,
  updatedAt: 0,
};
const conversation: CrewConversation = {
  groupId: "group",
  conversationId: "created",
  name: "",
  isDefault: false,
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
};
const success = <T,>(value: T, current = true) => ({
  ok: true as const,
  value,
  isCurrent: () => current,
});
const props = {
  group,
  selectedGroupId: null,
  selectedConversationId: null,
  onSelect: (_group: string, _conversation: string) => {},
  onEdit: (_id: string) => {},
  captureNavigation: () => () => true,
};
async function groupHarness(overrides: Partial<CrewController> = {}) {
  const calls: unknown[][] = [];
  const crew = {
    conversations: [],
    pending: false,
    unavailable: false,
    commandError: null,
    createConversation: async () => success(conversation),
    duplicate: async () => success(group),
    remove: async () => success(undefined),
    ...overrides,
  } as CrewController;
  const harness = await crewSidebarHarness("CrewSidebarGroup.tsx", {
    "./CrewSidebarActions.js": { CrewSidebarActions },
    "@/hooks/useCrew.js": {
      useCrew: (...args: unknown[]) => {
        calls.push(args);
        return crew;
      },
    },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
  });
  return { calls, crew, render: (p = props) => harness.render("CrewSidebarGroup", p) };
}
function actions(node: ReactNode) {
  return sidebarElements(node).find((el) => el.type === CrewSidebarActions)!.props as Parameters<
    typeof CrewSidebarActions
  >[0];
}

test("collapsed group reads no detail; expanding and selecting a conversation use exact IDs", async () => {
  const selected: string[][] = [];
  const h = await groupHarness({
    conversations: [conversation, { ...conversation, groupId: "foreign" }],
  });
  const p = { ...props, onSelect: (g: string, c: string) => selected.push([g, c]) };
  let node = h.render(p);
  assert.deepEqual(h.calls[0], ["group", null, false, false]);
  const toggle = sidebarElements(node).find((el) => "aria-expanded" in el.props)!;
  (toggle.props.onClick as () => void)();
  node = h.render(p);
  assert.deepEqual(h.calls.at(-1), ["group", null, true, false]);
  const items = sidebarElements(node).filter((el) => "data-conversation-id" in el.props);
  assert.equal(items.length, 1);
  (items[0]!.props.onClick as () => void)();
  assert.deepEqual(selected, [["group", "created"]]);
});

test("new conversation, duplicate-unbound and edit call existing commands/callbacks", async () => {
  const events: unknown[] = [];
  const h = await groupHarness({
    createConversation: async (params) => {
      events.push(params);
      return success(conversation);
    },
    duplicate: async (params) => {
      events.push(params);
      return success({ ...group, groupId: "copy" });
    },
  });
  const node = h.render({
    ...props,
    onSelect: (g, c) => events.push([g, c]),
    onEdit: (id) => events.push(id),
  });
  await actions(node).onCreate();
  await actions(node).onDuplicate();
  actions(node).onEdit();
  assert.equal(
    JSON.stringify(events),
    JSON.stringify([
      { groupId: "group" },
      ["group", "created"],
      { groupId: "group", name: "copyName:Crew" },
      "copy",
      "group",
    ]),
  );
});

for (const stale of ["service", "navigation", "failure"] as const) {
  test(`${stale} completion cannot select a conversation or open the duplicate editor`, async () => {
    const result =
      stale === "failure"
        ? { ok: false as const, error: "commandError", isCurrent: () => true }
        : success(conversation, stale !== "service");
    let navigations = 0;
    const h = await groupHarness({
      createConversation: async () => result,
      duplicate: async () =>
        stale === "failure" ? (result as never) : success(group, stale !== "service"),
    });
    const node = h.render({
      ...props,
      captureNavigation: () => () => stale !== "navigation",
      onSelect: () => navigations++,
      onEdit: () => navigations++,
    });
    await actions(node).onCreate();
    await actions(node).onDuplicate();
    assert.equal(navigations, 0);
  });
}

test("parent navigation token rejects A -> B -> A and edit, but allows subsequent commands", async () => {
  const h = await crewSidebarHarness("CrewSidebar.tsx", {
    "./CrewSidebarGroup.js": { CrewSidebarGroup },
    "@/hooks/useCrew.js": { useCrew: () => ({ groups: [group] }) },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
  });
  const p = {
    selectedGroupId: "group",
    selectedConversationId: "a",
    onSelect: () => {},
    onEdit: () => {},
  };
  const child = (node: ReactNode) =>
    sidebarElements(node).find((el) => el.type === CrewSidebarGroup)!.props as Parameters<
      typeof CrewSidebarGroup
    >[0];
  const a = child(h.render("CrewSidebar", p));
  const isCurrent = a.captureNavigation();
  h.render("CrewSidebar", { ...p, selectedConversationId: "b" });
  const latest = child(h.render("CrewSidebar", p));
  assert.equal(isCurrent(), false);
  const beforeEdit = latest.captureNavigation();
  latest.onEdit("group");
  h.render("CrewSidebar", p);
  assert.equal(beforeEdit(), false);
  assert.equal(latest.captureNavigation()(), true);
});

test("delete command only runs after explicit confirmation; failed delete keeps dialog and error", async () => {
  const ui = await import("@/components/ui/dropdown-menu.js");
  const dialog = await import("@/components/ui/alert-dialog.js");
  const { Button } = await import("@/components/ui/button.js");
  const h = await crewSidebarHarness("CrewSidebarActions.tsx", {
    "@/components/ui/dropdown-menu.js": ui,
    "@/components/ui/alert-dialog.js": dialog,
    "@/components/ui/button.js": { Button },
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
  });
  let deleted = 0;
  let succeeded = false;
  const p = {
    name: "Crew",
    disabled: false,
    locked: false,
    commandError: "commandError",
    onCreate: async () => {},
    onDuplicate: async () => {},
    onEdit: () => {},
    onDelete: async () => {
      deleted++;
      return succeeded;
    },
  };
  const render = () => h.render("CrewSidebarActions", p);
  let node = render();
  const menuDelete = sidebarElements(node).find(
    (el) => el.type === ui.DropdownMenuItem && el.props.variant === "destructive",
  )!;
  (menuDelete.props.onSelect as () => void)();
  assert.equal(deleted, 0);
  node = render();
  const open = (n: ReactNode) =>
    sidebarElements(n).find((el) => el.type === dialog.AlertDialog)!.props.open;
  assert.equal(open(node), true);
  const confirm = sidebarElements(node).find(
    (el) => el.type === Button && el.props.variant === "destructive",
  )!;
  await (confirm.props.onClick as () => Promise<void>)();
  assert.equal(deleted, 1);
  assert.equal(open(render()), true);
  assert(sidebarElements(render()).some((el) => el.props.role === "alert"));
  succeeded = true;
  await (confirm.props.onClick as () => Promise<void>)();
  assert.equal(open(render()), false);
});

test("busy/recovery group locks edit/delete but not creation or duplication; pending disables menu", async () => {
  const h = await groupHarness();
  for (const status of ["active", "recovery_required"] as const) {
    assert.equal(actions(h.render({ ...props, group: { ...group, status } })).locked, true);
  }
  h.crew.pending = true;
  assert.equal(actions(h.render()).disabled, true);
});

test("menu actions invoke only their matching callbacks and lock destructive/edit actions", async () => {
  const ui = await import("@/components/ui/dropdown-menu.js");
  const h = await crewSidebarHarness("CrewSidebarActions.tsx", {
    "@/components/ui/dropdown-menu.js": ui,
    "@/hooks/useCrewText.js": { useCrewText: () => sidebarText },
  });
  const events: string[] = [];
  const p = {
    name: "Crew",
    disabled: false,
    locked: false,
    commandError: null,
    onCreate: async () => {
      events.push("create");
    },
    onDuplicate: async () => {
      events.push("duplicate");
    },
    onEdit: () => {
      events.push("edit");
    },
    onDelete: async () => {
      events.push("delete");
      return true;
    },
  };
  const menu = () =>
    sidebarElements(h.render("CrewSidebarActions", p)).filter(
      (el) => el.type === ui.DropdownMenuItem,
    );
  for (const item of menu().slice(0, 3)) (item.props.onSelect as () => void)();
  assert.deepEqual(events, ["create", "duplicate", "edit"]);
  p.locked = true;
  assert.deepEqual(
    menu().map((item) => item.props.disabled),
    [false, false, true, true],
  );
  p.disabled = true;
  assert(menu().every((item) => item.props.disabled));
});

test("confirmed deletion forwards the group ID and reports service failure without success", async () => {
  const removed: string[] = [];
  let ok = true;
  const h = await groupHarness({
    remove: async (id) => {
      removed.push(id);
      return ok
        ? success(undefined)
        : { ok: false as const, error: "commandError", isCurrent: () => true };
    },
  });
  assert.equal(await actions(h.render()).onDelete(), true);
  ok = false;
  assert.equal(await actions(h.render()).onDelete(), false);
  assert.deepEqual(removed, ["group", "group"]);
});

test("navigation changing while create is pending does not steal the newly selected conversation", async () => {
  const deferred = Promise.withResolvers<ReturnType<typeof success<CrewConversation>>>();
  let navigation = 0;
  const h = await groupHarness({ createConversation: () => deferred.promise });
  let selected = "a";
  const node = h.render({
    ...props,
    captureNavigation: () => {
      const captured = selected;
      return () => selected === captured;
    },
    onSelect: () => navigation++,
  });
  const creating = actions(node).onCreate();
  selected = "b";
  deferred.resolve(success(conversation));
  await creating;
  assert.equal(navigation, 0);
});
