import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CrewLeaseStore } from "../src/crew/crewLease.js";

async function stores() {
  const dir = await mkdtemp(join(tmpdir(), "crew-lease-"));
  const live = new Set([900001, 900002, 910001]);
  const alive = (pid: number) => live.has(pid);
  const path = join(dir, "tasks-index.sqlite");
  const a = new CrewLeaseStore(path, "900001:host-a", alive, alive);
  const b = new CrewLeaseStore(path, "900002:host-b", alive, alive);
  return {
    a,
    b,
    live,
    async close() {
      a.close();
      b.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("two crews and ordinary sessions share a cross-connection writer lease", async () => {
  const f = await stores();
  try {
    const lease = await f.a.acquire({
      workspaceKey: "workspace:one",
      sessionId: "crew-one",
      runtimePid: 910001,
    });
    await assert.rejects(
      f.a.acquire({ workspaceKey: "workspace:one", sessionId: "crew-two" }),
      /workspaceBusy/,
    );
    await assert.rejects(
      f.b.acquire({ workspaceKey: "workspace:one", sessionId: "ordinary-session" }),
      /workspaceBusy/,
    );
    assert.equal(
      (await f.a.acquire({ workspaceKey: "workspace:one", sessionId: "crew-one" })).token,
      lease.token,
    );
    await f.b.acquire({ workspaceKey: "workspace:two", sessionId: "ordinary-session" });
    assert.equal(await f.a.release(lease), true);
    const next = await f.b.acquire({
      workspaceKey: "workspace:one",
      sessionId: "ordinary-session",
    });
    assert.equal(await f.a.release(lease), false);
    assert.equal((await f.a.get("workspace:one"))?.token, next.token);
  } finally {
    await f.close();
  }
});
test("crashed Host cannot release a still-live runtime; dead writer can be reclaimed without TTL", async () => {
  const f = await stores();
  try {
    const old = await f.a.acquire({
      workspaceKey: "workspace",
      sessionId: "crew-old",
      runtimePid: 910001,
    });
    f.live.delete(900001);
    await assert.rejects(
      f.b.acquire({ workspaceKey: "workspace", sessionId: "crew-new" }),
      /workspaceBusy/,
    );
    f.live.delete(910001);
    const next = await f.b.acquire({
      workspaceKey: "workspace",
      sessionId: "crew-new",
      runtimePid: 910002,
    });
    assert.notEqual(next.token, old.token);
    assert.equal(await f.a.release(old), false);
  } finally {
    await f.close();
  }
});
test("unknown process ownership remains quarantined, including after reconnect", async () => {
  const f = await stores();
  try {
    await f.a.acquire({ workspaceKey: "unknown", sessionId: "crew-old" });
    f.a.close();
    f.live.delete(900001);
    await assert.rejects(
      f.b.acquire({ workspaceKey: "unknown", sessionId: "ordinary" }),
      /workspaceBusy/,
    );
    assert.equal((await f.b.get("unknown"))?.sessionId, "crew-old");
  } finally {
    await f.close();
  }
});
test("concurrent acquisition admits exactly one writer; stale token cannot rebind", async () => {
  const f = await stores();
  try {
    const results = await Promise.allSettled([
      f.a.acquire({ workspaceKey: "race", sessionId: "a" }),
      f.b.acquire({ workspaceKey: "race", sessionId: "b" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const winner = results.find((result) => result.status === "fulfilled");
    assert(winner?.status === "fulfilled");
    await f.a.bindSession(winner.value, "actual-created-session");
    assert.equal((await f.b.get("race"))?.sessionId, "actual-created-session");
    await assert.rejects(
      f.b.bindSession({ ...winner.value, token: "stale" }, "hijack"),
      /recoveryRequired/,
    );
  } finally {
    await f.close();
  }
});
