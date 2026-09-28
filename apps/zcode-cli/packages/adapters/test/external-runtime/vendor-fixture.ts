import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import type { ExternalRuntimeTaskRequest, ExternalRuntimeEventEnvelope } from "@zcode/contracts";
import {
  ExternalRuntimeProcessHost,
  type ExternalRuntimeProcessStartOptions,
} from "../../src/exec/external-runtime/process-host.js";

const fixturePath = fileURLToPath(new URL("./fixtures/vendor-binary.mjs", import.meta.url));
const exec = promisify(execFile);
export async function vendorFixture(t: TestContext, vendor: string, scenario: string) {
  const cwd = await mkdtemp(join(tmpdir(), "crew-vendor-fixture-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const starts: ExternalRuntimeProcessStartOptions[] = [];
  const signals: NodeJS.Signals[] = [];
  const children: ReturnType<typeof spawn>[] = [];
  t.after(() => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const processHost = new ExternalRuntimeProcessHost({
    spawn: (_file, args, options) => {
      const child = spawn(process.execPath, [fixturePath, vendor, scenario, ...args], {
        cwd: options.cwd,
        env: options.env,
        stdio: "pipe",
      });
      children.push(child);
      return child;
    },
    killProcess: (pid, signal) => {
      signals.push(signal);
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    },
  });
  return {
    cwd,
    starts,
    signals,
    host: {
      start: async (options: ExternalRuntimeProcessStartOptions) => {
        starts.push(options);
        return processHost.start({
          ...options,
          supervisor: {
            ...options.supervisor,
            timeoutMs: 5000,
            interruptGraceMs: 20,
            terminateGraceMs: 20,
          },
        });
      },
    },
    runner: {
      findBinary: async () => process.execPath,
      run: async (_binary: string, args: readonly string[]) => {
        const result = await exec(process.execPath, [fixturePath, vendor, "probe", ...args]);
        return { ...result, exitCode: 0 };
      },
    },
  };
}

export function vendorRequest(
  vendor: string,
  path: string,
  overrides: Partial<ExternalRuntimeTaskRequest> = {},
): ExternalRuntimeTaskRequest {
  return {
    schemaVersion: 1,
    taskId: "task-1",
    attemptId: "attempt-1",
    sessionId: "session-1",
    traceId: "trace-1",
    sessionMode: "chat",
    executionMode: "sequential",
    failoverPolicy: "none",
    runtimeId: `${vendor}-cli`,
    role: "executor",
    accessMode: "write",
    networkProfile: "disabled",
    objective: "Do fixture work",
    boundaries: [],
    workspace: { identity: "fixture-workspace", path, kind: "non-git" },
    baseline: { kind: "non-git", ref: "fixture" },
    instructionSnapshotRef: "fixture",
    timeoutMs: 5000,
    budget: { wallTimeMs: 5000 },
    verification: { commandIds: [], skip: true },
    retention: { structuredDays: 1, rawDays: 0, pinned: false },
    ...overrides,
  };
}

export async function collectEvents(source: AsyncIterable<ExternalRuntimeEventEnvelope>) {
  const events: ExternalRuntimeEventEnvelope[] = [];
  for await (const event of source) events.push(event);
  return events;
}
