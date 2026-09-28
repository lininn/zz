import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium, type Browser } from "playwright-core";
import { ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV } from "@zcode/provider-node";
import { readWebConfig, writeWebConfig } from "../../src/web-config/configStore.js";
import {
  startWebConfigServer,
  type WebConfigServerHandle,
} from "../../src/web-config/server.js";

async function getFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const MOCK_UPSTREAM_MODELS = ["model-a", "model-b", "model-c"];

const mockUpstreamFetch = (async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: MOCK_UPSTREAM_MODELS.map((id) => ({ id })),
  }),
})) as unknown as typeof fetch;

test("web config page: fetch-models select-all toggle and provider copy", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zcode-web-config-e2e-"));
  const configFile = join(dir, "provider_config.json");
  const previousEnv = process.env[ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV];
  process.env[ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV] = configFile;

  // 种子数据：一个已有 model-a 的 Provider，用于验证「已存在」禁用项与复制隔离。
  await writeWebConfig({
    providers: [
      {
        providerId: "src",
        providerName: "源 Provider",
        enabled: true,
        apiType: "openai-chat-completions",
        baseUrl: "http://upstream.test/v1",
        apiKey: "sk-src-key",
        models: [
          {
            modelId: "model-a",
            enabled: true,
            supportsImage: false,
            supportsVideo: false,
            supportsPdf: false,
            contextWindow: 0,
            maxOutputTokens: 0,
          },
        ],
      },
    ],
  });

  const handle: WebConfigServerHandle = await startWebConfigServer({
    port: await getFreePort(),
    fetchImpl: mockUpstreamFetch,
  });

  let browser: Browser | undefined;
  try {
    browser = await chromium
      .launch({ channel: "chrome", headless: true })
      .catch(() => undefined);
    if (!browser) {
      t.skip("系统 Chrome 不可用，跳过 web-config E2E");
      return;
    }
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${handle.port}/`);
    await page.locator(".provider-item").first().waitFor();

    // ── 全选/取消全选 ──
    await page.click("#fetch-models-btn");
    await page.locator("#fetch-modal.show").waitFor();

    const boxes = page.locator('#fetch-list input[type="checkbox"]');
    assert.equal(await boxes.count(), 3);
    assert.equal(await boxes.nth(0).isChecked(), true, "已存在模型默认勾选");
    assert.equal(await boxes.nth(0).isDisabled(), true, "已存在模型禁用");
    assert.equal(await boxes.nth(1).isChecked(), true);
    assert.equal(await page.locator("#fetch-toggle-all").isChecked(), true);
    assert.equal(
      await page.locator("#fetch-count").textContent(),
      "共 3 个模型，可导入 2 个，已选 2 个",
    );

    // 取消全选：只影响可导入项，导入 0 个。
    await page.click("#fetch-toggle-all");
    assert.equal(await boxes.nth(1).isChecked(), false);
    assert.equal(await boxes.nth(0).isChecked(), true, "禁用项不受主开关影响");
    assert.equal(await page.locator("#fetch-toggle-all").isChecked(), false);
    assert.equal(
      await page.locator("#fetch-count").textContent(),
      "共 3 个模型，可导入 2 个，已选 0 个",
    );
    await page.click("#fetch-import");
    await page.locator("#fetch-modal.show").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.getElementById("toast")?.textContent?.includes("已导入 0 个模型"),
    );
    assert.equal(await page.locator("#provider-panel tbody tr").count(), 1);

    // 重新打开：默认恢复全选；单个取消后主开关进入半选状态。
    await page.click("#fetch-models-btn");
    await page.locator("#fetch-modal.show").waitFor();
    assert.equal(await boxes.nth(1).isChecked(), true, "重新打开恢复默认全选");
    await boxes.nth(2).uncheck();
    assert.equal(
      await page
        .locator("#fetch-toggle-all")
        .evaluate((el) => (el as HTMLInputElement).indeterminate),
      true,
      "部分勾选时主开关为半选",
    );
    assert.equal(
      await page.locator("#fetch-count").textContent(),
      "共 3 个模型，可导入 2 个，已选 1 个",
    );
    await page.click("#fetch-import");
    await page.locator("#fetch-modal.show").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.getElementById("toast")?.textContent?.includes("已导入 1 个模型"),
    );
    assert.equal(await page.locator("#provider-panel tbody tr").count(), 2);

    // ── 复制 Provider ──
    await page.click("#copy-provider-btn");
    assert.equal(await page.locator(".provider-item").count(), 2);
    assert.equal(
      await page.locator('input[data-provider-field="providerId"]').inputValue(),
      "custom-1",
      "副本重新分配未占用的 providerId",
    );
    assert.equal(
      await page.locator('input[data-provider-field="providerName"]').inputValue(),
      "源 Provider 副本",
    );
    assert.equal(
      await page.locator('input[data-provider-field="baseUrl"]').inputValue(),
      "http://upstream.test/v1",
    );
    assert.equal(
      await page.locator('input[data-provider-field="apiKey"]').inputValue(),
      "sk-src-key",
    );
    assert.equal(await page.locator("#provider-panel tbody tr").count(), 2);

    // 修改副本的模型启用状态，切回源 Provider 验证不影响源。
    const copyModelBEnabled = page
      .locator("#provider-panel tbody tr")
      .nth(1)
      .locator('input[type="checkbox"]')
      .first();
    await copyModelBEnabled.uncheck();
    await page.locator(".provider-item").first().click();
    const srcModelBEnabled = page
      .locator("#provider-panel tbody tr")
      .nth(1)
      .locator('input[type="checkbox"]')
      .first();
    assert.equal(
      await srcModelBEnabled.isChecked(),
      true,
      "副本的模型修改不影响源 Provider",
    );

    // 保存后落盘内容：两个 Provider 并存，副本仅 model-b 物化 enabled:false 规则。
    await page.click("#save-btn");
    await page.waitForFunction(() =>
      document.getElementById("toast")?.textContent?.includes("已保存"),
    );
    const saved = readWebConfig();
    assert.equal(saved.providers.length, 2);
    const copy = saved.providers.find((provider) => provider.providerId === "custom-1");
    assert.ok(copy, "保存后文件包含副本 Provider");
    assert.equal(copy?.apiKey, "sk-src-key");
    assert.equal(copy?.models.find((model) => model.modelId === "model-b")?.enabled, false);
    assert.equal(copy?.models.find((model) => model.modelId === "model-a")?.enabled, true);
    const src = saved.providers.find((provider) => provider.providerId === "src");
    assert.equal(
      src?.models.find((model) => model.modelId === "model-b")?.enabled,
      true,
      "源的 model-b 仍为启用",
    );
  } finally {
    await browser?.close();
    handle.stop();
    if (previousEnv === undefined) delete process.env[ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV];
    else process.env[ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV] = previousEnv;
    await rm(dir, { recursive: true, force: true });
  }
});
