import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  ExternalRuntimeProcessHost,
  assertExternalRuntimeCommand,
  buildExternalRuntimeEnvironment,
  isExternalRuntimePolicyViolationEvent,
  type ExternalRuntimeChildProcess,
} from "../../src/exec/external-runtime/process-host.js";

class FakeStream extends EventEmitter {
  emitData(data: string): void {
    this.emit("data", data);
  }
}

class FakeStdin {
  written: string[] = [];
  ended = false;
  write(data: string): void {
    this.written.push(data);
  }
  end(): void {
    this.ended = true;
  }
}

class FakeChild extends EventEmitter implements ExternalRuntimeChildProcess {
  pid = 4242;
  stdout = new FakeStream();
  stderr = new FakeStream();
  stdin = new FakeStdin();
  killed: NodeJS.Signals[] = [];
  kill(signal?: NodeJS.Signals): void {
    if (signal) this.killed.push(signal);
    queueMicrotask(() => this.emit("exit", 0, null));
  }
  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit("exit", code, signal);
  }
}

test("environment allowlist drops sensitive inherited values but keeps explicit additions", () => {
  const environment = buildExternalRuntimeEnvironment(
    { PATH: "/bin", API_KEY: "secret", TERM: "xterm", CUSTOM: "ignored" },
    ["PATH", "API_KEY", "TERM"],
    { API_KEY: "explicit-task-view", CUSTOM_ADDITION: "kept" },
  );
  assert.deepEqual(environment, {
    PATH: "/bin",
    TERM: "xterm",
    API_KEY: "explicit-task-view",
    CUSTOM_ADDITION: "kept",
  });
});

test("recursive runtime commands and delegation events are rejected", () => {
  assert.throws(() => assertExternalRuntimeCommand({ executable: "/bin/claude", args: ["--print"] }));
  assert.throws(() =>
    assertExternalRuntimeCommand(
      { executable: "/bin/fake", args: ["run", "codex"] },
      { allowTrustedRuntimeEntry: "fake" },
    ),
  );
  assert.doesNotThrow(() =>
    assertExternalRuntimeCommand(
      { executable: "/bin/fake", args: ["--print"] },
      { allowTrustedRuntimeEntry: "fake" },
    ),
  );
  assert.equal(isExternalRuntimePolicyViolationEvent({ type: "subagent_started" }), true);
  assert.equal(
    isExternalRuntimePolicyViolationEvent({ command: { executable: "/bin/codex" } }),
    true,
  );
  assert.equal(isExternalRuntimePolicyViolationEvent({ type: "assistant.message" }), false);
});

test("executable matching is path- and platform-agnostic", () => {
  assert.throws(() => assertExternalRuntimeCommand({ executable: "C:\\tools\\CODEX.EXE", args: [] }));
  assert.throws(() => assertExternalRuntimeCommand({ executable: "/usr/bin/Claude", args: [] }));
  assert.throws(() => assertExternalRuntimeCommand({ executable: "zcode.cmd", args: [] }));
  assert.throws(() =>
    assertExternalRuntimeCommand(
      { executable: "/bin/fake", args: ["C:\\tools\\codex.exe"] },
      { allowTrustedRuntimeEntry: "fake" },
    ),
  );
  assert.doesNotThrow(() =>
    assertExternalRuntimeCommand(
      { executable: "C:\\tools\\FAKE.EXE", args: ["--print"] },
      { allowTrustedRuntimeEntry: "fake" },
    ),
  );
});

test("process host requires outer sandbox and streams completion", async () => {
  const child = new FakeChild();
  const host = new ExternalRuntimeProcessHost({
    spawn: () => child,
    killProcess: (pid, signal) => child.kill(signal),
  });
  await assert.rejects(() =>
    host.start({
      command: { executable: "/bin/fake" },
      accessMode: "read",
      outerSandboxReady: false,
      networkProfile: "restricted",
    }),
  );
  const handle = await host.start({
    command: { executable: "/bin/fake", args: ["--print"] },
    accessMode: "read",
    outerSandboxReady: true,
    networkProfile: "restricted",
    stdin: "hello",
    supervisor: { timeoutMs: 1000, maxOutputBytes: 1024 },
    task: { taskId: "task-1", attemptId: "attempt-1", runtimeId: "fake-cli" },
  });
  assert.equal(handle.pid, 4242);
  assert.equal(handle.manifest.outerSandboxReady, true);
  assert.ok(handle.manifest.ownershipToken.length >= 32);
  const chunks: string[] = [];
  const consume = (async () => {
    for await (const chunk of handle.output) chunks.push(`${chunk.stream}:${chunk.data}`);
  })();
  child.stdout.emitData("chunk-one\n");
  child.stderr.emitData("chunk-two\n");
  child.exit(0, null);
  const completed = await handle.completed;
  await consume;
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.reason, "exit");
  assert.deepEqual(chunks, ["stdout:chunk-one\n", "stderr:chunk-two\n"]);
  assert.deepEqual(child.stdin.written, ["hello"]);
  assert.equal(child.stdin.ended, true);
});

test("output limit terminates the process group", async () => {
  const child = new FakeChild();
  const host = new ExternalRuntimeProcessHost({
    spawn: () => child,
    killProcess: (pid, signal) => child.kill(signal),
  });
  const handle = await host.start({
    command: { executable: "/bin/fake" },
    accessMode: "read",
    outerSandboxReady: true,
    networkProfile: "restricted",
    supervisor: { timeoutMs: 1000, maxOutputBytes: 4, terminateGraceMs: 1 },
  });
  child.stdout.emitData("too much output");
  const completed = await handle.completed;
  assert.equal(completed.reason, "output_limit");
  assert.ok(child.killed.includes("SIGTERM"));
});

test("timeout terminates the process group", async () => {
  const child = new FakeChild();
  const host = new ExternalRuntimeProcessHost({
    spawn: () => child,
    killProcess: (pid, signal) => child.kill(signal),
  });
  const handle = await host.start({
    command: { executable: "/bin/fake" },
    accessMode: "read",
    outerSandboxReady: true,
    networkProfile: "restricted",
    supervisor: { timeoutMs: 5, terminateGraceMs: 1 },
  });
  const completed = await handle.completed;
  assert.equal(completed.reason, "timeout");
  assert.ok(child.killed.includes("SIGTERM"));
});
