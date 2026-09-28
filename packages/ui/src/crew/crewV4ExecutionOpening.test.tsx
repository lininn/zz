import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { useCrewText } from "../hooks/useCrewText.js";
import { chatExecution } from "./crewChatFixtures.js";

// 渲染真实分支，只替换只读投影/懒加载子视图，禁止借展开触发 runtime。
let connected = true;
let snapshot: { rows: { window: { rowId: number }[]; firstRowId: number | null } } | null = null;
let readCount = 0;
let renderedRows: unknown;
const source = await readFile(new URL("./CrewExecutionDetails.tsx", import.meta.url), "utf8");
const exports: { CrewExecutionDetails?: React.ComponentType<{ execution: typeof chatExecution }> } =
  {};
runInNewContext(
  ts.transpileModule(source, {
    fileName: "CrewExecutionDetails.tsx",
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports,
    require: (name: string) => {
      if (name === "react")
        return {
          ...React,
          lazy:
            () =>
            ({ rows }: { rows: unknown }) => {
              renderedRows = rows;
              return <div data-testid="readonly-v4" />;
            },
        };
      if (name === "react/jsx-runtime") return jsx;
      if (name.endsWith("useCrewText.js")) return { useCrewText };
      if (name.endsWith("useZCodeIntl.js") || name.endsWith("IntlProvider.js"))
        return { useZCodeIntl: () => ({ locale: "en-US" }) };
      if (name.endsWith("useCrewExecutionDetail.js"))
        return { useCrewExecutionDetail: () => ({ data: { execution: chatExecution } }) };
      if (name.endsWith("useWorkspaceServices.js"))
        return { useWorkspaceServicesResolution: () => ({ rpcReady: connected }) };
      if (name.endsWith("useCrewTaskTimeline.js"))
        return {
          useCrewTaskTimeline: () => {
            readCount++;
            return { snapshot, refresh() {} };
          },
        };
      if (name.endsWith("button.js")) return { Button: "button" };
      throw new Error(`Unexpected execution dependency: ${name}`);
    },
  },
);
function render() {
  readCount = 0;
  renderedRows = undefined;
  const Details = exports.CrewExecutionDetails!;
  return renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <Details execution={chatExecution} />
    </ZCodeIntlProvider>,
  );
}

test("ZCode expansion uses the existing V4 rows and marks a partial window", () => {
  connected = true;
  snapshot = { rows: { window: [{ rowId: 2 }, { rowId: 3 }], firstRowId: 1 } };
  const html = render();
  assert.match(html, /data-testid="crew-v4-detail"/);
  assert.match(html, /data-testid="readonly-v4"/);
  assert.equal(renderedRows, snapshot.rows.window);
  assert.equal(readCount, 1);
  assert.match(html, /Only the currently loaded/);
});

test("missing or empty V4 projection has an explicit reason rather than loading forever", () => {
  connected = true;
  snapshot = null;
  let html = render();
  assert.match(html, /Detailed process unavailable/);
  assert.match(html, /Refresh/);
  assert.doesNotMatch(html, /Loading|readonly-v4/);
  snapshot = { rows: { window: [], firstRowId: null } };
  html = render();
  assert.match(html, /no readable V4 timeline/);
  assert.doesNotMatch(html, /Loading|readonly-v4/);
});

test("disconnected execution workspace never attempts to read a V4 projection", () => {
  connected = false;
  const html = render();
  assert.match(html, /workspace is disconnected/);
  assert.equal(readCount, 0);
  assert.doesNotMatch(html, /readonly-v4/);
});
