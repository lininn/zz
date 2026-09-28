// Full application Playwright regression. Only edits/cancels an unsaved draft;
// never saves a group, starts a runtime, or changes the user's existing groups.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const output = resolve(process.env.CREW_E2E_OUTPUT ?? "/tmp/crew-editor-open");
await mkdir(output, { recursive: true });
const results = { status: "running", coverage: "full-app", cases: [] };
const cases = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const names = {
  crewTab: /^(群组|Crews)$/,
  create: /^(创建群组|Create crew)$/,
  choose: /^(选择目录|Choose directory)$/,
  path: /^(输入路径|Enter path)$/,
  go: /^(前往|Go)$/,
  select: /^(选择此目录|Select this directory)$/,
  workspace: /^(共享工作目录|Shared workspace)$/,
  groupName: /^(群组名称|Crew name)$/,
  cancel: /^(取消|Cancel)$/,
};
let browser;
let stage = "launch";
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CREW_E2E_EXECUTABLE ? { executablePath: process.env.CREW_E2E_EXECUTABLE } : {}),
  });
  for (const scenario of cases) {
    const { name, ...options } = scenario;
    const context = await browser.newContext({
      ...options,
      ...(process.env.CREW_E2E_STORAGE_STATE
        ? { storageState: process.env.CREW_E2E_STORAGE_STATE }
        : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const result = { name, ...options, status: "running", screenshots: [] };
    results.cases.push(result);
    const capture = async (step) => {
      const file = `${name}-${step}.png`;
      await page.screenshot({ path: resolve(output, file), fullPage: true });
      result.screenshots.push(file);
    };
    try {
      stage = `${name}:open-app`;
      await page.goto(process.env.CREW_E2E_URL ?? "http://localhost:5173/");
      await page.locator("[data-workspace-shell]").waitFor({ state: "visible" });
      const sidebar = page.locator("[data-workspace-sidebar-panel]");
      if (scenario.isMobile && (await sidebar.evaluate((el) => el.hasAttribute("inert")))) {
        await page
          .locator("[data-testid='mobile-sidebar-toggle'][aria-controls='sidebar']")
          .click();
      }
      stage = `${name}:sidebar`;
      await sidebar.getByRole("tab", { name: names.crewTab }).click();
      const create = sidebar.getByRole("button", { name: names.create, exact: true });
      await create.waitFor({ state: "visible" });
      await capture("01-create-entry");
      await create.click();
      stage = `${name}:editor`;
      const home = page.getByTestId("crew-home");
      const editor = home.getByTestId("crew-editor");
      await editor.waitFor({ state: "visible" });
      assert.equal(
        await home.getAttribute("data-group-id"),
        null,
        "New draft must not require a persisted group",
      );
      assert.equal(
        await page.getByTestId("crew-section").isVisible(),
        false,
        "Create must not open settings",
      );
      if (scenario.isMobile) {
        await page.waitForFunction(() =>
          document.querySelector("[data-workspace-sidebar-panel]")?.hasAttribute("inert"),
        );
        result.drawerClosed = true;
      }
      const draftName = `Editor regression ${name}`;
      await editor.getByRole("textbox", { name: names.groupName }).fill(draftName);
      await capture("02-editor");
      await editor.getByRole("button", { name: names.choose }).click();
      stage = `${name}:directory`;
      const pathInput = page.getByPlaceholder(names.path);
      await pathInput.waitFor({ state: "visible" });
      const select = page.getByRole("button", { name: names.select, exact: true });
      // Wait for the actual directory read to finish, not a fixed timeout.
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          (el) =>
            /^(选择此目录|Select this directory)$/.test(el.textContent.trim()) && !el.disabled,
        ),
      );
      if (process.env.CREW_E2E_DIRECTORY) {
        await pathInput.fill(process.env.CREW_E2E_DIRECTORY);
        await page.getByRole("button", { name: names.go, exact: true }).click();
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll("button")).some(
            (el) =>
              /^(选择此目录|Select this directory)$/.test(el.textContent.trim()) && !el.disabled,
          ),
        );
      }
      const selectedPath = (await pathInput.inputValue()).trim();
      assert(selectedPath, "Directory read must produce a real path");
      if (process.env.CREW_E2E_DIRECTORY)
        assert.equal(selectedPath, process.env.CREW_E2E_DIRECTORY.trim());
      assert.equal(
        await editor.getByRole("textbox", { name: names.groupName }).inputValue(),
        draftName,
      );
      await capture("03-directory");
      await select.click();
      await pathInput.waitFor({ state: "hidden" });
      stage = `${name}:filled`;
      const workspace = editor.getByRole("combobox", { name: names.workspace });
      await page.waitForFunction((path) => {
        const editor = document.querySelector("[data-testid='crew-editor']");
        return Array.from(editor?.querySelectorAll("[role=combobox]") ?? []).some(
          (el) => el.textContent.trim() === path,
        );
      }, selectedPath);
      assert.equal((await workspace.innerText()).trim(), selectedPath);
      assert.equal(
        await editor.getByRole("textbox", { name: names.groupName }).inputValue(),
        draftName,
        "Picker must preserve the editor, not submit/reload it",
      );
      if (scenario.isMobile) assert(await sidebar.evaluate((el) => el.hasAttribute("inert")));
      await capture("04-filled");
      result.selectedPathMatched = true;
      // Cancel the draft deliberately; no test group is persisted.
      await editor.getByRole("button", { name: names.cancel, exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      result.status = "passed";
    } catch (error) {
      result.status = "failed";
      await capture("failure").catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  results.status = "passed";
} catch (error) {
  results.status = stage === "launch" ? "blocked" : "failed";
  results.stage = stage;
  // Do not serialize launch arguments, URLs, or supplied authentication state.
  results.error =
    error instanceof Error
      ? error.message.split("\n")[0].replace(/https?:\/\/\S+/g, "[redacted-url]")
      : "Unknown browser error";
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await writeFile(resolve(output, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
}
