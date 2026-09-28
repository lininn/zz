import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CrewWriteAdmission } from "../src/crew/crewAdmission.js";
import { CrewLeaseStore } from "../src/crew/crewLease.js";
import { fakeAgent } from "./crewAdmissionFixture.js";
const target = { workspacePath: "/workspace", sessionId: "crew-session" };
const send = (sessionId: string, commandId = "A") => ({
  workspacePath: "/workspace",
  envelope: {
    sessionId,
    commandId,
    clientId: "fixture",
    issuedAt: 1,
    type: "sendText" as const,
    payload: { text: "input" },
  },
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "crew-lifecycle-"));
  const f = fakeAgent();
  let alive = true;
  const leases = new CrewLeaseStore(join(dir, "tasks.sqlite"), "900001:owner", () => true);
  const gate = new CrewWriteAdmission(f.agent, leases, () => alive);
  return {
    f,
    leases,
    gate,
    dead() {
      alive = false;
    },
    async close() {
      gate.dispose();
      leases.close();
      f.frames.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("ACK-before-flush requires a new owned snapshot; rejecting B cannot release still-running A", async () => {
  const { f, gate, leases, close } = await fixture();
  try {
    f.agent.sendConversationCommandV4 = async (input) => {
      if (input.envelope.commandId === "A") {
        // 模拟CLI已开始、live flush尚未送达，只有后续read barrier看得到running。
        f.setCurrent({
          ...f.current,
          rows: {
            window: [
              {
                kind: "turnHeader",
                rowId: 1,
                turnId: "turn",
                createdAt: 1,
                createdAtSeq: 1,
                origin: "userInput",
                sourceCommandId: "A",
                state: "running",
                startedAt: 1,
              },
            ],
            totalCount: 1,
            firstRowId: 1,
          },
          seq: 2,
          control: {
            ...f.current.control,
            phase: "running",
            activeWorks: [{ kind: "primaryTurn", startedAt: 1 }],
          },
        });
      }
      return {
        commandId: input.envelope.commandId,
        status: input.envelope.commandId === "A" ? "accepted" : "rejected",
        revisionAtDecision: 1,
      };
    };
    const wrapped = gate.wrap(f.agent);
    await wrapped.sendConversationCommandV4(send(target.sessionId));
    await wrapped.sendConversationCommandV4(send(target.sessionId, "B"));
    assert.equal((await leases.get(target.workspacePath))?.sessionId, target.sessionId);
    await assert.rejects(wrapped.sendConversationCommandV4(send("ordinary")), /workspaceBusy/);
    const done = gate.whenQuiescent(target);
    f.emit({
      ...f.current,
      seq: 3,
      control: { ...f.current.control, phase: "completedSuccess", activeWorks: [] },
    });
    assert.equal(await done, "completedSuccess");
    assert.equal(await leases.get(target.workspacePath), null);
  } finally {
    await close();
  }
});
test("dispose during runtime preparation prevents both queued and in-flight commands from dispatching", async () => {
  const { f, gate, leases, close } = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.agent.initialize = async () => {
    entered();
    await barrier;
    return { available: true, workspaceKey: target.workspacePath };
  };
  try {
    const first = gate.wrap(f.agent).sendConversationCommandV4(send(target.sessionId));
    const queued = gate.wrap(f.agent).sendConversationCommandV4(send(target.sessionId, "B"));
    const checks = Promise.all([
      assert.rejects(first, /serviceClosed/),
      assert.rejects(queued, /serviceClosed/),
    ]);
    await started;
    gate.dispose();
    release();
    await checks;
    assert.equal(f.sendCount, 0);
    assert.equal(await leases.get(target.workspacePath), null);
    await assert.rejects(gate.whenQuiescent(target), /recoveryRequired/);
  } finally {
    release?.();
    await close();
  }
});
test("runtime death interrupts awaiters without replay and reclaims only after its process tree exits", async () => {
  const fixtureState = await fixture();
  const { f, gate, leases, close } = fixtureState;
  try {
    await gate.wrap(f.agent).sendConversationCommandV4(send(target.sessionId));
    const interrupted = assert.rejects(gate.whenQuiescent(target), /recoveryRequired/);
    gate.onRuntimeExit(910001);
    await interrupted;
    assert.equal((await leases.get(target.workspacePath))?.sessionId, target.sessionId);
    fixtureState.dead();
    await gate.wrap(f.agent).sendConversationCommandV4(send("ordinary"));
    assert.equal((await leases.get(target.workspacePath))?.sessionId, "ordinary");
    assert.equal(f.sendCount, 2);
  } finally {
    await close();
  }
});

test("ACK and a newer idle snapshot do not release before the accepted inputId appears", async () => {
  const { f, gate, leases, close } = await fixture();
  try {
    f.agent.sendConversationCommandV4 = async (input) => ({
      commandId: input.envelope.commandId,
      status: input.envelope.commandId === "A" ? "accepted" : "rejected",
      revisionAtDecision: 1,
    });
    const wrapped = gate.wrap(f.agent);
    await wrapped.sendConversationCommandV4(send(target.sessionId, "A"));
    // Core 已接收、尚未形成 TurnStarted；甚至 unrelated state 更新推高 seq，也不是本次执行证据。
    f.emit({ ...f.current, seq: 2, revision: 2 });
    await wrapped.sendConversationCommandV4(send(target.sessionId, "B"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal((await leases.get(target.workspacePath))?.sessionId, target.sessionId);
    await assert.rejects(wrapped.sendConversationCommandV4(send("ordinary")), /workspaceBusy/);
    const finished = gate.whenQuiescent(target);
    f.emit({
      ...f.current,
      seq: 3,
      control: { ...f.current.control, phase: "completedSuccess", activeWorks: [] },
      rows: {
        window: [
          {
            kind: "turnHeader",
            rowId: 1,
            turnId: "A-turn",
            createdAt: 1,
            createdAtSeq: 3,
            origin: "userInput",
            sourceCommandId: "A",
            state: "completedSuccess",
            startedAt: 1,
            endedAt: 2,
          },
        ],
        totalCount: 1,
        firstRowId: 1,
      },
    });
    assert.equal(await finished, "completedSuccess");
    assert.equal(await leases.get(target.workspacePath), null);
  } finally {
    await close();
  }
});
