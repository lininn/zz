import assert from "node:assert/strict";
import test from "node:test";
import { externalCrewFixture, waitForTask } from "./crewExternalRuntimeFixture.js";

for (const runtime of ["claude-cli", "codex-cli", "opencode-cli"] as const) {
  test(`crew routes ${runtime} via facade without ZCode session, resumes only matching member/epoch`, async () => {
    const f = await externalCrewFixture();
    try {
      await f.catalog.update({ agentId: f.roleAgent.agentId, runtime });
      await f.send("one");
      await f.service.whenIdle();
      await f.send("two");
      await f.service.whenIdle();
      const starts = f.calls.filter((call) => call.action === "start");
      assert.equal(starts.length, 2);
      assert.equal(starts[0]?.runtimeId, runtime);
      assert.equal(starts[1]?.resumeTaskId, starts[0]?.taskId);
      assert.equal(f.f.sendCount, 0);
      assert.equal(await f.leases.get(f.dir), null);
      const detail = await f.service.get({ groupId: f.group.groupId });
      assert(detail.executions.every((e) => e.status === "succeeded"));
      assert.equal(detail.messages.at(-1)?.text, "External result");
      await f.service.bind({ groupId: f.group.groupId, binding: { workspacePath: f.dir } });
      await f.send("new-epoch");
      await f.service.whenIdle();
      assert.equal(
        f.calls.filter((call) => call.action === "start").at(-1)?.resumeTaskId,
        undefined,
      );
      await f.catalog.update({ agentId: f.roleAgent.agentId, runtime });
      await f.send("new-config");
      await f.service.whenIdle();
      assert.equal(
        f.calls.filter((call) => call.action === "start").at(-1)?.resumeTaskId,
        undefined,
      );
    } finally {
      await f.close();
    }
  });
}
test("provider preflight fails before crew admission and exposes member reason, no fallback", async () => {
  const f = await externalCrewFixture();
  try {
    f.available(false);
    await assert.rejects(f.send("blocked"), /crew.runtimeUnavailable/);
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.runtimeAvailability?.[0]?.available, false);
    assert.equal(detail.runtimeAvailability?.[0]?.reason, "binary_not_found");
    assert.equal(detail.messages.length, 0);
    assert.equal(detail.executions.length, 0);
    assert.equal(f.calls.filter((call) => call.action === "start").length, 0);
    assert.equal(await f.leases.get(f.dir), null);
  } finally {
    await f.close();
  }
});
test("accepted duplicate does not re-probe into rejection or re-dispatch when provider disappears", async () => {
  const f = await externalCrewFixture();
  try {
    const first = await f.send("duplicate");
    await f.service.whenIdle();
    f.available(false);
    const duplicate = await f.send("duplicate");
    await f.service.whenIdle();
    assert.equal(duplicate.execution?.executionId, first.execution?.executionId);
    assert.equal(f.calls.filter((call) => call.action === "start").length, 1);
  } finally {
    await f.close();
  }
});
test("external execution shares P0 lease and cancellation releases only after settled proof", async () => {
  const f = await externalCrewFixture();
  try {
    f.running(true);
    const sent = await f.send("long");
    await waitForTask(f);
    assert.equal((await f.leases.get(f.dir))?.sessionId, [...f.tasks.keys()][0]);
    await assert.rejects(
      f.gate.run({ workspacePath: f.dir, sessionId: "ordinary" }, async () => 1),
      /crew.workspaceBusy/,
    );
    const cancelled = await f.service.cancel({
      groupId: f.group.groupId,
      executionId: sent.execution!.executionId,
    });
    assert.equal(cancelled.status, "cancelled");
    await f.service.whenIdle();
    assert.equal(await f.leases.get(f.dir), null);
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.messages.length, 2);
  } finally {
    await f.close();
  }
});
for (const approved of [true, false]) {
  test(`permission ${approved ? "approve" : "deny"} is correlated and uses crew interaction path`, async () => {
    const f = await externalCrewFixture();
    try {
      f.permission(true);
      const sent = await f.send("permission");
      await waitForTask(f);
      const detail = await f.service.get({ groupId: f.group.groupId });
      assert.equal(detail.executions[0]?.permission?.requestId, "p1");
      const params = {
        groupId: f.group.groupId,
        executionId: sent.execution!.executionId,
        requestId: "p1",
        approved,
      };
      await assert.rejects(
        f.service.respondPermission({ ...params, requestId: "stale" }),
        /permissionNotFound/,
      );
      await f.service.respondPermission(params);
      await f.service.whenIdle();
      assert.equal(
        (await f.service.get({ groupId: f.group.groupId })).executions[0]?.status,
        approved ? "succeeded" : "cancelled",
      );
      assert.equal(await f.leases.get(f.dir), null);
    } finally {
      await f.close();
    }
  });
}
test("unknown external start ACK fences recovery and retains lease rather than replaying", async () => {
  const f = await externalCrewFixture();
  try {
    f.unknown(true);
    await f.send("unknown");
    await f.service.whenIdle();
    const detail = await f.service.recover({ groupId: f.group.groupId });
    assert.equal(detail.executions[0]?.status, "recovery_required");
    assert(await f.leases.get(f.dir));
    assert.equal(f.calls.filter((call) => call.action === "start").length, 1);
  } finally {
    await f.close();
  }
});
test("unsupported approval is explicit and deny still safely cancels", async () => {
  const f = await externalCrewFixture();
  try {
    f.permission(true);
    const sent = await f.send("unsupported");
    const task = await waitForTask(f);
    task.permission!.canRespond = false;
    const params = {
      groupId: f.group.groupId,
      executionId: sent.execution!.executionId,
      requestId: "p1",
      approved: true,
    };
    await assert.rejects(f.service.respondPermission(params), /crew.permissionUnsupported/);
    assert(await f.leases.get(f.dir));
    await f.service.respondPermission({ ...params, approved: false });
    await f.service.whenIdle();
    assert.equal(await f.leases.get(f.dir), null);
  } finally {
    await f.close();
  }
});
test("direct facade start cannot bypass workspace lease via public AgentService", async () => {
  const f = await externalCrewFixture();
  try {
    await assert.rejects(
      f.gate.wrap(f.f.agent).crewRuntime({
        workspacePath: f.dir,
        command: {
          action: "start",
          taskId: "unowned",
          runtimeId: "claude-cli",
          sessionId: "unowned",
          traceId: "unowned",
          objective: "write",
          accessMode: "write",
        },
      }),
      /crew.workspaceBusy/,
    );
    assert.equal(f.calls.filter((call) => call.action === "start").length, 0);
  } finally {
    await f.close();
  }
});
test("cancel during uncertain start waits for start result and never releases on mere abort", async () => {
  const f = await externalCrewFixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    f.running(true);
    f.beforeStart(async () => {
      entered();
      await barrier;
    });
    const sent = await f.send("race");
    await started;
    let done = false;
    const cancel = f.service
      .cancel({ groupId: f.group.groupId, executionId: sent.execution!.executionId })
      .then(() => {
        done = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(done, false);
    assert(await f.leases.get(f.dir));
    release();
    await cancel;
    await f.service.whenIdle();
    assert.equal(await f.leases.get(f.dir), null);
    assert.equal([...f.tasks.values()][0]?.runtimeState, "cancelled");
  } finally {
    release?.();
    await f.close();
  }
});
test("provider becoming unavailable after enqueue is an explicit failure, not recovery or internal fallback", async () => {
  const f = await externalCrewFixture();
  try {
    const original = f.runtime.probeMember!;
    let probes = 0;
    f.runtime.probeMember = async (binding, member) => {
      probes++;
      if (probes > 1)
        return { runtimeId: "claude-cli", available: false, reason: "authentication_failed" };
      const reply = await original(binding, member);
      // Execute's direct external probe must also see the new state.
      f.available(false);
      return reply;
    };
    await f.send("expired");
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0]?.status, "failed");
    assert.equal(detail.messages.at(-1)?.text, "crew.runtimeUnavailable");
    assert.equal(f.calls.filter((call) => call.action === "start").length, 0);
  } finally {
    await f.close();
  }
});
test("completed external history survives service restart and still resumes only same context", async () => {
  const f = await externalCrewFixture();
  const { CrewService } = await import("../src/crew/crewService.js");
  let reopened: InstanceType<typeof CrewService> | undefined;
  try {
    await f.send("before-restart");
    await f.service.whenIdle();
    const prior = f.calls.find((call) => call.action === "start");
    await f.service.dispose();
    reopened = new CrewService({
      databasePath: f.path,
      ownerId: "900001:new-owner",
      isOwnerAlive: () => false,
      runtime: f.runtime,
    });
    await reopened.recover({ groupId: f.group.groupId });
    await reopened.send({
      groupId: f.group.groupId,
      messageId: "after-restart",
      text: "next",
      mentions: [f.group.members[0]!.memberId],
    });
    await reopened.whenIdle();
    assert.equal(
      f.calls.filter((call) => call.action === "start").at(-1)?.resumeTaskId,
      prior?.taskId,
    );
    assert.equal((await reopened.get({ groupId: f.group.groupId })).executions.length, 2);
  } finally {
    await reopened?.dispose();
    await f.close();
  }
});
test("permission remains visible even when unsupported vendor already exited; deny clears it", async () => {
  const f = await externalCrewFixture();
  try {
    f.permission(true);
    const sent = await f.send("exited-permission");
    const task = await waitForTask(f);
    task.settled = true;
    task.runtimeState = "awaiting_permission";
    task.permission!.canRespond = false;
    await new Promise((resolve) => setTimeout(resolve, 140));
    const detail = await f.service.get({ groupId: f.group.groupId });
    assert.equal(detail.executions[0]?.status, "running");
    assert.equal(detail.executions[0]?.permission?.requestId, "p1");
    assert(await f.leases.get(f.dir));
    await f.service.respondPermission({
      groupId: f.group.groupId,
      executionId: sent.execution!.executionId,
      requestId: "p1",
      approved: false,
    });
    await f.service.whenIdle();
    assert.equal(await f.leases.get(f.dir), null);
  } finally {
    await f.close();
  }
});
test("public external start cannot borrow an ordinary session's existing lease", async () => {
  const f = await externalCrewFixture();
  try {
    const lease = await f.leases.acquire({
      workspaceKey: f.dir,
      sessionId: "ordinary",
      runtimePid: 910001,
    });
    await assert.rejects(
      f.gate.wrap(f.f.agent).crewRuntime({
        workspacePath: f.dir,
        command: {
          action: "start",
          taskId: "ordinary",
          runtimeId: "claude-cli",
          sessionId: "context",
          traceId: "trace",
          objective: "write",
          accessMode: "write",
        },
      }),
      /crew.workspaceBusy/,
    );
    assert.equal(f.calls.filter((call) => call.action === "start").length, 0);
    await f.leases.release(lease);
  } finally {
    await f.close();
  }
});
test("successful history without native session starts a fresh vendor run, not invalid resume", async () => {
  const f = await externalCrewFixture();
  try {
    await f.send("no-native");
    await f.service.whenIdle();
    delete [...f.tasks.values()][0]!.nativeSessionId;
    await f.send("next");
    await f.service.whenIdle();
    assert.equal(f.calls.filter((call) => call.action === "start").at(-1)?.resumeTaskId, undefined);
    assert.equal(
      (await f.service.get({ groupId: f.group.groupId })).executions.at(-1)?.status,
      "succeeded",
    );
  } finally {
    await f.close();
  }
});
test("ordinary requests cannot adopt or release the active external task's lease", async () => {
  const f = await externalCrewFixture();
  try {
    f.running(true);
    const sent = await f.send("ordinary-spoof");
    const task = await waitForTask(f);
    const before = await f.leases.get(f.dir);
    f.f.agent.subscribeConversationV4 = async () => {
      throw new Error("ordinary session does not exist");
    };
    await assert.rejects(
      f.gate.run({ workspacePath: f.dir, sessionId: task.taskId }, async () => 1),
      /crew.workspaceBusy/,
    );
    assert.equal((await f.leases.get(f.dir))?.token, before?.token);
    assert.equal(task.settled, false);
    await f.service.cancel({ groupId: f.group.groupId, executionId: sent.execution!.executionId });
    await f.service.whenIdle();
  } finally {
    await f.close();
  }
});
