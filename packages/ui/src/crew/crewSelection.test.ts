import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ICrewService } from "@zcode/services";
import type { CrewConversation, CrewGroupDetail } from "@zcode/shared";
import { crewHookHarness } from "./crewHookHarness.js";

const conversation = (conversationId: string): CrewConversation => ({
  groupId: "group",
  conversationId,
  name: "",
  isDefault: conversationId === "default",
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
});
const detail = (id: string): CrewGroupDetail => ({
  group: {
    groupId: "group",
    name: "Group",
    members: [],
    workspaceBinding: null,
    epoch: 0,
    status: "unbound",
    createdAt: 0,
    updatedAt: 0,
  },
  conversation: conversation(id),
  conversations: [conversation("a"), conversation("default"), conversation("b")],
  resolvedMembers: [],
  messages: [],
  executions: [],
});
function service(overrides: Partial<ICrewService> = {}) {
  return {
    list: async () => [detail("a").group],
    listConversations: async () => detail("a").conversations,
    get: async ({ conversationId }: { conversationId?: string }) => detail(conversationId!),
    ...overrides,
  } as ICrewService;
}

test("group overview discovers isDefault and all reads use explicit owner/group/conversation keys", async () => {
  const gets: string[] = [];
  const hook = crewHookHarness(
    service({
      get: async ({ conversationId }) => {
        gets.push(conversationId!);
        return detail(conversationId!);
      },
    }),
  );
  assert.equal(hook.view("group").detail, undefined);
  await setImmediate();
  hook.view("group");
  await setImmediate();
  assert.equal(hook.view("group").detail?.conversation.conversationId, "default");
  assert.deepEqual(gets, ["default"]);
  assert(hook.reads.every((read) => read.options.keepPreviousData === false));
  const keys = hook.reads.filter((read) => read.key[0] === "crew-detail").map((read) => read.key);
  assert(keys.every((key) => key.length === 4 && key[2] === "group" && key[3] === "default"));
});

test("A -> B immediately hides A and late A reads only populate A cache", async () => {
  const a = Promise.withResolvers<CrewGroupDetail>();
  const b = Promise.withResolvers<CrewGroupDetail>();
  const hook = crewHookHarness(
    service({ get: ({ conversationId }) => (conversationId === "a" ? a.promise : b.promise) }),
  );
  hook.view("group", "a");
  assert.equal(hook.view("group", "b").detail, undefined);
  b.resolve(detail("b"));
  await setImmediate();
  assert.equal(hook.view("group", "b").detail?.conversation.conversationId, "b");
  a.resolve(detail("a"));
  await setImmediate();
  assert.equal(hook.view("group", "b").detail?.conversation.conversationId, "b");
  assert.equal(hook.view("group", "a").detail?.conversation.conversationId, "a");
});

test("a cached prior board is hidden when switching to an uncached selection", async () => {
  const b = Promise.withResolvers<CrewGroupDetail>();
  const hook = crewHookHarness(
    service({
      get: ({ conversationId }) =>
        conversationId === "b" ? b.promise : Promise.resolve(detail("a")),
    }),
  );
  hook.view("group", "a");
  await setImmediate();
  assert.equal(hook.view("group", "a").detail?.conversation.conversationId, "a");
  assert.equal(hook.view("group", "b").detail, undefined);
  b.resolve(detail("b"));
  await setImmediate();
});

test("late command failure cannot leak pending/error state or refresh B's detail", async () => {
  const deferred = Promise.withResolvers<never>();
  const hook = crewHookHarness(service({ send: () => deferred.promise }));
  const original = hook.view("group", "a");
  const send = original.send({
    groupId: "group",
    conversationId: "a",
    messageId: "message",
    text: "A",
    mentions: [],
  });
  assert.equal(hook.view("group", "a").pending, true);
  assert.equal(hook.view("group", "b").pending, false);
  deferred.reject(new Error("crew.workspaceBusy"));
  const result = await send;
  assert.equal(result.ok, false);
  assert.equal(result.isCurrent(), false);
  assert.equal(hook.view("group", "b").commandError, null);
  assert(!hook.refreshed.some((key) => key[0] === "crew-detail" && key[3] === "b"));
  assert(hook.refreshed.some((key) => key[0] === "crew-detail" && key[3] === "a"));
});

test("stale handlers and foreign conversation commands cannot reach the service", async () => {
  let commands = 0;
  const hook = crewHookHarness(
    service({
      cancel: async () => {
        commands++;
        throw new Error("unexpected");
      },
    }),
  );
  const a = hook.view("group", "a");
  const b = hook.view("group", "b");
  await a.cancel({ groupId: "group", conversationId: "a", executionId: "execution" });
  await b.cancel({ groupId: "group", conversationId: "a", executionId: "execution" });
  assert.equal(commands, 0);
  assert.equal(hook.view("group", "b").commandError, "error.conversationNotFound");
});

test("late create completion cannot navigate after selection change, tab exit or unmount", async () => {
  for (const leave of ["selection", "tab", "unmount"]) {
    const deferred = Promise.withResolvers<CrewConversation>();
    const hook = crewHookHarness(service({ createConversation: () => deferred.promise }));
    const a = hook.view("group", "a");
    const created = a.createConversation({ groupId: "group" });
    if (leave === "selection") hook.view("group", "b");
    else if (leave === "tab") hook.view("group", "a", false);
    else hook.unmount();
    deferred.resolve(conversation("new"));
    const result = await created;
    assert.equal(result.ok, true);
    assert.equal(result.isCurrent(), false);
  }
});

test("missing conversation read is localized and never falls back to default", async () => {
  const gets: string[] = [];
  const hook = crewHookHarness(
    service({
      get: async ({ conversationId }) => {
        gets.push(conversationId!);
        throw new Error("crew.conversationNotFound");
      },
    }),
  );
  hook.view("group", "missing");
  await setImmediate();
  const view = hook.view("group", "missing");
  assert.equal(view.detail, undefined);
  assert.equal(view.readError, true);
  assert.equal(view.readErrorKey, "error.conversationNotFound");
  assert.deepEqual(gets, ["missing"]);
});

test("home and settings share cache keys only within the same service instance", () => {
  const endpoint = service();
  const home = crewHookHarness(endpoint);
  const settings = crewHookHarness(endpoint);
  const remote = crewHookHarness(service());
  home.view(null);
  settings.view(null);
  remote.view(null);
  assert.equal(home.reads[0]!.key[1], settings.reads[0]!.key[1]);
  assert.notEqual(home.reads[0]!.key[1], remote.reads[0]!.key[1]);
});

test("sidebar only requests conversation lists and hidden views do not read", async () => {
  const hook = crewHookHarness(service());
  hook.view("group", null, true, false);
  await setImmediate();
  hook.view("group", null, true, false);
  assert(hook.reads.every(({ key }) => key[0] === "crew-conversations"));
  const count = hook.reads.length;
  hook.view("group", null, false);
  assert.equal(hook.reads.length, count);
});

test("creating from the list invalidates that group's conversation projection", async () => {
  const hook = crewHookHarness(service({ createConversation: async () => conversation("new") }));
  await hook.view(null).createConversation({ groupId: "group" });
  await setImmediate();
  assert(hook.refreshed.some((key) => key[0] === "crew-conversations" && key[2] === "group"));
});

test("group deletion invalidates all open conversations and hides the obsolete detail", async () => {
  let deleted = false;
  const hook = crewHookHarness(
    service({
      get: async ({ conversationId }) => {
        if (deleted) throw new Error("crew.groupNotFound");
        return detail(conversationId!);
      },
      delete: async () => {
        deleted = true;
      },
    }),
  );
  hook.view("group", "a");
  await setImmediate();
  hook.view("group", "b");
  await setImmediate();
  const crew = hook.view("group", "b");
  await crew.remove("group");
  await setImmediate();
  assert(hook.refreshed.some((key) => key[0] === "crew-detail" && key[3] === "a"));
  assert.equal(hook.view("group", "b").detail, undefined);
  assert.equal(hook.view("group", "b").readError, true);
});

test("visible idle projections keep bounded polling to discover other clients' new activity", () => {
  const hook = crewHookHarness(service());
  hook.view(null);
  hook.view("group", "a");
  for (const read of hook.reads) {
    const interval = read.options.refreshInterval as (value: unknown) => number;
    assert.equal(interval(read.key[0] === "crew-detail" ? detail("a") : []), 5000);
    assert.equal(read.options.refreshWhenHidden, false);
  }
});

test("covering the workspace pauses reads but retains the cached conversation for its draft", async () => {
  const hook = crewHookHarness(service());
  hook.view("group", "a");
  await setImmediate();
  const before = hook.view("group", "a").detail;
  const count = hook.reads.length;
  assert.equal(hook.view("group", "a", false).detail, before);
  assert.equal(hook.reads.length, count);
  assert.equal(hook.view("group", "b", false).detail, undefined);
});

test("reopening a covered cached conversation refreshes immediately instead of waiting for polling", async () => {
  const hook = crewHookHarness(service());
  hook.view("group", "a");
  await setImmediate();
  hook.view("group", "a", false);
  hook.view("group", "a", true);
  assert(hook.refreshed.some((key) => key[0] === "crew-detail" && key[3] === "a"));
});
