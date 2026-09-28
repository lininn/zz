import assert from "node:assert/strict";
import test from "node:test";
import { handleDelegateCommand } from "../../src/command-center/handlers/delegate.js";
import type { CommandCenterApp, CommandCenterDeps } from "../../src/command-center/types.js";

function deps(app: Partial<CommandCenterApp>): CommandCenterDeps {
  return {
    getApp: async () => app as CommandCenterApp,
    resumeApp: async () => app as CommandCenterApp,
  };
}

test("dispatch forwards parsed input with session context", async () => {
  const captured: unknown[] = [];
  const result = await handleDelegateCommand(
    `--role reviewer "review current branch"`,
    deps({
      sessionId: "sess_1",
      traceId: "trace-1",
      dispatchExternalRuntime: async (input) => {
        captured.push(input);
        return { taskId: "task-9", queuePosition: 2 };
      },
    }),
  );
  assert.match(result.response ?? "", /task-9/);
  assert.match(result.response ?? "", /position 2/);
  const input = captured[0] as Record<string, unknown>;
  assert.equal(input.sessionId, "sess_1");
  assert.equal(input.traceId, "trace-1");
  assert.equal(input.role, "reviewer");
  assert.equal(input.accessMode, "read");
});

test("parse errors return usage text", async () => {
  const result = await handleDelegateCommand(
    `--role reviewer --write "task"`,
    deps({ sessionId: "sess_1", traceId: "trace-1" }),
  );
  assert.match(result.response ?? "", /cannot run write tasks/);
  assert.match(result.response ?? "", /Usage: \/delegate/);
});

test("missing app capability responds unavailable", async () => {
  const result = await handleDelegateCommand(
    `"some task"`,
    deps({ sessionId: "sess_1", traceId: "trace-1" }),
  );
  assert.match(result.response ?? "", /not available in this client/);
});

test("fixed runtime aliases reject conflicting runtimes", async () => {
  const result = await handleDelegateCommand(
    `--runtime codex-cli "task"`,
    deps({ sessionId: "sess_1", traceId: "trace-1" }),
    "claude-cli",
  );
  assert.match(result.response ?? "", /fixed to claude-cli/);
});

test("list formats task states and pause reasons", async () => {
  const result = await handleDelegateCommand(
    `list`,
    deps({
      sessionId: "sess_1",
      traceId: "trace-1",
      listExternalRuntimeTasks: async () => [
        { taskId: "task-1", runtimeId: "claude-cli", runtimeState: "awaiting_permission", pauseReason: "external runtime requested permission" },
        { taskId: "task-2", runtimeId: "claude-cli", runtimeState: "queued" },
      ],
    }),
  );
  assert.match(result.response ?? "", /task-1 · claude-cli · awaiting_permission/);
  assert.match(result.response ?? "", /task-2 · claude-cli · queued/);
});

test("cleanup and diff delegate to the app with task ids", async () => {
  const cleaned: string[] = [];
  const diffed: string[] = [];
  const makeDeps = () =>
    deps({
      sessionId: "sess_1",
      traceId: "trace-1",
      cleanupExternalRuntimeTask: async (input) => {
        cleaned.push(input.taskId);
        return { cleaned: true };
      },
      diffExternalRuntimeTask: async (input) => {
        diffed.push(input.taskId);
        return { diff: "+added", untracked: ["new.txt"], truncated: false };
      },
    });
  const withoutId = await handleDelegateCommand(`cleanup`, makeDeps());
  assert.match(withoutId.response ?? "", /cleanup <taskId>/);
  const cleanupResult = await handleDelegateCommand(`cleanup task-1`, makeDeps());
  assert.deepEqual(cleaned, ["task-1"]);
  assert.match(cleanupResult.response ?? "", /Cleaned up worktree for external runtime task task-1/);
  const diffResult = await handleDelegateCommand(`diff task-1`, makeDeps());
  assert.deepEqual(diffed, ["task-1"]);
  assert.match(diffResult.response ?? "", /\+added/);
  assert.match(diffResult.response ?? "", /new\.txt/);
});

test("cancel requires an id and reports the outcome", async () => {
  const withoutId = await handleDelegateCommand(
    `cancel`,
    deps({ sessionId: "sess_1", traceId: "trace-1" }),
  );
  assert.match(withoutId.response ?? "", /cancel <taskId>/);
  const cancelled: string[] = [];
  const withId = await handleDelegateCommand(
    `cancel task-1`,
    deps({
      sessionId: "sess_1",
      traceId: "trace-1",
      cancelExternalRuntimeTask: async (input) => {
        cancelled.push(input.taskId);
        return { cancelled: true };
      },
    }),
  );
  assert.deepEqual(cancelled, ["task-1"]);
  assert.match(withId.response ?? "", /Cancelled external runtime task task-1/);
});
