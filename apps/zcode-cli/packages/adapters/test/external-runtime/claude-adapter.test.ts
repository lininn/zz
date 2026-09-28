import assert from "node:assert/strict";
import test from "node:test";
import {
  ClaudeCliAdapter,
  CLAUDE_RUNTIME_ID,
} from "../../src/exec/external-runtime/claude-adapter.js";
import type {
  ExternalRuntimeOutputChunk,
  ExternalRuntimeProcessHandle,
  ExternalRuntimeProcessStartOptions,
} from "../../src/exec/external-runtime/process-host.js";
import {
  validateExternalRuntimeEventSequence,
  type ExternalRuntimeEventEnvelope,
  type ExternalRuntimeTaskRequest,
} from "@zcode/contracts";

class ScriptedHandle implements ExternalRuntimeProcessHandle {
  pid = 4242;
  interrupts = 0;
  cancels = 0;
  policyViolations = 0;
  startOptions?: ExternalRuntimeProcessStartOptions;
  private readonly queue: ExternalRuntimeOutputChunk[] = [];
  private readonly readers: Array<(chunk: ExternalRuntimeOutputChunk | undefined) => void> = [];
  private closed = false;
  private resolveCompleted!: (result: { exitCode: number | null; signal: null; reason: "exit"; outputBytes: number }) => void;
  readonly completed = new Promise<{ exitCode: number | null; signal: null; reason: "exit"; outputBytes: number }>(
    (resolve) => {
      this.resolveCompleted = resolve;
    },
  );
  readonly manifest = {
    outerSandboxReady: true as const,
    networkProfile: "restricted" as const,
    ownershipToken: "x".repeat(32),
  };

  get output(): AsyncIterable<ExternalRuntimeOutputChunk> {
    return this;
  }

  push(data: string): void {
    const chunk = { stream: "stdout" as const, data };
    const reader = this.readers.shift();
    if (reader) reader(chunk);
    else this.queue.push(chunk);
  }

  close(exitCode: number | null = 0): void {
    this.closed = true;
    for (const reader of this.readers.splice(0)) reader(undefined);
    this.resolveCompleted({ exitCode, signal: null, reason: "exit", outputBytes: 0 });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ExternalRuntimeOutputChunk> {
    while (true) {
      const chunk = this.queue.shift();
      if (chunk) {
        yield chunk;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<ExternalRuntimeOutputChunk | undefined>((resolve) =>
        this.readers.push(resolve),
      );
      if (!next) return;
      yield next;
    }
  }

  async interrupt(): Promise<void> {
    this.interrupts += 1;
  }

  async cancel(): Promise<void> {
    this.cancels += 1;
  }

  async policyViolation(): Promise<void> {
    this.policyViolations += 1;
  }
}

function request(overrides = {}): ExternalRuntimeTaskRequest {
  return {
    schemaVersion: 1,
    taskId: "task-1",
    attemptId: "attempt-1",
    sessionId: "sess_1",
    traceId: "trace-1",
    runtimeId: CLAUDE_RUNTIME_ID,
    role: "executor",
    accessMode: "write",
    networkProfile: "restricted",
    objective: "fix the login timeout",
    boundaries: ["do not escape workspace"],
    workspace: { identity: "workspace-1", path: "/workspace", kind: "git", branch: "main" },
    baseline: { kind: "git", ref: "abc123" },
    instructionSnapshotRef: "instructions-1",
    timeoutMs: 60_000,
    budget: { wallTimeMs: 60_000, maxOutputBytes: 65536 },
    verification: { commandIds: ["unit"] },
    retention: { structuredDays: 30, rawDays: 7 },
    sessionMode: "one-shot",
    executionMode: "sequential",
    failoverPolicy: "none",
    ...overrides,
  } as ExternalRuntimeTaskRequest;
}

function systemInit() {
  return JSON.stringify({ type: "system", subtype: "init", session_id: "session-1", model: "claude-test" });
}

function assistantText(text: string) {
  return JSON.stringify({ type: "assistant", session_id: "session-1", message: { content: [{ type: "text", text }] } });
}

function toolUse(name: string) {
  return JSON.stringify({
    type: "assistant",
    session_id: "session-1",
    message: { content: [{ type: "tool_use", id: "tool-1", name, input: { path: "a.ts" } }] },
  });
}

function terminalResult() {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    session_id: "session-1",
    structured_output: { summary: "done", status: "succeeded", artifacts: [] },
  });
}

async function collect(iterable: AsyncIterable<ExternalRuntimeEventEnvelope>): Promise<ExternalRuntimeEventEnvelope[]> {
  const events: ExternalRuntimeEventEnvelope[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

test("successful run yields a valid normalized sequence", async () => {
  const handle = new ScriptedHandle();
  const seen: ExternalRuntimeProcessStartOptions[] = [];
  const adapter = new ClaudeCliAdapter({
    processHost: {
      start: async (options) => {
        seen.push(options);
        return handle;
      },
    },
    outerSandboxReady: true,
  });
  const pending = collect(adapter.start(request()));
  handle.push(`${systemInit()}\n${assistantText("working")}\n${toolUse("Read")}\n${terminalResult()}\n`);
  handle.close(0);
  const events = await pending;
  assert.deepEqual(
    events.map((event) => event.type),
    ["task.started", "task.state_changed", "assistant.message", "tool.started", "task.completed"],
  );
  validateExternalRuntimeEventSequence(events);
  const terminal = events.at(-1)?.payload as { summary: string; runtimeState: string; status: string };
  assert.equal(terminal.summary, "done");
  assert.equal(terminal.runtimeState, "succeeded");
  assert.equal(events[1]?.nativeSessionId, "session-1");
  assert.equal(seen[0]?.command.executable, "claude");
  assert.deepEqual(seen[0]?.command.args?.slice(0, 4), ["--print", "--verbose", "--output-format", "stream-json"]);
  assert.equal(seen[0]?.cwd, "/workspace");
  assert.match(seen[0]?.stdin ?? "", /fix the login timeout/);
  assert.equal(seen[0]?.env, undefined);
});

test("unverified configured arguments are rejected before spawning", async () => {
  const handle = new ScriptedHandle();
  let spawned = false;
  const adapter = new ClaudeCliAdapter({
    processHost: {
      start: async () => {
        spawned = true;
        return handle;
      },
    },
    outerSandboxReady: true,
    configuredArgs: ["--max-turns", "5"],
  });
  await assert.rejects(collect(adapter.start(request())), /Unsafe Claude configured argument/);
  assert.equal(spawned, false);
});

test("output schema is passed inline as JSON to a verified flag", async () => {
  const handle = new ScriptedHandle();
  const seen: ExternalRuntimeProcessStartOptions[] = [];
  const adapter = new ClaudeCliAdapter({
    processHost: {
      start: async (options) => {
        seen.push(options);
        return handle;
      },
    },
    outerSandboxReady: true,
    outputSchema: { type: "object", properties: { summary: { type: "string" } } },
  });
  const pending = collect(adapter.start(request()));
  handle.push(`${systemInit()}\n${terminalResult()}\n`);
  handle.close(0);
  await pending;
  const args = seen[0]?.command.args ?? [];
  const flagIndex = args.indexOf("--json-schema");
  assert.ok(flagIndex >= 0);
  assert.deepEqual(JSON.parse(args[flagIndex + 1]!), {
    type: "object",
    properties: { summary: { type: "string" } },
  });
});

test("resume sessions pass the native session id to a verified flag", async () => {
  const handle = new ScriptedHandle();
  const seen: ExternalRuntimeProcessStartOptions[] = [];
  const adapter = new ClaudeCliAdapter({
    processHost: {
      start: async (options) => {
        seen.push(options);
        return handle;
      },
    },
    outerSandboxReady: true,
  });
  const pending = collect(adapter.start(request({ resumeNativeSessionId: "session-9" })));
  handle.push(`${systemInit()}\n${terminalResult()}\n`);
  handle.close(0);
  await pending;
  const args = seen[0]?.command.args ?? [];
  const flagIndex = args.indexOf("--resume");
  assert.ok(flagIndex >= 0);
  assert.equal(args[flagIndex + 1], "session-9");
});

test("malformed lines become warnings without breaking the sequence", async () => {
  const handle = new ScriptedHandle();
  const adapter = new ClaudeCliAdapter({
    processHost: { start: async () => handle },
    outerSandboxReady: true,
  });
  const pending = collect(adapter.start(request()));
  handle.push(`{not-json}\n${systemInit()}\n${terminalResult()}\n`);
  handle.close(0);
  const events = await pending;
  assert.deepEqual(
    events.map((event) => event.type),
    ["task.started", "warning", "task.state_changed", "task.completed"],
  );
  validateExternalRuntimeEventSequence(events);
});

test("recursive delegation fails closed with policy violation", async () => {
  const handle = new ScriptedHandle();
  const adapter = new ClaudeCliAdapter({
    processHost: { start: async () => handle },
    outerSandboxReady: true,
  });
  const pending = collect(adapter.start(request()));
  handle.push(`${systemInit()}\n${JSON.stringify({ type: "subagent_started", session_id: "session-1" })}\n`);
  handle.close(0);
  await assert.rejects(pending, /policy_violation/);
});

test("forbidden tool use fails closed with policy violation", async () => {
  const handle = new ScriptedHandle();
  const adapter = new ClaudeCliAdapter({
    processHost: { start: async () => handle },
    outerSandboxReady: true,
  });
  const pending = collect(adapter.start(request()));
  handle.push(`${systemInit()}\n${toolUse("Task")}\n`);
  handle.close(0);
  await assert.rejects(pending, /policy_violation/);
});

test("permission requests are surfaced as events for the coordinator", async () => {
  const handle = new ScriptedHandle();
  const adapter = new ClaudeCliAdapter({
    processHost: { start: async () => handle },
    outerSandboxReady: true,
  });
  const pending = collect(adapter.start(request()));
  handle.push(
    `${systemInit()}\n${JSON.stringify({ type: "permission_request", session_id: "session-1", request_id: "p-1" })}\n${terminalResult()}\n`,
  );
  handle.close(0);
  const events = await pending;
  assert.ok(events.some((event) => event.type === "permission.requested"));
  validateExternalRuntimeEventSequence(events);
});

test("cancel routes to the running process handle", async () => {
  const handle = new ScriptedHandle();
  const adapter = new ClaudeCliAdapter({
    processHost: { start: async () => handle },
    outerSandboxReady: true,
  });
  const iterator = adapter.start(request())[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.value?.type, "task.started");
  await adapter.cancel({ taskId: "task-1", attemptId: "attempt-1", runtimeId: CLAUDE_RUNTIME_ID });
  assert.equal(handle.cancels, 1);
  handle.push(`${terminalResult()}\n`);
  handle.close(0);
  const rest: ExternalRuntimeEventEnvelope[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    rest.push(next.value);
  }
  assert.equal(rest.at(-1)?.type, "task.completed");
});
