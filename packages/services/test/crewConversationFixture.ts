import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CrewExecution } from "@zcode/shared";
import { CrewAgentCatalogService } from "../src/crew/agentCatalogService.js";
import type { CrewRuntimePort, CrewServiceOptions } from "../src/crew/contract.js";
import { CrewService } from "../src/crew/crewService.js";
import { CrewStore } from "../src/crew/crewStore.js";

export type ConversationExecuteInput = Parameters<CrewRuntimePort["execute"]>[0];
export async function conversationFixture(overrides: Partial<CrewRuntimePort> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "crew-conversations-"));
  const calls: ConversationExecuteInput[] = [];
  const owners: string[] = [];
  const cancellations: string[] = [];
  const runtime: CrewRuntimePort = {
    preflight: async () => {},
    cancel: async (_binding, taskId) => {
      cancellations.push(taskId);
    },
    execute: async (input) => {
      const taskId = `task-${input.execution.executionId}`;
      await input.onTaskCreated(taskId);
      return { taskId, text: `reply:${input.execution.messageId}`, status: "succeeded" };
    },
    ...overrides,
  };
  const options: CrewServiceOptions = {
    databasePath: join(directory, "tasks.sqlite"),
    ownerId: "conversation-owner",
    isOwnerAlive: (owner) => {
      owners.push(owner);
      return owner !== "dead-owner";
    },
    runtime: {
      ...runtime,
      execute: async (input) => {
        calls.push(input);
        return runtime.execute(input);
      },
    },
  };
  let service = new CrewService(options);
  const store = new CrewStore(options.databasePath);
  const catalog = new CrewAgentCatalogService(options.databasePath);
  const agent = await catalog.create({
    name: "Developer",
    systemPrompt: "Implement the requested task only",
    runtime: "zcode",
    accessMode: "write",
  });
  const group = await service.create({ name: "Team", members: [{ agentId: agent.agentId }] });
  const binding = { workspacePath: directory, workspaceIdentity: "conversation-workspace" };
  await service.bind({ groupId: group.groupId, binding });
  await store.initialize();
  const a = store.conversation(group.groupId);
  const b = await service.createConversation({ groupId: group.groupId, name: "Second task" });
  const params = (conversationId: string | undefined, messageId: string, text = messageId) => ({
    groupId: group.groupId,
    conversationId,
    messageId,
    text,
    mentions: [group.members[0]!.memberId],
  });
  return {
    get service() {
      return service;
    },
    store,
    catalog,
    agent,
    group,
    binding,
    a,
    b,
    calls,
    owners,
    cancellations,
    params,
    send: (conversationId: string | undefined, messageId: string, text?: string) =>
      service.send(params(conversationId, messageId, text)),
    seed(conversationId: string, messageId: string, status: CrewExecution["status"] = "queued") {
      return store.transaction(() => {
        const execution = store.enqueue(params(conversationId, messageId)).execution!;
        if (status !== "queued")
          store.db
            .prepare(
              "UPDATE agent_crew_executions SET status=?,owner_id='dead-owner',task_id=? WHERE execution_id=?",
            )
            .run(status, `original-${execution.executionId}`, execution.executionId);
        return store.execution(execution.executionId);
      });
    },
    async restart() {
      await service.dispose();
      service = new CrewService({ ...options, ownerId: "restarted-owner" });
    },
    async close() {
      await service.dispose();
      await catalog.dispose();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
