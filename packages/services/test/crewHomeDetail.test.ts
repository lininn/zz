import assert from "node:assert/strict";
import test from "node:test";
import { conversationFixture } from "./crewConversationFixture.js";

test("execution detail rejects foreign conversation before runtime access", async () => {
  let reads = 0;
  const fixture = await conversationFixture({
    inspect: async () => {
      reads++;
      throw new Error();
    },
  });
  try {
    const execution = fixture.seed(fixture.a.conversationId, "first", "succeeded");
    await assert.rejects(
      fixture.service.readExecution({
        groupId: fixture.group.groupId,
        conversationId: fixture.b.conversationId,
        executionId: execution.executionId,
      }),
      /crew.executionNotFound/,
    );
    assert.equal(reads, 0);
    const detail = await fixture.service.readExecution({
      groupId: fixture.group.groupId,
      conversationId: fixture.a.conversationId,
      executionId: execution.executionId,
    });
    assert.equal(detail.execution.taskId, execution.taskId);
    assert.equal(detail.runtimeTask, null);
    assert.equal(detail.unavailableReason, null);
  } finally {
    await fixture.close();
  }
});

test("unstarted execution explains absent task rather than inventing a timeline", async () => {
  const fixture = await conversationFixture();
  try {
    const execution = fixture.seed(fixture.a.conversationId, "pending");
    const detail = await fixture.service.readExecution({
      groupId: fixture.group.groupId,
      conversationId: fixture.a.conversationId,
      executionId: execution.executionId,
    });
    assert.equal(detail.unavailableReason, "taskNotCreated");
  } finally {
    await fixture.close();
  }
});

test("conversation failure badge is derived and superseded by active/recovery/latest success", async () => {
  const fixture = await conversationFixture();
  try {
    fixture.seed(fixture.a.conversationId, "failed", "failed");
    assert.equal(
      fixture.store.conversation(fixture.group.groupId, fixture.a.conversationId).status,
      "failed",
    );
    assert.equal(
      fixture.store.conversation(fixture.group.groupId, fixture.b.conversationId).status,
      "idle",
    );
    fixture.seed(fixture.a.conversationId, "success", "succeeded");
    assert.equal(
      fixture.store.conversation(fixture.group.groupId, fixture.a.conversationId).status,
      "idle",
    );
    fixture.seed(fixture.a.conversationId, "active", "running");
    fixture.seed(fixture.a.conversationId, "later-failure", "failed");
    assert.equal(
      fixture.store.conversation(fixture.group.groupId, fixture.a.conversationId).status,
      "active",
    );
    fixture.seed(fixture.a.conversationId, "unknown", "recovery_required");
    assert.equal(
      fixture.store.conversation(fixture.group.groupId, fixture.a.conversationId).status,
      "recovery_required",
    );
  } finally {
    await fixture.close();
  }
});

test("external detail reads original binding, exposes real summary and an honest event gap", async () => {
  const reads: { path: string; task: string }[] = [];
  const fixture = await conversationFixture({
    inspect: async (binding, taskId) => {
      reads.push({ path: binding.workspacePath, task: taskId });
      return {
        taskId,
        runtimeId: "codex-cli",
        runtimeState: "succeeded",
        summary: "actual output",
        settled: true,
      };
    },
  });
  try {
    await fixture.catalog.update({ agentId: fixture.agent.agentId, runtime: "codex-cli" });
    const execution = fixture.seed(fixture.a.conversationId, "external", "succeeded");
    await fixture.service.bind({
      groupId: fixture.group.groupId,
      binding: { workspacePath: "/another-workspace" },
    });
    const detail = await fixture.service.readExecution({
      groupId: fixture.group.groupId,
      conversationId: fixture.a.conversationId,
      executionId: execution.executionId,
    });
    assert.deepEqual(reads, [
      { path: execution.workspaceBinding.workspacePath, task: execution.taskId },
    ]);
    assert.equal(detail.runtimeTask?.summary, "actual output");
    assert.equal(detail.unavailableReason, "externalEventsUnavailable");
  } finally {
    await fixture.close();
  }
});

test("external read errors and mismatched task IDs do not manufacture details", async () => {
  for (const mismatch of [false, true]) {
    const fixture = await conversationFixture({
      inspect: async () => {
        if (!mismatch) throw new Error("offline");
        return {
          taskId: "foreign",
          runtimeId: "codex-cli",
          runtimeState: "running",
          settled: false,
        };
      },
    });
    try {
      await fixture.catalog.update({ agentId: fixture.agent.agentId, runtime: "codex-cli" });
      const execution = fixture.seed(fixture.a.conversationId, "external", "succeeded");
      const detail = await fixture.service.readExecution({
        groupId: fixture.group.groupId,
        conversationId: fixture.a.conversationId,
        executionId: execution.executionId,
      });
      assert.equal(detail.runtimeTask, null);
      assert.equal(detail.unavailableReason, "runtimeReadFailed");
    } finally {
      await fixture.close();
    }
  }
});
