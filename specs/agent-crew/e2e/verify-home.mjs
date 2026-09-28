// Real CrewSidebar/CrewHome components; in-memory service, NOT production runtime E2E.
import assert from "node:assert/strict";
const task = await taskSpace(
  process.env.CREW_E2E_SPACE_ID
    ? Number(process.env.CREW_E2E_SPACE_ID)
    : "Crew homepage component E2E",
);
console.log({ spaceId: task.spaceId });
const page = task.page("p1");
await page.goto(process.env.CREW_E2E_URL ?? "file:///tmp/crew-home-browser/index.html");
await page.waitForSelector("loc=css:[data-crew-group-id] > div > button:first-child");
await page.click("loc=css:[data-crew-group-id] > div > button:first-child");
await page.waitForSelector("loc=css:button[data-conversation-id]");
await page.click("loc=css:button[data-conversation-id]");
await page.waitForSelector("loc=css:[data-testid='crew-chat']");
await page.click("loc=role:button[name='Show execution details for Fixture approval agent']");
await page.waitForSelector("loc=css:[data-testid='crew-external-detail']");
assert(
  (await page.evaluate(() => document.body.innerText)).includes("Detailed process unavailable"),
);
await page.click("loc=role:button[name='Hide execution details for Fixture approval agent']");
assert.equal(
  await page.evaluate(
    () => document.querySelectorAll("[data-testid='crew-external-detail']").length,
  ),
  0,
);
// Memory fixture only: recovery/cancel must keep exact conversation targeting.
await page.click("loc=role:button[name='Check recovery']");
await page.waitForFunction(() =>
  window.crewFixtureControl.state().calls.some((call) => call.kind === "recover"),
);
await page.click("loc=role:button[name='Cancel']");
await page.waitForFunction(() =>
  window
    .crewFixtureState()
    .conversations.some((entry) =>
      entry.executions.some((execution) => execution.status === "cancelled"),
    ),
);
const commands = await page.evaluate(() =>
  window.crewFixtureControl
    .state()
    .calls.filter((call) => ["recover", "cancel"].includes(call.kind)),
);
assert.equal(commands.length, 2);
assert.equal(commands[0].groupId, commands[1].groupId);
assert.equal(commands[0].conversationId, commands[1].conversationId);
await page.fill("loc=role:textbox[name='Board message']", "Homepage conversation message");
await page.click("loc=role:button[name='Send']");
await page.waitForFunction(() =>
  document
    .querySelector("[data-testid='crew-chat']")
    ?.textContent?.includes("Homepage conversation message"),
);
// The source service is a fixture; this explicitly checks copy-without-history semantics.
const before = await page.evaluate(() => window.crewFixtureState());
await page.click("loc=role:button[name='Actions for Homepage fixture crew']");
await page.click("loc=role:menuitem[name='Copy as unbound crew']");
await page.waitForFunction(() => window.crewFixtureState().groups.length === 2);
const after = await page.evaluate(() => window.crewFixtureState());
const copy = after.groups.find((group) => group.groupId !== before.groups[0].groupId);
assert.equal(copy.workspaceBinding, null);
assert(
  after.conversations
    .filter((entry) => entry.conversation.groupId === copy.groupId)
    .every((entry) => entry.messages.length === 0 && entry.executions.length === 0),
);
console.log("Crew homepage component interaction passed; no live runtime was used.");
