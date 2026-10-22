import type {
  CrewExecution,
  CrewGroupDetail,
  CrewMessage,
  CrewResolvedMember,
} from "@zcode/shared";

export const chatMember: CrewResolvedMember = {
  memberId: "a",
  agentId: "agent-a",
  configVersion: "v1",
  name: "Original Analyst",
  rolePrompt: "Inspect",
  runtime: "zcode",
  accessMode: "read",
};
export const chatExecution: CrewExecution = {
  executionId: "exec-a",
  groupId: "group",
  conversationId: "chat",
  messageId: "request",
  memberId: "a",
  epoch: 1,
  status: "succeeded",
  memberSnapshot: chatMember,
  workspaceBinding: { workspacePath: "/workspace" },
  ownerId: null,
  taskId: "task-a",
  createdAt: 1000,
  updatedAt: 66000,
};
export function chatMessage(overrides: Partial<CrewMessage> = {}): CrewMessage {
  return {
    messageId: "request",
    groupId: "group",
    conversationId: "chat",
    epoch: 1,
    sequence: 1,
    sender: "user",
    kind: "chat",
    memberId: null,
    text: "Inspect this",
    mentions: ["a"],
    executionId: null,
    createdAt: 1000,
    ...overrides,
  };
}
export function chatDetail(overrides: Partial<CrewGroupDetail> = {}): CrewGroupDetail {
  const conversation: CrewGroupDetail["conversation"] = {
    groupId: "group",
    conversationId: "chat",
    name: "Review",
    isDefault: true,
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
  };
  return {
    group: {
      groupId: "group",
      name: "Review crew",
      announcement: "",
      epoch: 1,
      status: "idle",
      members: [{ memberId: "a", agentId: "agent-a" }],
      workspaceBinding: { workspacePath: "/workspace" },
      createdAt: 0,
      updatedAt: 0,
    },
    conversation,
    conversations: [conversation],
    resolvedMembers: [{ ...chatMember, name: "Renamed Analyst", configVersion: "v2" }],
    messages: [chatMessage()],
    executions: [chatExecution],
    ...overrides,
  };
}
