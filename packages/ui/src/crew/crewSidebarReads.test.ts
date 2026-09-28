import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ICrewService } from "@zcode/services";
import type { CrewConversation } from "@zcode/shared";
import { crewHookHarness } from "./crewHookHarness.js";

const conversation = (groupId: string): CrewConversation => ({
  groupId,
  conversationId: "default",
  name: "",
  isDefault: true,
  status: "idle",
  createdAt: 0,
  updatedAt: 0,
});

test("many collapsed groups never fetch; expanded groups use shared conversation keys without detail/preflight", async () => {
  const reads: string[] = [];
  const service = {
    list: async () => {
      reads.push("list");
      return [];
    },
    listConversations: async ({ groupId }: { groupId: string }) => {
      reads.push(groupId);
      return [conversation(groupId)];
    },
    get: async () => {
      throw new Error("Tree must not preflight via detail");
    },
  } as unknown as ICrewService;
  const list = crewHookHarness(service);
  list.view(null);
  const collapsed = Array.from({ length: 20 }, (_, i) => {
    const hook = crewHookHarness(service);
    hook.view(`group-${i}`, null, false, false);
    return hook;
  });
  await setImmediate();
  assert.deepEqual(reads, ["list"]);
  assert(collapsed.every((hook) => hook.reads.length === 0));
  const expanded = collapsed[0]!;
  expanded.view("group-0", null, true, false);
  await setImmediate();
  assert.equal(expanded.view("group-0", null, true, false).conversations.length, 1);
  assert.deepEqual(reads, ["list", "group-0"]);
  assert(expanded.reads.every((read) => read.key[0] === "crew-conversations"));
  const main = crewHookHarness(service);
  main.view("group-0", "default", true, false);
  assert.deepEqual([...expanded.reads[0]!.key], [...main.reads[0]!.key]);
  assert.equal(list.reads[0]!.key[1], expanded.reads[0]!.key[1]);
  const other = crewHookHarness({ ...service } as ICrewService);
  other.view("group-0", null, true, false);
  assert.notEqual(other.reads[0]!.key[1], expanded.reads[0]!.key[1]);
});

test("collapsing stops polling and stale create result cannot navigate after scope change", async () => {
  const deferred = Promise.withResolvers<CrewConversation>();
  const hook = crewHookHarness({
    listConversations: async () => [{ ...conversation("group"), status: "active" }],
    createConversation: () => deferred.promise,
  } as unknown as ICrewService);
  const crew = hook.view("group", null, true, false);
  await setImmediate();
  const refreshInterval = hook.reads[0]!.options.refreshInterval as (
    items: CrewConversation[],
  ) => number;
  assert.equal(refreshInterval([{ ...conversation("group"), status: "active" }]), 2500);
  const creating = crew.createConversation({ groupId: "group" });
  const readCount = hook.reads.length;
  hook.view("group", null, false, false);
  assert.equal(hook.reads.length, readCount);
  deferred.resolve(conversation("group"));
  const result = await creating;
  assert.equal(result.ok, true);
  assert.equal(result.isCurrent(), false);
  assert(hook.refreshed.every((key) => key[0] !== "crew-detail"));
});
