// Execute with ego-browser nodejs; taskSpace is provided by that runtime.
// The HTML uses production React components/hooks and explicitly fake in-memory services.
import assert from "node:assert/strict";

const task = await taskSpace(
  process.env.CREW_E2E_SPACE_ID ? Number(process.env.CREW_E2E_SPACE_ID) : "Crew catalog P0.1 E2E",
);
console.log({ spaceId: task.spaceId });
const page = task.page("p1");
await page.goto(process.env.CREW_E2E_URL ?? "file:///tmp/crew-p01-browser/index.html");
const button = (name) => `loc=role:button[name='${name}']`;
const tab = (name) => `loc=role:tab[name='${name}']`;
const textbox = (name) => `loc=role:textbox[name='${name}']`;
const state = () => page.evaluate(() => window.crewFixtureState());
await page.waitForSelector(button("Create agent"));
await page.click(button("Create agent"));
await page.fill(textbox("Agent name"), "Shared reviewer");
await page.fill(textbox("System prompt"), "Review the requested changes only.");
await page.click(button("Save"));
await page.waitForSelector(button("Edit agent Shared reviewer"));
assert.equal((await state()).agents.length, 1);

await page.click(tab("Group management"));
for (const name of ["Crew A", "Crew B"]) {
  await page.click(button("Create crew"));
  await page.fill(textbox("Crew name"), name);
  await page.click("loc=role:checkbox[name='Shared reviewer']");
  await page.click(button("Choose directory"));
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('[data-testid="crew-editor"] textarea').length,
    ),
    0,
  );
  await page.click(button("Save"));
  await page.waitForSelector(button("Edit"));
  await page.click("loc=role:button[name*='Default conversation']");
  await page.waitForSelector("loc=css:[data-testid='crew-conversation']");
  assert.equal(
    await page.evaluate(
      () => document.querySelector('[data-testid="crew-conversation"]').dataset.conversationId,
    ),
    (await state()).groups.find((group) => group.name === name).groupId,
  );
  await page.click(button("Back to crews"));
}
let snapshot = await state();
assert.equal(snapshot.groups.length, 2);
assert.equal(snapshot.agents.length, 1);
assert.equal(snapshot.conversations.length, 2);
assert(snapshot.calls.filter((call) => call.kind === "get").every((call) => call.conversationId));
for (const group of snapshot.groups) {
  assert.equal(group.members[0].agentId, snapshot.agents[0].agentId);
  assert.deepEqual(Object.keys(group.members[0]).sort(), ["agentId", "memberId"]);
  assert.equal(group.workspaceBinding.workspacePath, "/fixture/workspace");
}

await page.click(tab("Agent management"));
await page.click(button("Edit agent Shared reviewer"));
await page.fill(textbox("Agent name"), "Updated reviewer");
await page.fill(textbox("System prompt"), "Updated catalog instructions.");
await page.click(button("Save"));
await page.waitForSelector(button("Edit agent Updated reviewer"));
await page.click(button("Delete agent Updated reviewer"));
await page.click("loc=css:[role='alertdialog'] button:text-is('Delete')");
await page.waitForFunction(() =>
  document.body.innerText.includes("Remove all references before deleting"),
);
assert.equal((await state()).agents.length, 1);

await page.click(tab("Group management"));
for (const name of ["Crew A", "Crew B"]) {
  await page.click(`loc=role:button[name*='${name}']`);
  await page.waitForSelector(button("Edit"));
  await page.click(button("Edit"));
  await page.waitForSelector("loc=role:checkbox[name='Updated reviewer']");
  await page.click("loc=role:checkbox[name='Updated reviewer']");
  await page.click(button("Save"));
  await page.waitForSelector(button("Edit"));
  await page.click(button("Back to crews"));
}
await page.click(tab("Agent management"));
await page.click(button("Delete agent Updated reviewer"));
await page.click("loc=css:[role='alertdialog'] button:text-is('Delete')");
await page.waitForFunction(() => window.crewFixtureState().agents.length === 0);
snapshot = await state();
assert.equal(snapshot.groups.length, 2);
assert(snapshot.groups.every((group) => group.members.length === 0));
console.log(
  "PASS: catalog create/update/delete, multi-group references, inline editor absence, delete guard.",
);
console.log(await page.snapshot());
