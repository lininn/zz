import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";

export interface WorktreeCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface WorktreeCommandRunner {
  run(args: readonly string[], cwd: string): Promise<WorktreeCommandResult>;
}

export interface ExternalWorktree {
  path: string;
  baseCommit: string;
}

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function defaultRunner(): WorktreeCommandRunner {
  return {
    run: (args, cwd) =>
      new Promise((resolve) => {
        execFile("git", [...args], { cwd }, (error, stdout, stderr) => {
          resolve({
            exitCode: error ? ((error as { code?: number | null }).code ?? 1) : 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        });
      }),
  };
}

function requireTaskId(taskId: string): string {
  if (!SAFE_TASK_ID.test(taskId)) throw new Error(`Invalid external runtime task id: ${taskId}`);
  return taskId;
}

export async function listExternalRuntimeWorktrees(
  root: string,
  runner: WorktreeCommandRunner = defaultRunner(),
): Promise<string[]> {
  const result = await runner.run(["worktree", "list", "--porcelain"], root);
  if (result.exitCode !== 0) throw new Error(`git worktree list failed: ${result.stderr.trim()}`);
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

export async function createExternalRuntimeWorktree(
  root: string,
  parentDir: string,
  taskId: string,
  runner: WorktreeCommandRunner = defaultRunner(),
): Promise<ExternalWorktree> {
  requireTaskId(taskId);
  const base = await runner.run(["rev-parse", "HEAD"], root);
  if (base.exitCode !== 0 || !base.stdout.trim()) {
    throw new Error(`Cannot determine HEAD for external runtime worktree: ${base.stderr.trim()}`);
  }
  const baseCommit = base.stdout.trim();
  const path = `${parentDir.replace(/\/+$/, "")}/${taskId}`;
  const added = await runner.run(["worktree", "add", "--detach", path, baseCommit], root);
  if (added.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${added.stderr.trim()}`);
  }
  return { path, baseCommit };
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export interface ExternalWorktreeDiff {
  diff: string;
  untracked: string[];
  truncated: boolean;
}

export async function diffExternalRuntimeWorktree(
  worktreePath: string,
  baseCommit: string,
  runner: WorktreeCommandRunner = defaultRunner(),
  maxBytes = 262_144,
): Promise<ExternalWorktreeDiff> {
  if (!/^[0-9a-f]{4,64}$/i.test(baseCommit)) throw new Error(`Invalid base commit: ${baseCommit}`);
  const tracked = await runner.run(["diff", "--no-color", baseCommit], worktreePath);
  if (tracked.exitCode !== 0) {
    throw new Error(`git diff failed: ${tracked.stderr.trim()}`);
  }
  const untrackedResult = await runner.run(["ls-files", "--others", "--exclude-standard"], worktreePath);
  const untracked = untrackedResult.exitCode === 0
    ? untrackedResult.stdout.split("\n").map((line) => line.trim()).filter(Boolean)
    : [];
  const diff = tracked.stdout;
  if (diff.length <= maxBytes) return { diff, untracked, truncated: false };
  return { diff: `${diff.slice(0, maxBytes - 14)}\n[truncated]`, untracked, truncated: true };
}

export async function removeExternalRuntimeWorktree(
  root: string,
  path: string,
  runner: WorktreeCommandRunner = defaultRunner(),
): Promise<void> {
  const registered = (await listExternalRuntimeWorktrees(root, runner)).map(canonical);
  if (!registered.includes(canonical(path))) {
    throw new Error(`Refusing to remove unregistered worktree path: ${path}`);
  }
  const removed = await runner.run(["worktree", "remove", "--force", path], root);
  if (removed.exitCode !== 0) {
    throw new Error(`git worktree remove failed: ${removed.stderr.trim()}`);
  }
  await runner.run(["worktree", "prune"], root);
}
