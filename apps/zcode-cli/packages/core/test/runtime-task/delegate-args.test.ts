import assert from "node:assert/strict";
import test from "node:test";
import { parseDelegateArguments } from "../../src/runtime-task/delegate-args.js";

test("full argument form parses with explicit access and verification", () => {
  const parsed = parseDelegateArguments(
    `--runtime claude-cli --role executor --write --network restricted --verify "pnpm test" "review the login flow"`,
  );
  assert.equal(parsed.runtimeId, "claude-cli");
  assert.equal(parsed.role, "executor");
  assert.equal(parsed.accessMode, "write");
  assert.equal(parsed.objective, "review the login flow");
  assert.deepEqual(parsed.verificationCommands, [["pnpm", "test"]]);
  assert.equal(parsed.skipVerification, false);
  assert.equal(parsed.networkProfile, "restricted");
});

test("read-only roles default to read access", () => {
  const parsed = parseDelegateArguments(`--role reviewer "review current branch"`);
  assert.equal(parsed.role, "reviewer");
  assert.equal(parsed.accessMode, "read");
  assert.equal(parsed.runtimeId, undefined);
});

test("fixed runtime aliases reject conflicting runtimes", () => {
  const parsed = parseDelegateArguments(`investigate login failure`, "claude-cli");
  assert.equal(parsed.runtimeId, "claude-cli");
  assert.throws(() => parseDelegateArguments(`--runtime codex-cli "task"`, "claude-cli"), /fixed to claude-cli/);
});

test("read-only roles reject write access", () => {
  assert.throws(() => parseDelegateArguments(`--role reviewer --write "task"`), /cannot run write tasks/);
  assert.throws(() => parseDelegateArguments(`--role explore`, ""), /objective is required/);
});

test("unsupported combinations fail closed", () => {
  assert.throws(() => parseDelegateArguments(`--chat`), /requires a task id/);
  assert.throws(
    () => parseDelegateArguments(`--skip-verification --verify "pnpm test" "task"`),
    /conflicts with --verify/,
  );
  assert.throws(() => parseDelegateArguments(`--role wizard "task"`), /unsupported role/);
  assert.throws(() => parseDelegateArguments(`--network open "task"`), /unsupported network profile/);
  assert.throws(() => parseDelegateArguments(`--unknown "task"`), /unknown flag/);
  assert.throws(() => parseDelegateArguments(`--runtime`, ), /requires a value/);
});

test("parallel mode is explicit and defaults to sequential", () => {
  assert.equal(parseDelegateArguments(`"task"`).executionMode, "sequential");
  assert.equal(parseDelegateArguments(`--parallel --role reviewer "task"`).executionMode, "parallel");
});

test("chat continuations reference an existing task id", () => {
  const parsed = parseDelegateArguments(`--chat task-1 "continue investigating"`);
  assert.equal(parsed.chatTaskId, "task-1");
  assert.equal(parsed.objective, "continue investigating");
  assert.equal(parseDelegateArguments(`"plain task"`).chatTaskId, undefined);
});

test("dirty and worktree flags are explicit opt-ins", () => {
  const parsed = parseDelegateArguments(`--allow-dirty --worktree "fix parser"`);
  assert.equal(parsed.allowDirtyWorkspace, true);
  assert.equal(parsed.useWorktree, true);
  const defaults = parseDelegateArguments(`"fix parser"`);
  assert.equal(defaults.allowDirtyWorkspace, false);
  assert.equal(defaults.useWorktree, false);
  assert.equal(defaults.networkProfile, "restricted");
});
