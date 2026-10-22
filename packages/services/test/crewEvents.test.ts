import assert from "node:assert/strict";
import test from "node:test";
import { handoff, relayFixture } from "./crewRelayFixture.js";

test("approval and block events stay separate from chat messages and are idempotent", async () => {
  const f = await relayFixture({ mode: "manual", reply: () => handoff("Developer") });
  try {
    const root = await f.start();
    assert.equal(root.relay?.status, "awaiting_user_approval");
    const events = () => f.store.events(f.group.groupId, f.scope.conversationId);
    assert.deepEqual(
      events().map((event) => [event.kind, event.text]),
      [["event", "relay.planTitle"]],
    );

    f.expireRoot(root);
    const blocked = await f.respond(root);
    assert.equal(blocked.relay?.status, "blocked");
    assert.equal(blocked.relay?.reason, "relayBudgetExceeded");
    assert.deepEqual(
      events()
        .map((event) => event.text)
        .sort(),
      ["error.relayBudgetExceeded", "relay.planTitle"],
    );

    const detail = await f.service.get(f.scope);
    assert.ok(detail.messages.every((message) => message.kind === "chat"));
    assert.equal(detail.events?.length, 2);

    // 重复响应已熔断的交接不能再刷事件。
    await f.respond(blocked);
    assert.equal(events().length, 2);
  } finally {
    await f.close();
  }
});
