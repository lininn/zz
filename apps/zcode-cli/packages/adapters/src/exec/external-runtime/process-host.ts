import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { spawn as nodeSpawn } from "node:child_process";

export const EXTERNAL_RUNTIME_ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR"] as const;
const SENSITIVE_ENVIRONMENT_KEY =
  /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTH|COOKIE)(?:_|$)|^(?:SSH_AUTH_SOCK|GIT_ASKPASS)$/i;
const DEFAULT_FORBIDDEN_RUNTIME_COMMANDS = ["zcode", "claude", "codex"] as const;
const LEAF_POLICY_VIOLATION_EVENT_TYPES = new Set([
  "agent_started",
  "delegation_started",
  "spawn_agent",
  "subagent_started",
  "subagent_created",
]);

export interface ExternalRuntimeCommand {
  executable: string;
  args?: readonly string[];
}

export interface ExternalRuntimeProcessStartOptions {
  command: ExternalRuntimeCommand;
  accessMode: "read" | "write";
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
  envAllowlist?: readonly string[];
  outerSandboxReady: boolean;
  networkProfile: "allowed" | "restricted" | "disabled";
  allowTrustedRuntimeEntry?: string;
  forbiddenExecutables?: readonly string[];
  supervisor?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    interruptGraceMs?: number;
    terminateGraceMs?: number;
  };
  task?: { taskId: string; attemptId: string; runtimeId: string };
}

export interface ExternalRuntimeOutputChunk {
  stream: "stdout" | "stderr";
  data: string;
}

export type ExternalRuntimeTerminationReason =
  | "exit"
  | "interrupt"
  | "cancelled"
  | "timeout"
  | "output_limit"
  | "policy_violation";

export interface ExternalRuntimeProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  reason: ExternalRuntimeTerminationReason;
  outputBytes: number;
}

export interface ExternalRuntimeProcessManifest {
  outerSandboxReady: true;
  networkProfile: "allowed" | "restricted" | "disabled";
  ownershipToken: string;
  task?: { taskId: string; attemptId: string; runtimeId: string };
}

export interface ExternalRuntimeProcessHandle {
  pid: number;
  output: AsyncIterable<ExternalRuntimeOutputChunk>;
  completed: Promise<ExternalRuntimeProcessResult>;
  manifest: ExternalRuntimeProcessManifest;
  interrupt(): Promise<void>;
  cancel(): Promise<void>;
  policyViolation(): Promise<void>;
}

export interface ExternalRuntimeChildStream {
  on(event: "data", listener: (data: unknown) => void): unknown;
}

export interface ExternalRuntimeChildStdin {
  write(data: string): unknown;
  end(): unknown;
}

export interface ExternalRuntimeChildProcess {
  readonly pid?: number;
  readonly stdout?: ExternalRuntimeChildStream | null;
  readonly stderr?: ExternalRuntimeChildStream | null;
  readonly stdin?: ExternalRuntimeChildStdin | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (error: unknown) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
}

type SpawnFunction = (
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string>; stdio: "pipe" | "ignore" },
) => ExternalRuntimeChildProcess;

export interface ExternalRuntimeProcessHostDependencies {
  spawn?: SpawnFunction;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
  delay?: (ms: number) => Promise<void>;
}

export function buildExternalRuntimeEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  allowlist: readonly string[] = EXTERNAL_RUNTIME_ENV_ALLOWLIST,
  additions: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of allowlist) {
    const value = source[key];
    if (value !== undefined && !SENSITIVE_ENVIRONMENT_KEY.test(key)) environment[key] = value;
  }
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function commandName(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? value;
  return base.toLowerCase().replace(/\.(?:cmd|exe)$/, "");
}

function executableNames(value: string): string[] {
  const names = [value];
  try {
    names.push(realpathSync(value));
  } catch {
    return names;
  }
  return names;
}

function isForbiddenExecutable(value: string, forbidden: readonly string[]): boolean {
  const forbiddenNames = new Set(forbidden.map((name) => name.toLowerCase()));
  return executableNames(value).some((candidate) => forbiddenNames.has(commandName(candidate)));
}

export function assertExternalRuntimeCommand(
  command: ExternalRuntimeCommand,
  options: { allowTrustedRuntimeEntry?: string; forbiddenExecutables?: readonly string[] } = {},
): void {
  const forbidden = options.forbiddenExecutables ?? DEFAULT_FORBIDDEN_RUNTIME_COMMANDS;
  const trusted = options.allowTrustedRuntimeEntry?.toLowerCase();
  const topLevel = commandName(command.executable);
  const trustedTopLevel = trusted !== undefined && topLevel === trusted;
  const recursive = trustedTopLevel
    ? (command.args ?? []).some((argument) => isForbiddenExecutable(argument, forbidden))
    : isForbiddenExecutable(command.executable, forbidden) ||
      (command.args ?? []).some((argument) => isForbiddenExecutable(argument, forbidden));
  if (recursive) {
    throw new Error("External runtime leaf policy forbids recursive runtime invocation");
  }
}

export function isExternalRuntimePolicyViolationEvent(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const record = event as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.toLowerCase() : undefined;
  if (type && LEAF_POLICY_VIOLATION_EVENT_TYPES.has(type)) return true;
  const command = record.command;
  if (command && typeof command === "object") {
    const executable = (command as { executable?: unknown }).executable;
    if (typeof executable === "string") {
      return isForbiddenExecutable(executable, DEFAULT_FORBIDDEN_RUNTIME_COMMANDS);
    }
  }
  return false;
}

class AsyncOutputQueue implements AsyncIterable<ExternalRuntimeOutputChunk> {
  private readonly queued: ExternalRuntimeOutputChunk[] = [];
  private readonly readers: Array<(result: IteratorResult<ExternalRuntimeOutputChunk>) => void> = [];
  private closed = false;

  push(chunk: ExternalRuntimeOutputChunk): void {
    if (this.closed) return;
    const reader = this.readers.shift();
    if (reader) reader({ value: chunk, done: false });
    else this.queued.push(chunk);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const reader of this.readers.splice(0)) reader({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<ExternalRuntimeOutputChunk> {
    return {
      next: () => {
        const chunk = this.queued.shift();
        if (chunk) return Promise.resolve({ value: chunk, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.readers.push(resolve));
      },
    };
  }
}

function defaultKillProcess(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      return;
    }
  }
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class ExternalRuntimeProcessHost {
  private readonly spawn: SpawnFunction;
  private readonly killProcess: (pid: number, signal: NodeJS.Signals) => void;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(dependencies: ExternalRuntimeProcessHostDependencies = {}) {
    this.spawn =
      dependencies.spawn ??
      ((file, args, options) =>
        nodeSpawn(file, [...args], {
          cwd: options.cwd,
          env: options.env,
          stdio: options.stdio === "pipe" ? ["pipe", "pipe", "pipe"] : "ignore",
        }));
    this.killProcess = dependencies.killProcess ?? defaultKillProcess;
    this.delay = dependencies.delay ?? defaultDelay;
  }

  async start(options: ExternalRuntimeProcessStartOptions): Promise<ExternalRuntimeProcessHandle> {
    if (!options.outerSandboxReady) {
      throw new Error("External runtime requires a verified outer sandbox");
    }
    const allowTrustedRuntimeEntry = options.allowTrustedRuntimeEntry;
    assertExternalRuntimeCommand(
      options.command,
      allowTrustedRuntimeEntry ? { allowTrustedRuntimeEntry } : {},
    );
    const environment = buildExternalRuntimeEnvironment(process.env, options.envAllowlist, options.env);
    const child = this.spawn(options.command.executable, options.command.args ?? [], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: environment,
      stdio: "pipe",
    });
    if (!child.pid) throw new Error("Cannot supervise an external runtime process without a pid");
    const pid = child.pid;
    const output = new AsyncOutputQueue();
    const maxOutputBytes = options.supervisor?.maxOutputBytes;
    const interruptGraceMs = options.supervisor?.interruptGraceMs ?? 1000;
    const terminateGraceMs = options.supervisor?.terminateGraceMs ?? 4000;
    let outputBytes = 0;
    let settled = false;
    let requestedReason: ExternalRuntimeTerminationReason | undefined;
    let termination: Promise<void> | undefined;
    let resolveCompleted!: (result: ExternalRuntimeProcessResult) => void;
    const completed = new Promise<ExternalRuntimeProcessResult>((resolve) => {
      resolveCompleted = resolve;
    });
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      output.close();
      resolveCompleted({ exitCode, signal, reason: requestedReason ?? "exit", outputBytes });
    };
    const terminate = async (reason: ExternalRuntimeTerminationReason, initialSignal: NodeJS.Signals) => {
      if (settled) return;
      requestedReason ??= reason;
      this.killProcess(pid, initialSignal);
      await this.delay(initialSignal === "SIGINT" ? interruptGraceMs : terminateGraceMs);
      if (settled) return;
      if (initialSignal === "SIGINT") {
        this.killProcess(pid, "SIGTERM");
        await this.delay(terminateGraceMs);
        if (settled) return;
      }
      if (!settled) this.killProcess(pid, "SIGKILL");
    };
    const beginTermination = (reason: ExternalRuntimeTerminationReason, signal: NodeJS.Signals) => {
      if (!termination) termination = terminate(reason, signal);
      return termination;
    };
    const observe = (stream: "stdout" | "stderr", data: unknown) => {
      const text = typeof data === "string" ? data : String(data);
      outputBytes += Buffer.byteLength(text);
      if (maxOutputBytes !== undefined && outputBytes > maxOutputBytes) {
        output.push({ stream, data: text });
        void beginTermination("output_limit", "SIGTERM");
        return;
      }
      output.push({ stream, data: text });
    };
    child.stdout?.on("data", (data: unknown) => observe("stdout", data));
    child.stderr?.on("data", (data: unknown) => observe("stderr", data));
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal));
    child.once("error", () => finish(null, null));
    if (options.stdin !== undefined) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }
    if (options.supervisor?.timeoutMs !== undefined) {
      const timeoutMs = options.supervisor.timeoutMs;
      if (timeoutMs < 0) throw new Error("External runtime timeout cannot be negative");
      void this.delay(timeoutMs).then(() => {
        if (!settled) void beginTermination("timeout", "SIGTERM");
      });
    }
    return {
      pid,
      output,
      completed,
      manifest: {
        outerSandboxReady: true,
        networkProfile: options.networkProfile,
        ownershipToken: randomUUID().replace(/-/g, ""),
        ...(options.task ? { task: options.task } : {}),
      },
      interrupt: () => beginTermination("interrupt", "SIGINT"),
      cancel: () => beginTermination("cancelled", "SIGTERM"),
      policyViolation: () => beginTermination("policy_violation", "SIGTERM"),
    };
  }
}
