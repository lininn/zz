import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { CrewWriteAdmission, needsCrewWriteAdmission } from "../src/crew/crewAdmission.js";
import { CrewLeaseStore } from "../src/crew/crewLease.js";
import {
  CrewAdmissionMonitor,
  isCrewWorkspaceQuiescent,
} from "../src/crew/crewAdmissionMonitor.js";
import { fakeAgent, snapshot } from "./crewAdmissionFixture.js";
const envelope = (sessionId: string, type = "sendText"): CommandEnvelope => ({
  sessionId,
  type: type as CommandEnvelope["type"],
  payload: { text: "task" },
  clientId: "test",
  commandId: `command-${sessionId}`,
  issuedAt: 1,
});
const target = { workspacePath: "/workspace", sessionId: "crew-session" };

test("all input-capable ordinary entry points share admission; stop and reads stay available", () => {
  for (const name of [
    "sendText",
    "retryTurn",
    "sendGoalCommand",
    "resumeGoal",
    "sendQueuedNow",
    "editUserQuery",
    "applyFileRewind",
    "resumeWorkflowRun",
  ])
    assert(needsCrewWriteAdmission(envelope("session", name)), name);
  assert(!needsCrewWriteAdmission(envelope("session", "stop")));
  assert(!needsCrewWriteAdmission({ ...envelope("session", "createSession"), payload: {} }));
  assert(
    needsCrewWriteAdmission({
      ...envelope("session", "createSession"),
      payload: { firstInput: { text: "start" } },
    }),
  );
});
test("desktop and replayable input cannot overtake a crew writer; real quiescence releases it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crew-admission-"));
  const f = fakeAgent();
  const leases = new CrewLeaseStore(join(dir, "tasks.sqlite"), "900001:owner", () => true);
  const gate = new CrewWriteAdmission(f.agent, leases, () => true);
  const wrapped = gate.wrap(f.agent);
  try {
    await wrapped.sendConversationCommandV4({ ...target, envelope: envelope(target.sessionId) });
    assert.equal(f.sendCount, 1);
    for (const clientMode of ["desktop-continuous", "web-remote-replayable"] as const) {
      await assert.rejects(
        wrapped.sendConversationCommandV4({
          ...target,
          clientMode,
          envelope: envelope("ordinary"),
        }),
        /workspaceBusy/,
      );
    }
    let settled = false;
    const idle = gate.whenQuiescent(target).then(() => {
      settled = true;
    });
    const terminal = {
      ...f.current,
      seq: 3,
      control: { ...f.current.control, phase: "completedSuccess" as const, activeWorks: [] },
    };
    f.emit({
      ...terminal,
      backgroundWorks: [
        {
          workId: "background",
          kind: "bash",
          status: "running",
          title: "writing",
          startedAt: 1,
          anchorRowId: null,
        },
      ],
    } as typeof terminal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    f.emit({ ...terminal, seq: 4 });
    await idle;
    assert.equal(await leases.get("/workspace"), null);
    await wrapped.sendConversationCommandV4({ ...target, envelope: envelope("ordinary") });
    assert.equal(f.sendCount, 2);
  } finally {
    gate.dispose();
    leases.close();
    f.frames.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
test("monitor ignores foreign subscriptions and cannot release from old idle projection", async () => {
  const f = fakeAgent();
  const observer = new CrewAdmissionMonitor(f.agent, target, () => {});
  try {
    await observer.start();
    f.emit({
      ...snapshot(target.sessionId, 10),
      control: { ...snapshot().control, phase: "running" },
    });
    assert.equal(observer.snapshot?.seq, 10);
    f.emit(snapshot(target.sessionId, 50), "foreign-subscription");
    assert.equal(observer.snapshot?.seq, 10);
    f.emit(snapshot(target.sessionId, 2));
    assert.equal(observer.snapshot?.seq, 10);
  } finally {
    observer.dispose();
    f.frames.dispose();
  }
});
test("quiescence excludes background tasks, goal continuation, queued work and waiting tools", () => {
  const idle = snapshot();
  assert(isCrewWorkspaceQuiescent(idle));
  assert(!isCrewWorkspaceQuiescent({ ...idle, pendingInteractions: [{}] } as typeof idle));
  assert(
    !isCrewWorkspaceQuiescent({ ...idle, queue: { ...idle.queue, items: [{}] } } as typeof idle),
  );
  assert(!isCrewWorkspaceQuiescent({ ...idle, goal: { status: "active" } } as typeof idle));
  assert(!isCrewWorkspaceQuiescent({ ...idle, subagents: { running: [{}] } } as typeof idle));
});

test("失败收尾释放自己的租约，后续派工不再被挡", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crew-admission-terminal-"));
  const f = fakeAgent();
  const leases = new CrewLeaseStore(join(dir, "tasks.sqlite"), "900001:owner", () => true);
  const gate = new CrewWriteAdmission(f.agent, leases, () => true);
  const wrapped = gate.wrap(f.agent);
  try {
    await wrapped.sendConversationCommandV4({ ...target, envelope: envelope(target.sessionId) });
    assert.notEqual(await leases.get("/workspace"), null);

    // 执行失败时不会走到 quiescent 收口；进程还活着，acquire 的接管分支和
    // reapDeadEntry 也都不动它，以前这里会永久卡住 workspace。
    await gate.releaseAfterTerminal(target);
    assert.equal(await leases.get("/workspace"), null);

    await wrapped.sendConversationCommandV4({ ...target, envelope: envelope("next") });
    assert.equal(f.sendCount, 2);
  } finally {
    gate.dispose();
    leases.close();
    f.frames.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("终态释放只放自己那把锁，不碰别的会话", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crew-admission-foreign-"));
  const f = fakeAgent();
  const leases = new CrewLeaseStore(join(dir, "tasks.sqlite"), "900001:owner", () => true);
  const gate = new CrewWriteAdmission(f.agent, leases, () => true);
  const wrapped = gate.wrap(f.agent);
  try {
    await wrapped.sendConversationCommandV4({ ...target, envelope: envelope(target.sessionId) });

    // sessionId 对不上说明这把锁属于别的派工，抢放会让两个执行同时写同一工作区。
    await gate.releaseAfterTerminal({ ...target, sessionId: "someone-else" });
    assert.notEqual(await leases.get("/workspace"), null);
  } finally {
    gate.dispose();
    leases.close();
    f.frames.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
