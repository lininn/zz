import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { ProbeCommandRunner } from "./preflight.js";

// codex --version 冷启动实测可达 2.3s+（更新检查）；5s 在并发/冷缓存下会误判为探测失败。
const PROBE_TIMEOUT_MS = 15_000;

function candidatePaths(binary: string, directories: readonly string[]): string[] {
  if (binary.includes("/") || (process.platform === "win32" && binary.includes("\\"))) return [binary];
  const paths = directories.map((directory) => join(directory, binary));
  if (process.platform !== "win32") return paths;
  return paths.flatMap((path) => [`${path}.exe`, `${path}.cmd`, `${path}.bat`, path]);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class SystemProbeRunner implements ProbeCommandRunner {
  constructor(private readonly timeoutMs: number = PROBE_TIMEOUT_MS) {}

  async findBinary(binary: string): Promise<string | undefined> {
    const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    for (const candidate of candidatePaths(binary, directories)) {
      if (await isExecutable(candidate)) return candidate;
    }
    return undefined;
  }

  run(command: string, args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(command, [...args], { timeout: this.timeoutMs }, (error, stdout, stderr) => {
        if (error && "killed" in error && (error as { killed?: boolean }).killed) {
          resolve({ exitCode: 124, stdout: String(stdout), stderr: `${String(stderr)}\nprobe timed out` });
          return;
        }
        resolve({ exitCode: error ? 1 : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    });
  }
}

export function createSystemProbeRunner(timeoutMs?: number): ProbeCommandRunner {
  return new SystemProbeRunner(timeoutMs);
}
