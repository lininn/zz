import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CrewAgentInput, ZCodeSessionStateSnapshot } from "@zcode/shared";
import type { IZCodeSessionService } from "../src/zcode-session/zcodeSession.js";
import { CrewService } from "../src/crew/crewService.js";
import { CrewWriteAdmission } from "../src/crew/crewAdmission.js";
import { CrewLeaseStore } from "../src/crew/crewLease.js";
import { createCrewRuntime } from "../src/crew/crewRuntime.js";
import { fakeAgent } from "./crewAdmissionFixture.js";

const role: CrewAgentInput = {
  name: "Review",
  systemPrompt: "You review the requested changes.",
  runtime: "zcode",
  accessMode: "read",
};
async function fixture(
  assistantReplies = ["Reviewed. @other is only text."],
  runtimeOptions: {
    resolveProjectId?: (binding: { workspacePath: string }) => string | null;
  } = {},
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "crew-vertical-")));
  const f = fakeAgent();
  const path = join(dir, "tasks.sqlite");
  const leases = new CrewLeaseStore(path, "900001:owner", () => true);
  const gate = new CrewWriteAdmission(f.agent, leases, () => true);
  const rawSend = f.agent.sendConversationCommandV4;
  const sent: Parameters<typeof rawSend>[0][] = [];
  f.agent.sendConversationCommandV4 = async (input) => {
    sent.push(input);
    const result = await rawSend(input);
    f.emit({
      ...f.current,
      seq: f.current.seq + 1,
      control: { ...f.current.control, phase: "completedSuccess", activeWorks: [] },
    });
    return result;
  };
  f.agent.readSession = async (input) =>
    ({
      session: { sessionId: input.sessionId, status: "idle" },
      runtime: {},
      projection: {},
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: (sent[0]?.envelope.payload as { text: string })?.text }],
        },
        ...assistantReplies.map((text) => ({
          info: { role: "assistant" },
          parts: [{ type: "text", text }],
        })),
      ],
    }) as ZCodeSessionStateSnapshot;
  const calls: Parameters<IZCodeSessionService["createSession"]>[0][] = [];
  let beforeCreate: (() => Promise<void>) | undefined;
  const sessions = {
    createSession: async (params) => {
      calls.push(params);
      await beforeCreate?.();
      return { session: { sessionId: params.sessionId } } as ZCodeSessionStateSnapshot;
    },
  } as Pick<IZCodeSessionService, "createSession"> as IZCodeSessionService;
  const runtime = createCrewRuntime({
    agent: gate.wrap(f.agent),
    sessions,
    admission: gate,
    ...runtimeOptions,
  });
  const service = new CrewService({
    databasePath: path,
    ownerId: "900001:owner",
    isOwnerAlive: () => true,
    runtime,
  });
  const catalog = new CrewAgentCatalogService(path);
  const roleAgent = await catalog.create(role);
  return {
    catalog,
    roleAgent,
    dir,
    f,
    runtime,
    service,
    sent,
    calls,
    leases,
    beforeCreate(fn: () => Promise<void>) {
      beforeCreate = fn;
    },
    async close() {
      gate.dispose();
      await service.dispose();
      await catalog.dispose();
      leases.close();
      f.frames.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("real CrewService -> runtime -> existing session/V4 -> board, with immutable role and read tool surface", async () => {
  const f = await fixture();
  try {
    const group = await f.service.create({
      name: "crew",
      members: [{ agentId: f.roleAgent.agentId }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.dir } });
    await f.service.send({
      groupId: group.groupId,
      messageId: "context",
      text: "Prior context",
      mentions: [],
    });
    f.beforeCreate(async () => {
      const saved = await f.service.get({ groupId: group.groupId });
      assert.equal(saved.executions[0]?.taskId, f.calls[0]?.sessionId);
    });
    const params = {
      groupId: group.groupId,
      messageId: "request",
      text: "Review this change",
      mentions: [group.members[0]!.memberId],
    };
    await f.service.send(params);
    await f.service.whenIdle();
    const detail = await f.service.get({ groupId: group.groupId });
    assert.equal(detail.executions[0]?.status, "succeeded");
    assert.deepEqual(f.calls[0]?.toolAllowlist, ["Read", "Glob", "Grep"]);
    const payload = f.sent[0]?.envelope.payload as { text: string };
    assert(payload.text.includes(role.systemPrompt));
    assert(payload.text.includes("Prior context"));
    assert(payload.text.includes(params.text));
    assert.equal(f.sent[0]?.envelope.commandId, detail.executions[0]?.executionId);
    assert.equal(detail.messages.at(-1)?.text, "Reviewed. @other is only text.");
    assert.equal(detail.executions.length, 1);
    await f.service.send(params);
    await f.service.whenIdle();
    assert.equal(f.sent.length, 1);
    assert.equal(await f.leases.get(f.dir), null);
  } finally {
    await f.close();
  }
});
test("bound workspace project is passed into session creation for remote-host ownership", async () => {
  const f = await fixture(["Done."], { resolveProjectId: () => "project-1" });
  try {
    const group = await f.service.create({
      name: "crew",
      members: [{ agentId: f.roleAgent.agentId }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.dir } });
    await f.service.send({
      groupId: group.groupId,
      messageId: "project",
      text: "Review",
      mentions: [group.members[0]!.memberId],
    });
    await f.service.whenIdle();
    assert.equal(f.calls[0]?.projectId, "project-1");
    assert.equal(
      (await f.service.get({ groupId: group.groupId })).executions[0]?.status,
      "succeeded",
    );
  } finally {
    await f.close();
  }
});
test("unresolved project is omitted so local hosts keep the existing behavior", async () => {
  const f = await fixture(["Done."], { resolveProjectId: () => null });
  try {
    const group = await f.service.create({
      name: "crew",
      members: [{ agentId: f.roleAgent.agentId }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.dir } });
    await f.service.send({
      groupId: group.groupId,
      messageId: "no-project",
      text: "Review",
      mentions: [group.members[0]!.memberId],
    });
    await f.service.whenIdle();
    assert.equal(f.calls[0] && "projectId" in f.calls[0], false);
  } finally {
    await f.close();
  }
});
test("cancellation during session creation cannot submit an input after the execution is cancelled", async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    f.beforeCreate(async () => {
      entered();
      await barrier;
    });
    const group = await f.service.create({
      name: "crew",
      members: [{ agentId: f.roleAgent.agentId }],
    });
    await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.dir } });
    const send = await f.service.send({
      groupId: group.groupId,
      messageId: "cancel",
      text: "review",
      mentions: [group.members[0]!.memberId],
    });
    await started;
    await f.service.cancel({ groupId: group.groupId, executionId: send.execution!.executionId });
    release();
    await f.service.whenIdle();
    assert.equal(f.sent.length, 0);
    assert.equal(
      (await f.service.get({ groupId: group.groupId })).executions[0]?.status,
      "cancelled",
    );
  } finally {
    release?.();
    await f.close();
  }
});
test("workspace preflight refuses remote/local identity confusion and missing directories", async () => {
  const f = await fixture();
  try {
    await f.runtime.preflight({ workspacePath: f.dir });
    await assert.rejects(
      f.runtime.preflight({ workspacePath: "relative" }),
      /absolutePathRequired/,
    );
    await assert.rejects(
      f.runtime.preflight({ workspacePath: f.dir, workspaceIdentity: "another" }),
      /identityMismatch/,
    );
    await assert.rejects(
      f.runtime.preflight({
        workspacePath: f.dir,
        remoteSessionId: "remote",
        workspaceIdentity: "remote-id",
      }),
      /remoteUnavailable/,
    );
    await assert.rejects(f.runtime.preflight({ workspacePath: join(f.dir, "missing") }));
  } finally {
    await f.close();
  }
});

for (const [accessMode, toolAllowlist, expected] of [
  ["read", ["Read", "Edit"], ["Read"]],
  ["read", [], []],
  ["write", ["Read", "Edit"], ["Read", "Edit"]],
  ["write", [], []],
] as const) {
  test(`ZCode ${accessMode} applies catalog tool ceiling ${JSON.stringify(toolAllowlist)}`, async () => {
    const f = await fixture();
    try {
      await f.catalog.update({
        agentId: f.roleAgent.agentId,
        accessMode,
        toolAllowlist: [...toolAllowlist],
      });
      const group = await f.service.create({
        name: "tools",
        members: [{ agentId: f.roleAgent.agentId }],
      });
      await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.dir } });
      await f.service.send({
        groupId: group.groupId,
        messageId: "tools",
        text: "inspect",
        mentions: [group.members[0]!.memberId],
      });
      await f.service.whenIdle();
      assert.deepEqual(f.calls[0]?.toolAllowlist, [...expected]);
      assert.equal(
        (await f.service.get({ groupId: group.groupId })).executions[0]?.status,
        "succeeded",
      );
    } finally {
      await f.close();
    }
  });
}

for (const final of ["Final answer without delegation", ""]) {
  test(`native runtime only returns final reply, ignoring an earlier valid handoff (${final || "empty"})`, async () => {
    const f = await fixture([
      '<crew-handoff>{"to":"Review","objective":"should not run","context":""}</crew-handoff>',
      final,
    ]);
    try {
      const group = await f.service.create({
        name: "Final-only",
        members: [{ agentId: f.roleAgent.agentId }],
        relayMode: "auto",
      });
      await f.service.bind({ groupId: group.groupId, binding: { workspacePath: f.dir } });
      await f.service.send({
        groupId: group.groupId,
        messageId: "final-only",
        mentions: [group.members[0]!.memberId],
        text: "Review",
      });
      await f.service.whenIdle();
      const detail = await f.service.get({ groupId: group.groupId });
      assert.equal(detail.executions.length, 1);
      assert.equal(detail.executions[0]!.relay, undefined);
      // 空最终回复按 PASS 处理：不写成员消息，只保留用户任务。
      if (final === "") assert.equal(detail.messages.length, 1);
      else assert.equal(detail.messages.at(-1)?.text, final);
      const prompt = (f.sent[0]?.envelope.payload as { text: string }).text;
      assert(prompt.includes("# Controlled crew handoff"));
      assert(prompt.includes('Allowed next members (exact names): ["Review"]'));
      // 协议层必须显式覆盖角色/任务正文里的“等用户确认”类措辞，否则下游成员会把
      // 规划叙述当成停止信号，链在 hop=1 断掉。
      assert(prompt.includes("OVERRIDES the role description and the task text"));
    } finally {
      await f.close();
    }
  });
}
