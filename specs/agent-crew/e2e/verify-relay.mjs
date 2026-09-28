// Real UI/hooks + controlled in-memory service. No model dispatch, Host or production CSS.
import assert from "node:assert/strict";
const task = await taskSpace(
  process.env.CREW_E2E_SPACE_ID
    ? Number(process.env.CREW_E2E_SPACE_ID)
    : "Crew relay component E2E",
);
console.log({ spaceId: task.spaceId });
const page = task.page("p1");
const url = new URL(process.env.CREW_E2E_URL ?? "file:///tmp/crew-relay-browser/index.html");
url.searchParams.set("relay", "1");
await page.goto(url.href);
await page.waitForSelector("loc=css:[data-crew-group-id] > div > button:first-child");
await page.click("loc=css:[data-crew-group-id] > div > button:first-child");
await page.waitForSelector("loc=css:button[data-conversation-id]");
await page.click("loc=css:button[data-conversation-id]");
await page.waitForSelector("loc=css:[data-testid='crew-relay-plan']");
const initial = await page.evaluate(() => window.crewFixtureState());
assert.equal(initial.groups[0].relayMode, "auto");
assert.equal(initial.conversations[0].executions.length, 1, "auto still needs root-plan approval");
assert.equal(initial.conversations[0].conversation.status, "awaiting_user_approval");
assert.equal(
  await page.evaluate(() => {
    const card = document.querySelector("[data-testid='crew-relay-plan']");
    const row = document.querySelector("[data-testid='crew-execution-row']");
    return Boolean(card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
  }),
  true,
);
assert(!(await page.evaluate(() => document.body.innerText)).includes("not-a-command"));
await page.click("loc=role:button[name='Approve and start']");
await page.waitForFunction(
  () => window.crewFixtureState().conversations[0].executions.length === 2,
);
await page.waitForSelector("loc=css:[data-relay-status='dispatched']");
await page.waitForFunction(
  () =>
    document.querySelector("[data-testid='crew-message-group'][data-sender='system'] header")
      ?.textContent === "System",
);
await page.click("loc=role:button[name='Pause relay']");
await page.waitForFunction(() => window.crewFixtureState().groups[0].relayPaused === true);
assert.equal((await page.evaluate(() => window.crewFixtureState())).groups[0].status, "active");
await page.click("loc=role:button[name='Resume relay']");
await page.waitForFunction(() => window.crewFixtureState().groups[0].relayPaused === false);
let state = await page.evaluate(() => window.crewFixtureState());
assert.equal(
  state.calls.filter((call) => call.kind === "respondRelay").length,
  1,
  "resume is not approval",
);
for (const call of state.calls.filter((call) => call.kind === "update")) {
  assert.deepEqual(Object.keys(call).sort(), ["groupId", "kind", "relayPaused"]);
}
await page.click("loc=role:button[name='Cancel']");
await page.waitForFunction(() => window.crewFixtureState().groups[0].status === "idle");
// Actual editor callbacks for mode/K/time; safe fixture only.
await page.click("loc=role:button[name='Actions for Homepage fixture crew']");
await page.click("loc=role:menuitem[name='Edit']");
await page.waitForSelector("loc=css:[data-testid='crew-editor']");
await page.click("loc=role:combobox[name='Relay mode']");
await page.click("loc=role:option[name='Semi-automatic']");
await page.fill("loc=role:spinbutton[name='Automatic hops K (0–8)']", "1");
await page.fill("loc=role:spinbutton[name='Time budget (minutes)']", "20");
await page.click("loc=role:button[name='Save']");
await page.waitForFunction(() => {
  const group = window.crewFixtureState().groups[0];
  return group.relayMode === "semi" && group.relayAutoHops === 1 && group.relayBudgetMinutes === 20;
});
await page.waitForSelector("loc=css:[data-testid='crew-chat']");
const seed = async (options = {}) =>
  page.evaluate((input) => {
    const group = window.crewFixtureState().groups[0];
    return window.crewFixtureControl.seedRelay({
      groupId: group.groupId,
      conversationId: group.groupId,
      ...input,
    });
  }, options);
// Injection changes only service projection; actual hook polling supplies UI updates.
const rejected = await seed();
await page.waitForSelector("loc=css:[data-testid='crew-relay-plan']");
await page.click("loc=role:button[name='Reject']");
await page.waitForFunction(
  () => window.crewFixtureState().conversations[0].executions[0].relay.status === "rejected",
);
state = await page.evaluate(() => window.crewFixtureState());
assert.equal(state.conversations[0].executions.length, 1);
assert.equal(
  state.calls.filter((call) => call.kind === "respondRelay").at(-1).executionId,
  rejected.executionId,
);
const handoff = await seed({ hop: 1 });
await page.waitForSelector("loc=role:button[name='Approve handoff']");
assert.equal(
  await page.evaluate(() => document.querySelectorAll("[data-testid='crew-relay-plan']").length),
  0,
);
await page.click("loc=role:button[name='Approve handoff']");
await page.waitForFunction(
  () => window.crewFixtureState().conversations[0].executions.length === 2,
);
state = await page.evaluate(() => window.crewFixtureState());
const decision = state.calls.filter((call) => call.kind === "respondRelay").at(-1);
assert.equal(decision.executionId, handoff.executionId);
assert.equal(decision.conversationId, initial.groups[0].groupId);
assert.equal(decision.approved, true);
await seed({ hop: 1, status: "dispatched", automatic: true });
await page.waitForSelector("loc=css:[data-testid='crew-relay-automatic']");
assert(
  (await page.evaluate(() => document.body.innerText)).includes(
    "Fixture builder → Fixture reviewer",
  ),
);
await seed({ hop: 8, status: "blocked", reason: "relayHopLimit" });
await page.waitForFunction(() =>
  document.body.innerText.includes("Relay stopped: the maximum of 8 hops has been reached."),
);
assert.equal(
  await page.evaluate(
    () => document.querySelectorAll("[data-testid='crew-relay-card'] button").length,
  ),
  0,
);
console.log(
  "Relay offline UI/hook callbacks passed; not production runtime/Host or mobile visual E2E.",
);
