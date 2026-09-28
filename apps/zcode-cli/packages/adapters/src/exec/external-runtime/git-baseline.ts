import { execFile } from "node:child_process";

export interface GitCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface GitCommandRunner {
  run(args: readonly string[], cwd: string): Promise<GitCommandResult>;
}

export interface GitDirtyFileBaseline {
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  worktreeHash?: string;
  committedHash?: string;
}

export interface GitWorkspaceBaseline {
  kind: "git";
  root: string;
  head: string;
  branch: string;
  isClean: boolean;
  files: GitDirtyFileBaseline[];
  stagedPatch: string;
  unstagedPatch: string;
  truncated: boolean;
}

export interface WorkspaceChangeSummary {
  changed: boolean;
  conflict: boolean;
  /** 非 git 工作区：无从检测变更；调用方不得把 changed=false 当"没有改动"。 */
  undetectable?: boolean;
}

export interface GitBaselineLimits {
  maxFiles?: number;
  maxPatchBytes?: number;
}

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_PATCH_BYTES = 262_144;

function defaultRunner(): GitCommandRunner {
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

async function gitRoot(cwd: string, runner: GitCommandRunner): Promise<string | undefined> {
  const result = await runner.run(["rev-parse", "--show-toplevel"], cwd);
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim();
}

function parsePorcelainStatus(output: string): { path: string; x: string; y: string }[] {
  const entries: { path: string; x: string; y: string }[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    const path = line.slice(3).trim();
    if (!path || path.includes(" -> ")) continue;
    entries.push({ path, x, y });
  }
  return entries;
}

export async function captureGitWorkspaceBaseline(
  cwd: string,
  runner: GitCommandRunner = defaultRunner(),
  limits: GitBaselineLimits = {},
): Promise<GitWorkspaceBaseline | undefined> {
  const root = await gitRoot(cwd, runner);
  if (!root) return undefined;
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  const maxPatchBytes = limits.maxPatchBytes ?? DEFAULT_MAX_PATCH_BYTES;
  const head = (await runner.run(["rev-parse", "HEAD"], root)).stdout.trim();
  const branch = (await runner.run(["branch", "--show-current"], root)).stdout.trim();
  const status = await runner.run(["status", "--porcelain=v1", "--untracked-files=all"], root);
  const stagedPatch = (await runner.run(["diff", "--cached", "--no-color"], root)).stdout;
  const unstagedPatch = (await runner.run(["diff", "--no-color"], root)).stdout;
  const truncated =
    stagedPatch.length + unstagedPatch.length > maxPatchBytes || parsePorcelainStatus(status.stdout).length > maxFiles;
  const files: GitDirtyFileBaseline[] = [];
  if (!truncated) {
    for (const entry of parsePorcelainStatus(status.stdout)) {
      const untracked = entry.x === "?" && entry.y === "?";
      const hashed = await runner.run(["hash-object", entry.path], root);
      const worktreeHash = hashed.exitCode === 0 ? hashed.stdout.trim() : undefined;
      let committedHash: string | undefined;
      if (!untracked) {
        const committed = await runner.run(["rev-parse", `HEAD:${entry.path}`], root);
        if (committed.exitCode === 0) committedHash = committed.stdout.trim();
      }
      files.push({
        path: entry.path,
        staged: entry.x !== " " && entry.x !== "?",
        unstaged: entry.y !== " " && entry.y !== "?",
        untracked,
        ...(worktreeHash ? { worktreeHash } : {}),
        ...(committedHash ? { committedHash } : {}),
      });
    }
  }
  return {
    kind: "git",
    root,
    head,
    branch,
    isClean: files.length === 0,
    files,
    stagedPatch,
    unstagedPatch,
    truncated,
  };
}

async function currentHash(runner: GitCommandRunner, root: string, path: string): Promise<string | undefined> {
  const result = await runner.run(["hash-object", path], root);
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim();
}

export async function compareWorkspaceToBaseline(
  baseline: GitWorkspaceBaseline,
  runner: GitCommandRunner = defaultRunner(),
): Promise<WorkspaceChangeSummary> {
  if (baseline.truncated) return { changed: true, conflict: true };
  const head = (await runner.run(["rev-parse", "HEAD"], baseline.root)).stdout.trim();
  if (head !== baseline.head) return { changed: true, conflict: true };
  const status = await runner.run(["status", "--porcelain=v1", "--untracked-files=all"], baseline.root);
  const current = new Map(parsePorcelainStatus(status.stdout).map((entry) => [entry.path, entry]));
  let changed = false;
  for (const file of baseline.files) {
    const entry = current.get(file.path);
    if (!entry) {
      if (file.untracked) return { changed: true, conflict: true };
      const hash = await currentHash(runner, baseline.root, file.path);
      if (hash !== file.worktreeHash) return { changed: true, conflict: true };
      changed = true;
      continue;
    }
    if (entry.x === "?" && entry.y === "?") {
      if (!file.untracked) {
        changed = true;
        continue;
      }
      const hash = await currentHash(runner, baseline.root, file.path);
      if (hash !== file.worktreeHash) return { changed: true, conflict: true };
      continue;
    }
    if (file.untracked) return { changed: true, conflict: true };
    const hash = await currentHash(runner, baseline.root, file.path);
    if (hash !== file.worktreeHash) {
      const wasDirtyAtBaseline =
        file.committedHash === undefined || file.worktreeHash !== file.committedHash;
      if (wasDirtyAtBaseline) return { changed: true, conflict: true };
      changed = true;
    }
  }
  for (const path of current.keys()) {
    if (!baseline.files.some((file) => file.path === path)) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    const stagedPatch = (await runner.run(["diff", "--cached", "--no-color"], baseline.root)).stdout;
    const unstagedPatch = (await runner.run(["diff", "--no-color"], baseline.root)).stdout;
    if (stagedPatch !== baseline.stagedPatch || unstagedPatch !== baseline.unstagedPatch) changed = true;
  }
  return { changed, conflict: false };
}

export interface WorkspaceGuard {
  isClean(): Promise<boolean>;
  detectChanges(): Promise<WorkspaceChangeSummary>;
}

export function beginWorkspaceGuard(
  cwd: string,
  runner: GitCommandRunner = defaultRunner(),
  limits: GitBaselineLimits = {},
): WorkspaceGuard {
  let captured: Promise<GitWorkspaceBaseline | undefined> | undefined;
  const baseline = () => {
    captured ??= captureGitWorkspaceBaseline(cwd, runner, limits);
    return captured;
  };
  return {
    // 非 git 工作区不是"脏"：没有 git 保护就无从谈起 git 层面限制，
    // 必须放行执行（isClean）且结束时无从检测变更（不构成 conflict）。
    isClean: async () => {
      const base = await baseline();
      if (!base) return true;
      return base.isClean && !base.truncated;
    },
    detectChanges: async () => {
      const base = await baseline();
      if (!base) return { changed: false, conflict: false, undetectable: true };
      return compareWorkspaceToBaseline(base, runner);
    },
  };
}
