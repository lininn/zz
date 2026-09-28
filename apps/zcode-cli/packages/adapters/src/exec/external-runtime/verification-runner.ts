import { execFile } from "node:child_process";

export interface ExternalRuntimeVerificationCommand {
  id: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface ExternalRuntimeVerificationCommandEvidence {
  id: string;
  argv: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ExternalRuntimeVerificationEvidence {
  status: "passed" | "failed";
  commands: ExternalRuntimeVerificationCommandEvidence[];
}

export interface ExternalRuntimeVerificationRunnerOptions {
  cwd: string;
  timeoutMs: number;
  maxLogChars?: number;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_MAX_LOG_CHARS = 32_000;
const REDACTION_PATTERNS = [
  /\b((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)([^\s]+)/gi,
  /\b(bearer\s+)([a-z0-9._~+/=-]+)/gi,
];

export function redactVerificationLog(value: string): string {
  return REDACTION_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, (_match, prefix: string) => `${prefix}[REDACTED]`),
    value,
  );
}

function truncateLog(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const suffix = "[truncated]";
  if (maxChars <= suffix.length) return suffix.slice(0, maxChars);
  return `${value.slice(0, maxChars - suffix.length)}${suffix}`;
}

export async function runExternalRuntimeVerification(
  commands: readonly ExternalRuntimeVerificationCommand[],
  options: ExternalRuntimeVerificationRunnerOptions,
): Promise<ExternalRuntimeVerificationEvidence> {
  const maxLogChars = options.maxLogChars ?? DEFAULT_MAX_LOG_CHARS;
  const evidence: ExternalRuntimeVerificationCommandEvidence[] = [];
  for (const command of commands) {
    if (!command.argv[0]) throw new Error(`Verification command ${command.id} has empty argv`);
    const startedAt = Date.now();
    const result = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      timedOut: boolean;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      const child = execFile(
        command.argv[0]!,
        command.argv.slice(1),
        {
          cwd: command.cwd ?? options.cwd,
          env: options.env,
          timeout: command.timeoutMs ?? options.timeoutMs,
          maxBuffer: Math.max(maxLogChars * 4, 64_000),
        },
        (error, stdout, stderr) => {
          if (error && "killed" in error && (error as { killed?: boolean }).killed) {
            resolve({ exitCode: null, signal: (error as { signal?: NodeJS.Signals | null }).signal ?? null, timedOut: true, stdout: String(stdout), stderr: String(stderr) });
            return;
          }
          resolve({
            exitCode: error ? ((error as { code?: number | null }).code ?? 1) : 0,
            signal: (error as { signal?: NodeJS.Signals | null } | null)?.signal ?? null,
            timedOut: false,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        },
      );
      child.on("error", () => undefined);
    });
    evidence.push({
      id: command.id,
      argv: [...command.argv],
      cwd: command.cwd ?? options.cwd,
      exitCode: result.exitCode,
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut: result.timedOut,
      signal: result.signal,
      stdout: truncateLog(redactVerificationLog(result.stdout), maxLogChars),
      stderr: truncateLog(redactVerificationLog(result.stderr), maxLogChars),
    });
  }
  return {
    status: evidence.every((command) => command.exitCode === 0 && !command.timedOut) ? "passed" : "failed",
    commands: evidence,
  };
}
