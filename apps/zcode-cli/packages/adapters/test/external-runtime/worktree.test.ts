import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import {
  createExternalRuntimeWorktree,
  diffExternalRuntimeWorktree,
  listExternalRuntimeWorktrees,
  removeExternalRuntimeWorktree,
} from "../../src/exec/external-runtime/worktree.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(repo: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", [...args], { cwd: repo });
}

async function makeRepo(): Promise<{ repo: string; worktrees: string }> {
  const root = await mkdtemp(join(tmpdir(), "external-runtime-worktree-"));
  roots.push(root);
  const repo = join(root, "repo");
  const worktrees = join(root, "worktrees");
  await mkdir(repo, { recursive: true });
  await mkdir(worktrees, { recursive: true });
  await git(repo, "init");
  await git(repo, "config", "user.email", "worktree-test@example.invalid");
  await git(repo, "config", "user.name", "Worktree Test");
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  await git(repo, "add", "tracked.txt");
  await git(repo, "commit", "-m", "baseline");
  return { repo, worktrees };
}

test("worktrees isolate execution from the main checkout", async () => {
  const { repo, worktrees } = await makeRepo();
  await writeFile(join(repo, "tracked.txt"), "user dirty\n");
  const worktree = await createExternalRuntimeWorktree(repo, worktrees, "task-1");
  assert.equal(await readFile(join(worktree.path, "tracked.txt"), "utf8"), "committed\n");
  await writeFile(join(worktree.path, "worker.txt"), "worker data\n");
  const canonical = await realpath(worktree.path);
  const listed = await listExternalRuntimeWorktrees(repo);
  assert.ok(listed.includes(canonical));
  assert.ok(!listed.includes(repo));
  await removeExternalRuntimeWorktree(repo, worktree.path);
  assert.ok(!(await listExternalRuntimeWorktrees(repo)).includes(canonical));
});

test("diffs show worker changes against the recorded base", async () => {
  const { repo, worktrees } = await makeRepo();
  const worktree = await createExternalRuntimeWorktree(repo, worktrees, "task-diff");
  await writeFile(join(worktree.path, "tracked.txt"), "worker edit\n");
  await writeFile(join(worktree.path, "worker-untracked.txt"), "worker data\n");
  const evidence = await diffExternalRuntimeWorktree(worktree.path, worktree.baseCommit);
  assert.match(evidence.diff, /worker edit/);
  assert.deepEqual(evidence.untracked, ["worker-untracked.txt"]);
  assert.equal(evidence.truncated, false);
  await assert.rejects(diffExternalRuntimeWorktree(worktree.path, "not-a-sha"));
  await removeExternalRuntimeWorktree(repo, worktree.path);
});

test("invalid task ids and unregistered paths are rejected", async () => {
  const { repo, worktrees } = await makeRepo();
  await assert.rejects(createExternalRuntimeWorktree(repo, worktrees, "../escape"));
  await assert.rejects(createExternalRuntimeWorktree(repo, worktrees, ""));
  await assert.rejects(removeExternalRuntimeWorktree(repo, join(worktrees, "ghost")));
});
