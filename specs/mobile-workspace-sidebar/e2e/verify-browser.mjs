// Run via ego-browser nodejs. Navigation actions are substitutes; production hook/layout/toolbar are real.
import assert from "node:assert/strict";

const task = await taskSpace(
  process.env.SIDEBAR_E2E_SPACE_ID
    ? Number(process.env.SIDEBAR_E2E_SPACE_ID)
    : "Mobile sidebar E2E",
);
const page = task.page("p1");
const url = process.env.SIDEBAR_E2E_URL ?? "file:///tmp/zcode-mobile-sidebar-browser/index.html";
const toggle = "loc=css:[data-testid='mobile-sidebar-toggle']";
console.log({ spaceId: task.spaceId });

const resize = (width) =>
  page.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
const state = () =>
  page.evaluate(() => {
    const root = document.querySelector('[data-testid="sidebar-fixture"]');
    const panel = document.querySelector("#sidebar");
    const content = document.querySelector("#content");
    const button = document.querySelector('[data-testid="mobile-sidebar-toggle"]');
    const box = button?.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    return {
      visible: root.dataset.visible === "true",
      mobile: root.dataset.mobile === "true",
      action: root.dataset.lastAction,
      panelWidth: panelBox.width,
      contentWidth: contentBox.width,
      viewport: innerWidth,
      contentInert: content.inert,
      panelInert: panel.inert,
      widthVariable: root.style.getPropertyValue("--workspace-sidebar-width"),
      buttonWidth: box?.width,
      buttonHeight: box?.height,
      buttonHit: box
        ? button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        : false,
    };
  });
const waitVisible = async (visible) => {
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="sidebar-fixture"]').dataset.visible === String(value),
    visible,
  );
  // 等实际宽度过渡结束，不用固定 sleep 掩盖布局或状态问题。
  await page.waitForFunction((value) => {
    const panel = document.querySelector("#sidebar");
    const width = panel.getBoundingClientRect().width;
    return value ? Math.abs(width - Math.min(320, innerWidth - 48)) < 1 : width === 0;
  }, visible);
};

try {
  for (const width of [390, 768, 1023]) {
    await resize(width);
    await page.goto(url);
    await page.waitForSelector(toggle);
    await waitVisible(false);
    let snapshot = await state();
    assert.equal(snapshot.mobile, true);
    assert.equal(snapshot.panelInert, true);
    assert.equal(snapshot.contentWidth, width);
    assert(snapshot.buttonWidth >= 40 && snapshot.buttonHeight >= 40 && snapshot.buttonHit);
    const remembered = snapshot.widthVariable;

    for (const action of [
      "workspace",
      "same workspace",
      "existing task",
      "new task",
      "grouped task",
      "new conversation",
    ]) {
      await page.click(toggle);
      await waitVisible(true);
      snapshot = await state();
      assert.equal(snapshot.contentWidth, width, "drawer must overlay, not squeeze content");
      assert.equal(snapshot.contentInert, true);
      assert(snapshot.buttonHit, "close button must remain above the drawer");
      await page.click(`loc=css:[data-action='${action}']`);
      await waitVisible(false);
      snapshot = await state();
      assert.equal(snapshot.action, action);
      assert.equal(snapshot.contentInert, false);
      assert.equal(snapshot.widthVariable, remembered);
    }
    await page.click(toggle);
    await waitVisible(true);
    await page.click(toggle);
    await waitVisible(false);
    await page.click(toggle);
    await waitVisible(true);
    // 点击裸露的右侧遮罩；不能点击被 panel 遮盖的 backdrop 中心。
    await page.mouse.click(width - 20, 400, { label: "close sidebar via backdrop" });
    await waitVisible(false);
    await page.click(toggle);
    await waitVisible(true);
    await page.keyboard.press("Escape");
    await waitVisible(false);
    assert.equal(
      await page.evaluate(() => document.activeElement?.dataset.testid),
      "mobile-sidebar-toggle",
    );
    await page.click("loc=css:[data-testid='content-action']");
    assert.equal((await state()).action, "content");
  }

  for (const width of [1024, 1440]) {
    await resize(width);
    await page.goto(url);
    await page.waitForSelector("loc=css:[data-action='workspace']");
    assert.equal((await state()).visible, true);
    assert.equal((await state()).mobile, false);
    await page.click("loc=css:[data-action='workspace']");
    assert.equal((await state()).visible, true);
  }
  await resize(390);
  await page.waitForSelector(toggle);
  await waitVisible(false);
  await page.click(toggle);
  await waitVisible(true);
  await resize(1440);
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sidebar-fixture"]').dataset.mobile === "false",
  );
  assert.equal((await state()).visible, true);
  await resize(390);
  await waitVisible(false);

  for (const width of [390, 1440]) {
    await resize(width);
    await page.goto(`${url}?desktop=1`);
    await page.waitForSelector("loc=css:[data-action='workspace']");
    assert.equal((await state()).visible, true);
    assert.equal((await state()).mobile, false);
    await page.click("loc=css:[data-action='workspace']");
    assert.equal((await state()).visible, true);
    const desktopToggle = "loc=role:button[name='Toggle sidebar']";
    await page.click(desktopToggle);
    await page.waitForFunction(
      () => document.querySelector('[data-testid="sidebar-fixture"]').dataset.visible === "false",
    );
    await page.click(desktopToggle);
    assert.equal((await state()).visible, true);
  }
  console.log(
    "PASS: viewport defaults, overlay geometry, touch target, navigation dismissal, close paths, breakpoint changes, and desktop controls.",
  );
} finally {
  await page.cdp("Emulation.clearDeviceMetricsOverride", {});
}
