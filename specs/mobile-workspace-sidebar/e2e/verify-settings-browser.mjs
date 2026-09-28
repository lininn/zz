// Run via ego-browser nodejs. Real settings layout/navigation; section/service commit is a local substitute.
import assert from "node:assert/strict";

const task = await taskSpace(
  process.env.SIDEBAR_E2E_SPACE_ID
    ? Number(process.env.SIDEBAR_E2E_SPACE_ID)
    : "Settings sidebar E2E",
);
console.log({ spaceId: task.spaceId });
const page = task.page("p1");
const url =
  process.env.SETTINGS_SIDEBAR_E2E_URL ?? "file:///tmp/zcode-settings-sidebar-browser/index.html";
const toggle = "loc=css:[data-testid='settings-page'] [data-testid='mobile-sidebar-toggle']";
const navigation = (id) => `loc=css:[data-testid='settings-section-nav-${id}']`;
const resize = (width) =>
  page.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
const state = () =>
  page.evaluate(() => {
    const fixture = document.querySelector('[data-testid="settings-sidebar-fixture"]');
    const layout = document.querySelector('[data-testid="settings-page"]');
    const content = document.querySelector("[data-settings-content-frame]");
    const panel = layout.querySelector("#settings-sidebar") ?? layout.querySelector("aside");
    const button = document.querySelector(
      '[data-testid="settings-page"] [data-testid="mobile-sidebar-toggle"]',
    );
    const box = button?.getBoundingClientRect();
    return {
      mobile: fixture.dataset.mobile === "true",
      visible: fixture.dataset.visible === "true",
      section: layout.dataset.activeSection,
      selections: Number(fixture.dataset.selections),
      contentClicks: Number(fixture.dataset.contentClicks),
      backgroundDismissals: Number(fixture.dataset.backgroundDismissals),
      panelWidth: panel.getBoundingClientRect().width,
      panelInert: panel.inert,
      contentWidth: content.getBoundingClientRect().width,
      contentInert: content.inert,
      viewportWidth: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      buttonWidth: box?.width,
      buttonHeight: box?.height,
      buttonHit: box
        ? button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        : false,
      groups: layout.querySelectorAll('nav [role="group"]').length,
      labelsHidden: layout.querySelector("nav span.min-w-0")?.classList.contains("max-lg:sr-only"),
      backdrop: Boolean(layout.querySelector('[data-testid="mobile-sidebar-backdrop"]')),
    };
  });
const waitMobile = (mobile) =>
  page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="settings-sidebar-fixture"]')?.dataset.mobile ===
      String(value),
    mobile,
  );
const waitSection = (section) =>
  page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="settings-page"]')?.dataset.activeSection === value,
    section,
  );
const waitVisible = async (visible) => {
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="settings-sidebar-fixture"]')?.dataset.visible ===
      String(value),
    visible,
  );
  // 等真实动画几何稳定，不用固定 sleep。
  await page.waitForFunction((value) => {
    const panel = document.querySelector("#settings-sidebar");
    if (!panel) return false;
    const width = panel.getBoundingClientRect().width;
    return value ? Math.abs(width - Math.min(268, innerWidth - 48)) < 1 : width === 0;
  }, visible);
};

try {
  for (const width of [320, 390, 768, 1023]) {
    await resize(width);
    await page.goto(url);
    await page.waitForSelector(toggle);
    await waitVisible(false);
    let snapshot = await state();
    assert.equal(snapshot.mobile, true);
    assert.equal(
      snapshot.section,
      "appearance",
      "opening settings must not reset the current section",
    );
    assert.equal(snapshot.panelInert, true);
    assert.equal(snapshot.contentWidth, width);
    assert.equal(snapshot.overflow, false);
    assert(snapshot.buttonWidth >= 40 && snapshot.buttonHeight >= 40 && snapshot.buttonHit);
    let selections = 0;
    for (const id of ["appearance", "general", "general", "crew"]) {
      await page.click(toggle);
      await waitVisible(true);
      snapshot = await state();
      assert.equal(snapshot.contentWidth, width);
      assert.equal(snapshot.contentInert, true);
      assert.equal(snapshot.labelsHidden, false);
      assert(snapshot.buttonHit && snapshot.backdrop && snapshot.groups >= 2);
      await page.click(navigation(id));
      await waitVisible(false);
      snapshot = await state();
      assert.equal(snapshot.section, id);
      assert.equal(snapshot.selections, ++selections);
      assert.equal(snapshot.contentInert, false);
    }
    await page.click(toggle);
    await waitVisible(true);
    await page.click(toggle);
    await waitVisible(false);
    await page.click(toggle);
    await waitVisible(true);
    await page.mouse.click(width - 20, 400, { label: "close settings using backdrop" });
    await waitVisible(false);
    await page.click(toggle);
    await waitVisible(true);
    await page.keyboard.press("Escape");
    await waitVisible(false);
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-controls")),
      "settings-sidebar",
    );
    await page.click("loc=css:[data-testid='content-action']");
    assert.equal((await state()).contentClicks, 1);
    assert.equal(
      (await state()).backgroundDismissals,
      0,
      "inert homepage must retain its sidebar state",
    );
    // 隐藏的导航不接受程序化聚焦，也不应进入键盘 Tab 顺序。
    assert.equal(
      await page.evaluate(() => {
        const hidden = document.querySelector('[data-testid="settings-section-nav-general"]');
        hidden.focus();
        return document.activeElement === hidden;
      }),
      false,
    );
  }

  for (const width of [1024, 1440]) {
    await resize(width);
    await page.goto(url);
    await page.waitForSelector(navigation("general"));
    await waitMobile(false);
    const snapshot = await state();
    assert.equal(snapshot.visible, true);
    assert.equal(snapshot.panelWidth, 268);
    assert.equal(snapshot.contentWidth, width - 268);
    assert.equal(snapshot.buttonWidth, undefined);
    assert.equal(snapshot.backdrop, false);
    await page.click(navigation("general"));
    await waitSection("general");
    assert.equal((await state()).visible, true);
    assert.equal((await state()).section, "general");
  }

  await resize(390);
  await waitMobile(true);
  await waitVisible(false);
  await page.click(toggle);
  await waitVisible(true);
  await resize(1024);
  await waitMobile(false);
  assert.equal((await state()).visible, true);
  await resize(390);
  await waitMobile(true);
  await waitVisible(false);
  assert.equal((await state()).section, "general");

  for (const locale of ["zh-CN", "en-US"]) {
    const localized = new URL(url);
    localized.searchParams.set("locale", locale);
    await page.goto(localized.href);
    await page.waitForSelector(toggle);
    await waitVisible(false);
    const label = await page.evaluate(() =>
      document
        .querySelector('[data-testid="settings-page"] [data-testid="mobile-sidebar-toggle"]')
        .getAttribute("aria-label"),
    );
    assert(label && !label.includes("workspaceSidebar."));
    await page.click(toggle);
    await waitVisible(true);
    assert.equal((await state()).labelsHidden, false);
  }

  for (const width of [390, 1024]) {
    await resize(width);
    const desktop = new URL(url);
    desktop.searchParams.set("desktop", "1");
    await page.goto(desktop.href);
    await page.waitForSelector(navigation("general"));
    await waitMobile(false);
    let snapshot = await state();
    assert.equal(snapshot.visible, true);
    assert.equal(snapshot.panelWidth, width < 1024 ? 68 : 268);
    assert.equal(snapshot.labelsHidden, true, "desktop retains max-lg icon-rail styling");
    assert.equal(snapshot.buttonWidth, undefined);
    assert.equal(snapshot.backdrop, false);
    await page.click(navigation("general"));
    await waitSection("general");
    snapshot = await state();
    assert.equal(snapshot.visible, true);
    assert.equal(snapshot.section, "general");
  }
  console.log(
    "PASS: settings viewport defaults, current section, shared drawer controls, selection dismissal, groups, SSR-independent client geometry, locales and desktop layout.",
  );
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {});
}
// 只有整轮成功才 finish；错误时保留同一空间供诊断，不另开空间绕过失败。
await task.finish({ keep: [] });
