// Full app, read-only browser smoke. Never recovers/cancels real user work.
// Pass an existing authorized Ego task space; fixtures are tested by verify-home.mjs.
const assert = (await import("node:assert/strict")).default;
const task = await taskSpace(Number(process.env.CREW_E2E_SPACE_ID));
const page = task.page("p1");
const { mkdir } = await import("node:fs/promises");
const output = process.env.CREW_E2E_OUTPUT ?? "/tmp/crew-session-open";
await mkdir(output, { recursive: true });
await page.goto(process.env.CREW_E2E_URL ?? "http://localhost:5173/");
for (const width of [1440, 390]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 1024,
  });
  await page.waitForFunction(() => document.querySelector("[data-workspace-shell]"));
  if (width < 1024) {
    const closed = await page.evaluate(() =>
      document.querySelector("[data-workspace-sidebar-panel]")?.hasAttribute("inert"),
    );
    if (closed)
      await page.click("loc=css:[data-testid='mobile-sidebar-toggle'][aria-controls='sidebar']");
  }
  await page.click("loc=role:tab[name='群组']");
  await page.waitForSelector("loc=css:[data-crew-group-id]");
  const groupId = await page.evaluate(
    (name) =>
      Array.from(document.querySelectorAll("[data-crew-group-id]"))
        .find((row) => row.querySelector("button > span[title]")?.getAttribute("title") === name)
        ?.getAttribute("data-crew-group-id"),
    process.env.CREW_E2E_GROUP_NAME ?? "简单任务组",
  );
  assert(groupId, "Expected fixture crew was not found in the sidebar");
  const groupSelector = `[data-crew-group-id=${JSON.stringify(groupId)}]`;
  const closed = await page.evaluate(
    (selector) =>
      document.querySelector(`${selector} > div > button`)?.getAttribute("aria-expanded") ===
      "false",
    groupSelector,
  );
  if (closed) await page.click(`loc=css:${groupSelector} > div > button:first-child`);
  const conversationSelector = `${groupSelector} button[data-conversation-id]`;
  await page.waitForSelector(`loc=css:${conversationSelector}`);
  const conversationId = await page.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute("data-conversation-id"),
    conversationSelector,
  );
  const target = { groupId, conversationId };
  await page.click(`loc=css:${conversationSelector}`);
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid='crew-chat']") ||
      document.querySelector("[data-testid='crew-home'] [role='alert']"),
  );
  const error = await page.evaluate(
    () => document.querySelector("[data-testid='crew-home'] [role='alert']")?.textContent ?? null,
  );
  assert.equal(error, null, `Selected conversation failed: ${error}`);
  await page.waitForSelector("loc=css:[data-testid='crew-chat']");
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("[data-testid='crew-chat']")?.getAttribute("data-conversation-id"),
    ),
    target.conversationId,
  );
  assert.equal(
    await page.evaluate(() =>
      document.querySelector("[data-testid='crew-home']")?.getAttribute("data-group-id"),
    ),
    target.groupId,
  );
  if (width < 1024)
    assert.equal(
      await page.evaluate(() =>
        document.querySelector("[data-workspace-sidebar-panel]")?.hasAttribute("inert"),
      ),
      true,
    );
  const execution = "loc=css:[data-testid='crew-execution-row'] button[aria-expanded]";
  await page.waitForSelector(execution);
  await page.click(execution);
  await page.waitForFunction(() => {
    const region = document.querySelector("[data-testid='crew-execution-row'] [role='region']");
    return (
      region?.querySelector("[data-testid='crew-v4-detail']") ||
      region?.textContent?.includes("详细过程不可用")
    );
  });
  await page.screenshot({ path: `${output}/crew-${width}-expanded.png` });
  await page.click(execution);
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll("[data-testid='crew-execution-row'] [role='region']").length,
    ),
    0,
  );
  console.log(
    `Crew session navigation passed at ${width}px; real runtime actions were not invoked.`,
  );
}
await page.cdp("Emulation.clearDeviceMetricsOverride", {});
