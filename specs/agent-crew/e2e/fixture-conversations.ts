import type { ICrewService } from "@zcode/services";
import {
  crewConversationCreateParamsSchema,
  crewSendParamsSchema,
  type CrewConversation,
  type CrewMessage,
  type CrewExecution,
  type CrewRelay,
  type CrewGroup,
  type CrewResolvedMember,
} from "@zcode/shared";
import { fixtureBarrier } from "./fixture-delays.js";

const entries = new Map<
  string,
  { conversation: CrewConversation; messages: CrewMessage[]; executions: CrewExecution[] }
>();
const clone = <T>(value: T): T => structuredClone(value);
const forGroup = (groupId: string) =>
  [...entries.values()].filter((entry) => entry.conversation.groupId === groupId);
const find = ({ groupId, conversationId }: { groupId: string; conversationId?: string }) => {
  // 新 UI 的调用必须显式给 ID；fixture 故意不实现旧客户端省略参数的 fallback。
  const entry = conversationId ? entries.get(conversationId) : undefined;
  if (!entry || entry.conversation.groupId !== groupId)
    throw new Error("crew.conversationNotFound");
  return entry;
};
export function initializeConversations(groupId: string) {
  const now = Date.now();
  entries.set(groupId, {
    conversation: {
      groupId,
      conversationId: groupId,
      name: "",
      isDefault: true,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    },
    messages: [],
    executions: [],
  });
}
export function deleteConversations(groupId: string) {
  for (const entry of forGroup(groupId)) entries.delete(entry.conversation.conversationId);
}
export const conversationState = () => clone([...entries.values()]);

export function conversationFixture(
  getGroup: (id: string) => CrewGroup,
  resolve: (group: CrewGroup) => CrewResolvedMember[],
) {
  const updateStatus = (groupId: string) => {
    const group = getGroup(groupId);
    for (const entry of forGroup(groupId)) {
      entry.conversation.status = entry.executions.some(
        (item) => item.status === "recovery_required",
      )
        ? "recovery_required"
        : entry.executions.some((item) => ["queued", "running"].includes(item.status))
          ? "active"
          : entry.executions.some((item) => item.relay?.status === "awaiting_user_approval")
            ? "awaiting_user_approval"
            : "idle";
    }
    const statuses = forGroup(groupId).map((item) => item.conversation.status);
    group.status = statuses.includes("recovery_required")
      ? "recovery_required"
      : statuses.includes("active")
        ? "active"
        : group.workspaceBinding
          ? "idle"
          : "unbound";
  };
  const methods: Pick<
    ICrewService,
    | "listConversations"
    | "createConversation"
    | "get"
    | "send"
    | "recover"
    | "cancel"
    | "respondPermission"
    | "respondRelay"
  > = {
    async listConversations({ groupId }) {
      getGroup(groupId);
      return clone(forGroup(groupId).map((entry) => entry.conversation));
    },
    async createConversation(input) {
      const { groupId, name } = crewConversationCreateParamsSchema.parse(input);
      getGroup(groupId);
      await fixtureBarrier("createConversation", { groupId });
      const now = Date.now();
      const conversation: CrewConversation = {
        groupId,
        conversationId: crypto.randomUUID(),
        name: name ?? "",
        isDefault: false,
        status: "idle",
        createdAt: now,
        updatedAt: now,
      };
      entries.set(conversation.conversationId, { conversation, messages: [], executions: [] });
      return clone(conversation);
    },
    async get(params) {
      const group = getGroup(params.groupId);
      const entry = find(params);
      // 保存请求发起时快照，故意允许晚到旧读取，检验 UI 只能更新原 cache key。
      const snapshot = clone({
        group,
        ...entry,
        conversations: forGroup(group.groupId).map((item) => item.conversation),
        resolvedMembers: resolve(group),
      });
      await fixtureBarrier("get", params);
      return snapshot;
    },
    async send(input) {
      const params = crewSendParamsSchema.parse(input);
      const entry = find(params);
      const group = getGroup(params.groupId);
      if (!group.workspaceBinding) throw new Error("crew.workspaceUnbound");
      if (entry.conversation.status === "recovery_required")
        throw new Error("crew.recoveryRequired");
      if (params.mentions.length) throw new Error("This offline fixture does not execute agents");
      await fixtureBarrier("send", params);
      const existing = entry.messages.find((item) => item.messageId === params.messageId);
      if (existing) {
        if (existing.text !== params.text) throw new Error("crew.messageConflict");
        return clone({ message: existing, execution: null });
      }
      const message: CrewMessage = {
        groupId: params.groupId,
        conversationId: entry.conversation.conversationId,
        messageId: params.messageId,
        sequence: entry.messages.length + 1,
        text: params.text,
        mentions: [],
        epoch: group.epoch,
        sender: "user",
        memberId: null,
        executionId: null,
        createdAt: Date.now(),
      };
      entry.messages.push(message);
      entry.conversation.updatedAt = message.createdAt;
      return clone({ message, execution: null });
    },
    async recover(params) {
      find(params);
      await fixtureBarrier("recover", params);
      return methods.get(params);
    },
    async cancel(params) {
      const entry = find(params);
      const execution = entry.executions.find((item) => item.executionId === params.executionId);
      if (!execution) throw new Error("crew.executionNotFound");
      await fixtureBarrier("cancel", params);
      execution.status = "cancelled";
      delete execution.permission;
      updateStatus(params.groupId);
      return clone(execution);
    },
    async respondRelay(params) {
      const entry = find(params);
      const group = getGroup(params.groupId);
      const execution = entry.executions.find((item) => item.executionId === params.executionId);
      if (!execution?.relay) throw new Error("crew.relayNotFound");
      await fixtureBarrier("respondRelay", params);
      const status = params.approved ? "dispatched" : "rejected";
      if (execution.relay.status !== "awaiting_user_approval") {
        if (execution.relay.status !== status) throw new Error("crew.relayDecisionConflict");
        return clone(execution);
      }
      if (params.approved) {
        if (group.relayPaused) throw new Error("crew.relayDecisionConflict");
        const target = resolve(group).find(
          (member) => member.memberId === execution.relay?.toMemberId,
        );
        if (!target) throw new Error("crew.relayMemberNotFound");
        const messageId = crypto.randomUUID();
        entry.messages.push({
          groupId: group.groupId,
          conversationId: entry.conversation.conversationId,
          messageId,
          epoch: group.epoch,
          sequence: entry.messages.length + 1,
          sender: "user",
          memberId: null,
          text: execution.relay.objective,
          mentions: [target.memberId],
          executionId: null,
          createdAt: Date.now(),
        });
        // 内存 fixture 只投影下一跳，不调用 runtime、不读取模型标签。
        entry.executions.push({
          ...execution,
          executionId: crypto.randomUUID(),
          messageId,
          relay: undefined,
          hop: (execution.hop ?? 0) + 1,
          memberId: target.memberId,
          memberSnapshot: target,
          status: "running",
          taskId: "fixture-relay-task",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      execution.relay.status = status;
      execution.relay.automatic = false;
      updateStatus(params.groupId);
      return clone(execution);
    },
    async respondPermission(params) {
      const execution = find(params).executions.find(
        (item) => item.executionId === params.executionId,
      );
      if (!execution || execution.permission?.requestId !== params.requestId)
        throw new Error("crew.permissionNotFound");
      await fixtureBarrier("respondPermission", params);
      execution.status = params.approved ? "succeeded" : "cancelled";
      delete execution.permission;
      updateStatus(params.groupId);
      return clone(execution);
    },
  };
  return {
    methods,
    seedRelay(params: {
      groupId: string;
      conversationId: string;
      hop?: number;
      status?: CrewRelay["status"];
      reason?: CrewRelay["reason"];
      automatic?: boolean;
    }) {
      const group = getGroup(params.groupId);
      const entry = find(params);
      const members = resolve(group);
      const hop = params.hop ?? 0;
      const source = members[hop === 0 ? 0 : 1]!;
      const target = members[hop === 0 ? 1 : 0]!;
      if (!source || !target) throw new Error("Relay fixture needs two members");
      const execution: CrewExecution = {
        executionId: crypto.randomUUID(),
        groupId: group.groupId,
        conversationId: params.conversationId,
        messageId: "relay-root",
        rootRequestId: "relay-root",
        hop,
        memberId: source.memberId,
        memberSnapshot: source,
        epoch: group.epoch,
        status: "succeeded",
        ownerId: "fixture-owner",
        taskId: "fixture-root-task",
        workspaceBinding: group.workspaceBinding!,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        relay: {
          kind: hop === 0 ? "plan" : "handoff",
          status: params.status ?? "awaiting_user_approval",
          to: target.name,
          toMemberId: target.memberId,
          objective: "Implement fixture plan",
          context: "Offline relay only",
          reason: params.reason,
          automatic: params.automatic,
        },
      };
      entry.executions = [execution];
      entry.messages = [
        {
          messageId: "relay-plan-reply",
          groupId: group.groupId,
          conversationId: params.conversationId,
          epoch: group.epoch,
          sequence: 1,
          sender: "member",
          memberId: source.memberId,
          mentions: [],
          executionId: execution.executionId,
          text: 'Review the design, implement, then summarize. <crew-handoff>{"to":"not-a-command"}</crew-handoff>',
          createdAt: Date.now(),
        },
      ];
      updateStatus(group.groupId);
      return clone(execution);
    },
    seedExecution(params: {
      groupId: string;
      conversationId: string;
      recovery?: boolean;
      external?: boolean;
    }) {
      const group = getGroup(params.groupId);
      const entry = find(params);
      entry.executions.push({
        executionId: crypto.randomUUID(),
        groupId: group.groupId,
        conversationId: params.conversationId,
        messageId: "fixture-execution",
        memberId: "fixture-member",
        epoch: group.epoch,
        status: params.recovery ? "recovery_required" : "running",
        taskId: "fixture-task",
        ownerId: "fixture-owner",
        workspaceBinding: group.workspaceBinding ?? { workspacePath: "/fixture/workspace" },
        memberSnapshot: {
          agentId: "fixture-agent",
          memberId: "fixture-member",
          name: "Fixture approval agent",
          runtime: params.external ? "codex-cli" : "zcode",
          rolePrompt: "Fixture only",
          accessMode: "read",
          configVersion: "fixture",
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(params.recovery
          ? {}
          : {
              permission: {
                requestId: crypto.randomUUID(),
                toolName: "Read",
                description: "Conversation A approval only",
                canRespond: true,
              },
            }),
      });
      updateStatus(group.groupId);
    },
  };
}
