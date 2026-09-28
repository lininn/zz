// Run with ego-browser nodejs in an authorized browser environment. No live Host/runtime.
import assert from "node:assert/strict";

const task = await taskSpace(
  process.env.CREW_E2E_SPACE_ID
    ? Number(process.env.CREW_E2E_SPACE_ID)
    : "Crew multiconversation E2E",
);
console.log({ spaceId: task.spaceId });
const page = task.page("p1");
await page.goto(process.env.CREW_E2E_URL ?? "file:///tmp/crew-p01-browser/index.html");
const button = (name) => `loc=role:button[name='${name}']`;
const textbox = (name) => `loc=role:textbox[name='${name}']`;
const state = () => page.evaluate(() => window.crewFixtureState());
const board = () =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="crew-conversation"]');
    return {
      id: root?.dataset.conversationId,
      text: root?.innerText ?? "",
      draft: root?.querySelector("textarea")?.value ?? "",
      approval: Boolean(root?.querySelector('[data-testid="crew-permission"]')),
      errors: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent),
    };
  });
const open = async (id) => {
  await page.click(`loc=css:button[data-conversation-id='${id}']`);
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="crew-conversation"]')?.dataset.conversationId ===
      expected,
    id,
  );
};
const defer = (kind, targetId) =>
  page.evaluate(({ kind, targetId }) => window.crewFixtureControl.deferNext(kind, targetId), {
    kind,
    targetId,
  });
const waiting = (id) =>
  page.waitForFunction(
    (gate) => window.crewFixtureState().gates.some((item) => item.id === gate && item.waiting),
    id,
  );
const release = (id, error) =>
  page.evaluate(
    async ({ id, error }) => {
      window.crewFixtureControl.release(id, error);
      // Wait for React's paint after the intentionally delayed promise settles, not a timing sleep.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    { id, error },
  );
const send = async (text) => {
  await page.fill(textbox("Board message"), text);
  await page.click(button("Send"));
  await page.waitForFunction(
    (message) =>
      document.querySelector('[role="log"]')?.innerText.includes(message) &&
      document.querySelector('[data-testid="crew-composer"] textarea')?.value === "",
    text,
  );
};

await page.waitForSelector(button("Create agent"));
await page.click("loc=role:tab[name='Group management']");
await page.click(button("Create crew"));
await page.fill(textbox("Crew name"), "Multiconversation crew");
await page.click(button("Choose directory"));
await page.click(button("Save"));
await page.waitForSelector("loc=role:button[name*='Default conversation']");
const groupId = (await state()).groups[0].groupId;
const a = groupId;
await open(a);
await send("Only conversation A history");
await page.fill(textbox("Board message"), "Unsent A draft");
await page.click(button("New conversation"));
await page.waitForFunction(
  () =>
    window.crewFixtureState().conversations.length === 2 &&
    document.querySelector('[data-testid="crew-conversation"]')?.dataset.conversationId !==
      window.crewFixtureState().groups[0].groupId,
);
const b = (await state()).conversations.find((entry) => !entry.conversation.isDefault).conversation
  .conversationId;
assert.equal((await board()).id, b);
assert((await board()).text.includes("Conversation 1"));
assert.equal((await board()).draft, "");
assert(!(await board()).text.includes("Only conversation A history"));
await send("Only conversation B history");
await open(a);
assert.equal((await board()).draft, "");
assert(!(await board()).text.includes("Only conversation B history"));

// First B snapshot is cached. Hold A refresh; late A must not overwrite B.
const readGate = await defer("get", a);
await page.click(button("Refresh"));
await waiting(readGate);
await page.fill(textbox("Board message"), "Another unsent A draft");
await open(b);
assert.equal((await board()).draft, "");
await release(readGate);
await page.waitForFunction(() => window.crewFixtureState().gates.length === 0);
assert.equal((await board()).id, b);
assert(!(await board()).text.includes("Only conversation A history"));

// Explicit fixture projection injection, NOT a real runtime approval.
await page.evaluate(
  ({ groupId, a }) => window.crewFixtureControl.seedExecution({ groupId, conversationId: a }),
  { groupId, a },
);
await open(a);
await page.click(button("Refresh"));
await page.waitForSelector("loc=css:[data-testid='crew-permission']");
await open(b);
assert.equal((await board()).approval, false);

// Failed send returns after B's draft has changed; failure and pending state stay in A.
await open(a);
const failureGate = await defer("send", a);
await page.fill(textbox("Board message"), "Rejected A command");
await page.click(button("Send"));
await waiting(failureGate);
await open(b);
await page.fill(textbox("Board message"), "B draft survives A failure");
await release(failureGate, "crew.workspaceBusy");
await page.waitForFunction(() => window.crewFixtureState().gates.length === 0);
assert.deepEqual((await board()).errors, []);
assert.equal((await board()).draft, "B draft survives A failure");
assert.equal((await board()).id, b);

// Successful send also cannot clear B's draft or move its selection.
await open(a);
const sendGate = await defer("send", a);
await page.fill(textbox("Board message"), "Late A accepted text");
await page.click(button("Send"));
await waiting(sendGate);
await open(b);
await page.fill(textbox("Board message"), "B draft survives A success");
await release(sendGate);
await page.waitForFunction(() =>
  window
    .crewFixtureState()
    .conversations.some((entry) =>
      entry.messages.some((message) => message.text === "Late A accepted text"),
    ),
);
assert.equal((await board()).id, b);
assert.equal((await board()).draft, "B draft survives A success");
assert(!(await board()).text.includes("Late A accepted text"));

// A late conversation-create may persist, but must not auto-open over B.
await open(a);
const createGate = await defer("createConversation", groupId);
await page.click(button("New conversation"));
await waiting(createGate);
await open(b);
await release(createGate);
await page.waitForFunction(() => window.crewFixtureState().conversations.length === 3);
await page.waitForSelector("loc=role:button[name*='Conversation 2']");
assert.equal((await board()).id, b);

// A recovery keeps group editing locked, but B's independent composer can still send.
await page.evaluate(
  ({ groupId, a }) =>
    window.crewFixtureControl.seedExecution({ groupId, conversationId: a, recovery: true }),
  { groupId, a },
);
await page.click(button("Refresh"));
await page.waitForFunction(() =>
  document.querySelector('[data-testid="crew-section"]')?.innerText.includes("Recovery required"),
);
await send("B works while A needs recovery");
assert.equal((await board()).id, b);
assert.equal((await board()).approval, false);
assert(!(await board()).text.includes("Conversation A approval only"));
const final = await state();
assert(
  final.calls
    .filter((call) => call.kind !== "createConversation")
    .every((call) => call.conversationId),
);
assert(
  final.conversations
    .find((entry) => entry.conversation.conversationId === a)
    .messages.every((message) => !message.text.startsWith("Only conversation B")),
);
assert(
  final.conversations
    .find((entry) => entry.conversation.conversationId === b)
    .messages.every((message) => !message.text.startsWith("Only conversation A")),
);
console.log(
  "PASS: default/new conversations, history/draft/approval isolation, delayed reads/sends/create, independent recovery gate.",
);
console.log(await page.snapshot());
