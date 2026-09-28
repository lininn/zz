import assert from "node:assert/strict";
import type { CrewExecution, CrewRelayMode } from "@zcode/shared";
import type { CrewRuntimePort } from "../src/crew/contract.js";
import { conversationFixture, type ConversationExecuteInput } from "./crewConversationFixture.js";

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function handoff(to: string, objective = "Implement feature", context = "Approved scope") {
  return `<crew-handoff>${JSON.stringify({ to, objective, context })}</crew-handoff>`;
}

type Reply = (input: ConversationExecuteInput) => string | Promise<string>;
export async function relayFixture(
  options: {
    mode?: CrewRelayMode;
    autoHops?: number;
    budgetMinutes?: number;
    reply?: Reply;
    status?: "succeeded" | "failed" | "cancelled";
  } = {},
) {
  let reply: Reply = options.reply ?? (() => "Finished without a handoff");
  let probe: NonNullable<CrewRuntimePort["probeMember"]> = async () => null;
  let preflight: CrewRuntimePort["preflight"] = async () => {};
  let cancel: CrewRuntimePort["cancel"] = async () => {};
  const cancellations: string[] = [];
  const base = await conversationFixture({
    preflight: (binding) => preflight(binding),
    probeMember: (binding, member) => probe(binding, member),
    cancel: (binding, taskId) => {
      cancellations.push(taskId);
      return cancel(binding, taskId);
    },
    execute: async (input) => {
      const taskId = `task-${input.execution.executionId}`;
      await input.onTaskCreated(taskId);
      return { taskId, text: await reply(input), status: options.status ?? "succeeded" };
    },
  });
  try {
    // 根规划者由用户选中，而不是通过 PM 名字或角色提示词猜测。
    const planner = await base.catalog.create({
      name: "Coordinator",
      systemPrompt: "Handle the requested task",
      runtime: "zcode",
      accessMode: "write",
    });
    const group = await base.service.update({
      groupId: base.group.groupId,
      members: [{ agentId: planner.agentId }, ...base.group.members],
      ...(options.mode === undefined ? {} : { relayMode: options.mode }),
      ...(options.autoHops === undefined ? {} : { relayAutoHops: options.autoHops }),
      ...(options.budgetMinutes === undefined ? {} : { relayBudgetMinutes: options.budgetMinutes }),
    });
    const scope = { groupId: group.groupId, conversationId: base.a.conversationId };
    const executions = (conversationId = scope.conversationId) =>
      base.store.executions(group.groupId, conversationId);
    const send = (
      messageId = "root",
      conversationId = scope.conversationId,
      memberId = group.members[0]!.memberId,
    ) =>
      base.service.send({
        groupId: group.groupId,
        conversationId,
        messageId,
        text: "Plan and deliver feature",
        mentions: [memberId],
      });
    return {
      get service() {
        return base.service;
      },
      store: base.store,
      catalog: base.catalog,
      group,
      scope,
      binding: base.binding,
      planner,
      developer: base.agent,
      calls: base.calls,
      cancellations,
      otherConversation: base.b,
      executions,
      send,
      async start(
        messageId = "root",
        conversationId = scope.conversationId,
        memberId = group.members[0]!.memberId,
      ) {
        const result = await send(messageId, conversationId, memberId);
        assert.ok(result.execution);
        await base.service.whenIdle();
        return base.store.execution(result.execution.executionId);
      },
      respond(execution: CrewExecution, approved = true) {
        return base.service.respondRelay({
          groupId: execution.groupId,
          conversationId: execution.conversationId,
          executionId: execution.executionId,
          approved,
        });
      },
      setReply(next: Reply) {
        reply = next;
      },
      setProbe(next: typeof probe) {
        probe = next;
      },
      setCancel(next: typeof cancel) {
        cancel = next;
      },
      setPreflight(next: typeof preflight) {
        preflight = next;
      },
      expireRoot(root: CrewExecution, minutes = options.budgetMinutes ?? 30) {
        // 直接老化持久化根时间，验证墙钟预算来自 SQLite 而不是测试等待或当前跳时间。
        base.store.db
          .prepare("UPDATE agent_crew_executions SET created_at=? WHERE execution_id=?")
          .run(Date.now() - minutes * 60000 - 1000, root.executionId);
      },
      seedRecovery(conversationId = scope.conversationId) {
        return base.seed(conversationId, "unresolved-task", "recovery_required");
      },
      restart: base.restart,
      close: base.close,
    };
  } catch (error) {
    await base.close();
    throw error;
  }
}
