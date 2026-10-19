import assert from "node:assert/strict";
import test from "node:test";
import { discoverProviderModels } from "../src/model-provider/providerModelDiscovery.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("成功：解析 { data: [{ id }] } 并去重", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const result = await discoverProviderModels(
    {
      apiType: "openai-chat-completions",
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-test",
    },
    {
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
        return jsonResponse({ data: [{ id: "gpt-4o" }, { id: "gpt-4o" }, { id: "o3" }] });
      }) as unknown as typeof fetch,
    },
  );
  assert.deepEqual(result, { success: true, models: ["gpt-4o", "o3"] });
  // 末尾斜杠不能产生 //models。
  assert.equal(calls[0]?.url, "https://api.example.com/v1/models");
  assert.equal(calls[0]?.headers.authorization, "Bearer sk-test");
});

test("Anthropic 用 x-api-key 而不是 Bearer", async () => {
  let headers: Record<string, string> = {};
  await discoverProviderModels(
    { apiType: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" },
    {
      fetch: (async (_url: string, init?: RequestInit) => {
        headers = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({ data: [{ id: "claude-sonnet-5" }] });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(headers["x-api-key"], "sk-ant");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers.authorization, undefined);
});

test("非 200：返回失败而不抛，便于调用方保留手填", async () => {
  const result = await discoverProviderModels(
    { apiType: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
    { fetch: (async () => jsonResponse({}, 401)) as unknown as typeof fetch },
  );
  assert.equal(result.success, false);
  assert.match(result.success === false ? result.error.message : "", /401/);
});

test("响应结构不认识：当作失败而不是空列表", async () => {
  const result = await discoverProviderModels(
    { apiType: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
    { fetch: (async () => jsonResponse({ models: ["a"] })) as unknown as typeof fetch },
  );
  assert.equal(result.success, false);
});

test("网络异常：收敛成失败结果", async () => {
  const result = await discoverProviderModels(
    { apiType: "openai-chat-completions", baseUrl: "https://api.example.com/v1" },
    {
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(result.success, false);
  assert.match(result.success === false ? result.error.message : "", /ECONNREFUSED/);
});

test("缺 baseUrl：参数校验失败，不发请求", async () => {
  let called = false;
  const result = await discoverProviderModels(
    { apiType: "openai-chat-completions", baseUrl: "   " },
    {
      fetch: (async () => {
        called = true;
        return jsonResponse({ data: [] });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(result.success, false);
  assert.equal(called, false);
});
