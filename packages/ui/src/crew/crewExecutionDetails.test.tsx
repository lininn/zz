import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { CrewExecution, CrewExecutionDetail } from "@zcode/shared";
import { ZCodeIntlProvider } from "../i18n/IntlProvider.js";
import { useCrewText } from "../hooks/useCrewText.js";
import * as presentation from "./crewChatPresentation.js";

const execution: CrewExecution = {
  executionId: "run",
  groupId: "g",
  conversationId: "c",
  messageId: "m",
  memberId: "member",
  epoch: 1,
  status: "succeeded",
  taskId: "task",
  ownerId: null,
  workspaceBinding: { workspacePath: "/project" },
  createdAt: 0,
  updatedAt: 1,
  memberSnapshot: {
    memberId: "member",
    agentId: "agent",
    name: "Agent",
    rolePrompt: "Review",
    runtime: "codex-cli",
    accessMode: "read",
    configVersion: "v1",
  },
};
let result: { data?: CrewExecutionDetail; error?: Error; isLoading?: boolean } = {};
const source = await readFile(new URL("./CrewExecutionDetails.tsx", import.meta.url), "utf8");
const exports: { CrewExecutionDetails?: React.ComponentType<{ execution: CrewExecution }> } = {};
runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText,
  {
    exports,
    require: (name: string) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsx;
      if (name.endsWith("useCrewText.js")) return { useCrewText };
      if (name.endsWith("useCrewExecutionDetail.js"))
        return { useCrewExecutionDetail: () => ({ ...result, mutate: async () => {} }) };
      if (name.endsWith("button.js")) return { Button: "button" };
      // 纯展示逻辑用真实实现，避免桩与产出的截断行为漂移。
      if (name.endsWith("crewChatPresentation.js")) return presentation;
      // 外部详情不得初始化 V4/Host；任何错误分支穿透都让测试失败。
      return new Proxy(
        {},
        {
          get: () => () => {
            throw new Error(`Unexpected V4 call: ${name}`);
          },
        },
      );
    },
  },
);
function html() {
  const Component = exports.CrewExecutionDetails!;
  return renderToStaticMarkup(
    <ZCodeIntlProvider initialLocale="en-US">
      <Component execution={execution} />
    </ZCodeIntlProvider>,
  );
}

test("external summary leads as the member output, with the process note kept below it", () => {
  result = {
    data: {
      execution,
      unavailableReason: "externalEventsUnavailable",
      runtimeTask: {
        taskId: "task",
        runtimeId: "codex-cli",
        runtimeState: "succeeded",
        summary: "<script>untrusted</script>",
        settled: true,
      },
    },
  };
  const rendered = html();
  const outputAt = rendered.indexOf("&lt;script&gt;untrusted&lt;/script&gt;");
  const noticeAt = rendered.indexOf("Detailed process unavailable");
  // 产出是该成员这一轮的正文，必须排在「过程不可用」说明之前——
  // 否则用户看到的第一句是诊断，而不是 agent 交付了什么。
  assert.ok(outputAt >= 0, "runtime summary must render as real text");
  assert.ok(noticeAt > outputAt, "the honest process note stays, but after the output");
  assert.match(rendered, /does not expose step-by-step events/);
  // 正文不再挂在「运行时返回的摘要」这类诊断标签下。
  assert.doesNotMatch(rendered, /Summary returned by the runtime/);
  assert.doesNotMatch(rendered, /<script>/);
});

test("task not yet created shows its reason without an empty timeline or V4 initialization", () => {
  result = {
    data: {
      execution: { ...execution, taskId: null },
      runtimeTask: null,
      unavailableReason: "taskNotCreated",
    },
  };
  assert.match(html(), /has not created a task yet/);
});

test("read failure replaces stale detail and offers a bounded manual retry", () => {
  result = { error: new Error("private backend failure") };
  const rendered = html();
  assert.match(rendered, /bound runtime record could not be read/);
  assert.match(rendered, /Refresh/);
  assert.doesNotMatch(rendered, /private backend failure/);
});

test("loading is distinct from unavailable and never renders a fabricated result", () => {
  result = { isLoading: true };
  const rendered = html();
  assert.match(rendered, /Loading/);
  assert.doesNotMatch(rendered, /Summary returned|succeeded/);
});
