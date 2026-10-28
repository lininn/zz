import { describe, expect, it } from "vitest";
import {
  createRawCodeTokens,
  highlightCode,
  shouldUseSyntaxHighlighting,
} from "@/lib/shikiHighlighter.js";
import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";

const highlightAndWait = (code: string) =>
  new Promise<void>((resolve) => {
    const immediate = highlightCode(code, "json", "github-light", () => resolve());
    if (immediate) {
      resolve();
    }
  });

describe("shikiHighlighter", () => {
  it("keeps plain text code fences out of the async highlighter", () => {
    expect(shouldUseSyntaxHighlighting("text")).toBe(false);
    expect(shouldUseSyntaxHighlighting("plaintext")).toBe(false);
    expect(shouldUseSyntaxHighlighting("log")).toBe(false);
    expect(shouldUseSyntaxHighlighting("not-a-real-language")).toBe(false);
  });

  it("allows known languages and aliases to use syntax highlighting", () => {
    expect(shouldUseSyntaxHighlighting("json")).toBe(true);
    expect(shouldUseSyntaxHighlighting("typescript")).toBe(true);
    expect(shouldUseSyntaxHighlighting("tsx")).toBe(true);
  });

  it("returns raw tokens for plain text without registering async callbacks", () => {
    let callbackCount = 0;
    const code = [
      '"next start" does not work with "output: standalone" configuration.',
      'Use "node .next/standalone/server.js" instead.',
    ].join("\n");

    const tokenized = highlightCode(code, "text", "github-light", () => {
      callbackCount += 1;
    });

    expect(tokenized).toEqual(createRawCodeTokens(code));
    expect(callbackCount).toBe(0);
  });

  it(
    "evicts oldest tokenized code once the cache limit is reached",
    async () => {
      // 流式 Edit 预览每个 chunk 都是新 key；这里模拟远超上限的连续写入。
      for (let index = 0; index < 140; index += 1) {
        await highlightAndWait(JSON.stringify({ index, payload: `chunk-${index}` }));
      }

      const counters = uiMemoryDiagnosticsRegistry.collect();
      expect(counters["shiki.tokensCache"]).toBe(120);
      expect(counters["shiki.tokensCacheChars"] ?? 0).toBeLessThanOrEqual(2_000_000);
    },
    30_000,
  );
});
