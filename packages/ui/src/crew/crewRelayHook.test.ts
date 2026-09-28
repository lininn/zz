import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ICrewService } from "@zcode/services";
import type { CrewExecution, CrewRelayParams } from "@zcode/shared";
import { crewHookHarness } from "./crewHookHarness.js";
import { chatDetail, chatExecution } from "./crewChatFixtures.js";

const params = { groupId: "group", conversationId: "chat", executionId: "exec-a", approved: true };
function service(respondRelay: ICrewService["respondRelay"]) {
  return {
    list: async () => [],
    listConversations: async () => [chatDetail().conversation],
    get: async () => chatDetail(),
    respondRelay,
  } as unknown as ICrewService;
}
test("respondRelay hook targets only current conversation and refreshes its projection", async () => {
  const calls: CrewRelayParams[] = [];
  const hook = crewHookHarness(
    service(async (input) => {
      calls.push(input);
      return chatExecution;
    }),
  );
  const crew = hook.view("group", "chat");
  await setImmediate();
  assert.equal((await crew.respondRelay(params)).ok, true);
  assert.equal((await crew.respondRelay({ ...params, approved: false })).ok, true);
  assert.equal((await crew.respondRelay({ ...params, conversationId: "other" })).ok, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.approved),
    [true, false],
  );
  assert(
    hook.refreshed.some(
      (key) => key[0] === "crew-detail" && key[2] === "group" && key[3] === "chat",
    ),
  );
  hook.unmount();
});
test("late relay response stays on captured scope; conflicting decision gets localized error", async () => {
  const deferred = Promise.withResolvers<CrewExecution>();
  const hook = crewHookHarness(service(() => deferred.promise));
  const crew = hook.view("group", "chat");
  const decision = crew.respondRelay(params);
  hook.view("group", "other");
  deferred.resolve(chatExecution);
  const result = await decision;
  assert.equal(result.ok, true);
  assert.equal(result.isCurrent(), false);
  assert(hook.refreshed.every((key) => key[3] !== "other"));
  hook.unmount();
  for (const key of ["relayNotFound", "relayDecisionConflict"]) {
    const failing = crewHookHarness(
      service(async () => {
        throw new Error(`crew.${key}`);
      }),
    );
    await failing.view("group", "chat").respondRelay(params);
    assert.equal(failing.view("group", "chat").commandError, `error.${key}`);
    failing.unmount();
  }
});
