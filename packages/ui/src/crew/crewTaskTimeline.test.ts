import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as shared from "@zcode/shared";
import * as v4 from "@zcode/shared/zcode-protocol-v4";
import { crewCacheScope } from "../hooks/crewCacheScope.js";
import { chatExecution } from "./crewChatFixtures.js";

async function harness(file: string, imports: Record<string, unknown>) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  let state: unknown = null;
  const reads: { key: unknown; fetch: () => Promise<unknown>; options: Record<string, unknown> }[] =
    [];
  const exports: Record<string, (input: shared.CrewExecution) => unknown> = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      JSON,
      Error,
      require: (name: string) => {
        if (name === "react")
          return {
            useReducer: () => [0, () => {}],
            useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
              getSnapshot(),
            useState: () => [
              state,
              (value: unknown) => {
                state = value;
              },
            ],
          };
        if (name === "swr")
          return {
            __esModule: true,
            default: (
              key: unknown,
              fetch: () => Promise<unknown>,
              options: Record<string, unknown>,
            ) => {
              reads.push({ key, fetch, options });
              return {};
            },
          };
        if (name === "@zcode/shared") return shared;
        if (name === "@zcode/shared/zcode-protocol-v4") return v4;
        if (name.endsWith("crewCacheScope.js")) return { crewCacheScope };
        if (name in imports) return imports[name];
        throw new Error(name);
      },
    },
  );
  return { exports, reads };
}

test("V4 timeline only observes an existing store and excludes non-live/stale projections", async () => {
  const snapshot = { sessionId: chatExecution.taskId, rows: { window: [] } };
  const calls: unknown[] = [];
  let live = true;
  let existing = true;
  const agent = {};
  const h = await harness("../hooks/useCrewTaskTimeline.ts", {
    "./useZCodeAgentService.js": { useZCodeAgentService: () => agent },
    "@/v4/workspaceConnectionRegistry.js": {
      peekWorkspaceConversationStore: (...args: unknown[]) => {
        calls.push(args);
        return existing
          ? {
              subscribe: () => () => {},
              getState: () => ({ status: live ? "live" : "closed", snapshot }),
            }
          : null;
      },
    },
  });
  const execution = {
    ...chatExecution,
    workspaceBinding: {
      workspacePath: "/same",
      workspaceIdentity: "remote-A",
      remoteSessionId: "attachment-A",
    },
  };
  const read = () => h.exports.useCrewTaskTimeline!(execution) as { snapshot: unknown };
  assert.equal(read().snapshot, snapshot);
  assert.deepEqual(calls[0], [execution.workspaceBinding, agent, execution.taskId]);
  live = false;
  assert.equal(read().snapshot, null);
  existing = false;
  assert.equal(read().snapshot, null);
  assert.equal(h.reads.length, 0, "Passive timeline must not issue SWR/RPC queries");
});

test("terminal parent projection changes the execution-detail key for a final fetch", async () => {
  const h = await harness("../hooks/useCrewExecutionDetail.ts", {
    "./useServices.js": { useServices: () => ({ crewService: {} }) },
  });
  h.exports.useCrewExecutionDetail!({
    ...chatExecution,
    status: "running",
    taskId: null,
    updatedAt: 1,
  });
  h.exports.useCrewExecutionDetail!({
    ...chatExecution,
    status: "succeeded",
    taskId: "task",
    updatedAt: 2,
  });
  assert.notDeepEqual(h.reads[0]!.key, h.reads[1]!.key);
  assert.equal(h.reads[0]!.options.refreshInterval, 2500);
  assert.equal(h.reads[1]!.options.refreshInterval, 0);
});
