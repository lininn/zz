import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import {
  beginWorkspaceGuard,
  captureGitWorkspaceBaseline,
} from "../../src/exec/external-runtime/git-baseline.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(repo: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", [...args], { cwd: repo });
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-baseline-"));
  roots.push(root);
  const repo = join(root, "repo");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(repo, { recursive: true });
  await git(repo, "init");
  await git(repo, "config", "user.email", "baseline-test@example.invalid");
  await git(repo, "config", "user.name", "Baseline Test");
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  await git(repo, "add", "tracked.txt");
  await git(repo, "commit", "-m", "baseline");
  return repo;
}

test("non-git directories pass through without git-level protection", async () => {
  // 非 git 工作区不是"脏"：无 git 保护即无 git 层面限制，执行放行且不构成 conflict。
  const root = await mkdtemp(join(tmpdir(), "external-runtime-nongit-"));
  roots.push(root);
  assert.equal(await captureGitWorkspaceBaseline(root), undefined);
  const guard = beginWorkspaceGuard(root);
  assert.equal(await guard.isClean(), true);
  assert.deepEqual(await guard.detectChanges(), { changed: false, conflict: false, undetectable: true });
});

test("clean baseline detects worker modifications without conflict", async () => {
  const repo = await makeRepo();
  const guard = beginWorkspaceGuard(repo);
  assert.equal(await guard.isClean(), true);
  await writeFile(join(repo, "tracked.txt"), "worker edit\n");
  await writeFile(join(repo, "new.txt"), "new file\n");
  assert.deepEqual(await guard.detectChanges(), { changed: true, conflict: false });
});

test("reverted workspaces report no change", async () => {
  const repo = await makeRepo();
  const guard = beginWorkspaceGuard(repo);
  await writeFile(join(repo, "tracked.txt"), "worker edit\n");
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  assert.deepEqual(await guard.detectChanges(), { changed: false, conflict: false });
});

test("deleted baseline dirty content is a conflict, additions are not", async () => {
  const repo = await makeRepo();
  await writeFile(join(repo, "tracked.txt"), "user dirty\n");
  await writeFile(join(repo, "user-untracked.txt"), "user data\n");
  const guard = beginWorkspaceGuard(repo);
  assert.equal(await guard.isClean(), false);
  await writeFile(join(repo, "worker.txt"), "worker data\n");
  assert.deepEqual(await guard.detectChanges(), { changed: true, conflict: false });
  await writeFile(join(repo, "tracked.txt"), "worker replaced dirty content\n");
  assert.deepEqual(await guard.detectChanges(), { changed: true, conflict: true });
});

test("deleted untracked baseline files and moved HEAD are conflicts", async () => {
  const repo = await makeRepo();
  await writeFile(join(repo, "user-untracked.txt"), "user data\n");
  const guard = beginWorkspaceGuard(repo);
  assert.equal(await guard.isClean(), false);
  const { rm } = await import("node:fs/promises");
  await rm(join(repo, "user-untracked.txt"));
  assert.deepEqual(await guard.detectChanges(), { changed: true, conflict: true });

  const repo2 = await makeRepo();
  const guard2 = beginWorkspaceGuard(repo2);
  assert.equal(await guard2.isClean(), true);
  await writeFile(join(repo2, "tracked.txt"), "second commit\n");
  await git(repo2, "add", "tracked.txt");
  await git(repo2, "commit", "-m", "moved head");
  assert.deepEqual(await guard2.detectChanges(), { changed: true, conflict: true });
});

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
