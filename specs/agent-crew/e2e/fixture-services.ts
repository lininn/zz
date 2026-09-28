import {
  initializeConversations,
  deleteConversations,
  conversationState,
  conversationFixture,
} from "./fixture-conversations.js";
import { fixtureBarrier, fixtureDelays } from "./fixture-delays.js";
import {
  crewAgentCreateParamsSchema,
  crewAgentUpdateParamsSchema,
  crewCreateParamsSchema,
  crewUpdateParamsSchema,
  type CrewAgent,
  type CrewGroup,
  type CrewMemberInput,
  type CrewResolvedMember,
} from "@zcode/shared";
import type { ICrewAgentCatalogService, ICrewService, IServiceAccessor } from "@zcode/services";

// 仅供离线浏览器交互：真实组件与 hooks，内存服务替身；不声称 SQLite/Host E2E。
const agents = new Map<string, CrewAgent>();
const groups = new Map<string, CrewGroup>();
const clone = <T>(value: T): T => structuredClone(value);
const getAgent = (id: string) => {
  const agent = agents.get(id);
  if (!agent) throw new Error("crew.agentNotFound");
  return agent;
};
const getGroup = (id: string) => {
  const group = groups.get(id);
  if (!group) throw new Error("crew.groupNotFound");
  return group;
};
const members = (inputs: CrewMemberInput[]) =>
  inputs.map((input) => {
    getAgent(input.agentId);
    return { ...input, memberId: input.memberId ?? crypto.randomUUID() };
  });
const resolve = (group: CrewGroup): CrewResolvedMember[] =>
  group.members.map((member) => {
    const agent = getAgent(member.agentId);
    return {
      memberId: member.memberId,
      agentId: agent.agentId,
      name: agent.name,
      rolePrompt: agent.systemPrompt,
      runtime: agent.runtime,
      configVersion: agent.configVersion,
      accessMode: agent.accessMode === "read" ? "read" : (member.accessMode ?? agent.accessMode),
      ...(agent.modelSelection ? { modelSelection: agent.modelSelection } : {}),
      ...(agent.toolAllowlist ? { toolAllowlist: agent.toolAllowlist } : {}),
    };
  });
const catalog: ICrewAgentCatalogService = {
  async list() {
    return clone([...agents.values()]);
  },
  async get({ agentId }) {
    return clone(getAgent(agentId));
  },
  async create(input) {
    const checked = crewAgentCreateParamsSchema.parse(input);
    const now = Date.now();
    const agent = {
      ...checked,
      agentId: crypto.randomUUID(),
      configVersion: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    agents.set(agent.agentId, agent);
    return clone(agent);
  },
  async update(input) {
    const checked = crewAgentUpdateParamsSchema.parse(input);
    const agent = {
      ...getAgent(checked.agentId),
      ...checked,
      configVersion: crypto.randomUUID(),
      updatedAt: Date.now(),
    } as CrewAgent;
    if (checked.modelSelection === null) delete agent.modelSelection;
    if (checked.toolAllowlist === null) delete agent.toolAllowlist;
    agents.set(agent.agentId, agent);
    return clone(agent);
  },
  async delete({ agentId }) {
    getAgent(agentId);
    if (
      [...groups.values()].some((group) =>
        group.members.some((member) => member.agentId === agentId),
      )
    ) {
      throw new Error("crew.agentInUse");
    }
    agents.delete(agentId);
  },
};
const conversation = conversationFixture(getGroup, resolve);
const crew: ICrewService = {
  ...conversation.methods,
  async list() {
    return clone([...groups.values()]);
  },
  async create(input) {
    const checked = crewCreateParamsSchema.parse(input);
    const now = Date.now();
    const group: CrewGroup = {
      ...checked,
      members: members(checked.members),
      groupId: crypto.randomUUID(),
      workspaceBinding: null,
      epoch: 0,
      status: "unbound",
      createdAt: now,
      updatedAt: now,
    };
    groups.set(group.groupId, group);
    initializeConversations(group.groupId);
    return clone(group);
  },
  async update(input) {
    const checked = crewUpdateParamsSchema.parse(input);
    const group = getGroup(checked.groupId);
    await fixtureBarrier("update", checked);
    for (const key of [
      "relayMode",
      "relayAutoHops",
      "relayBudgetMinutes",
      "relayPaused",
    ] as const) {
      if (checked[key] !== undefined) Object.assign(group, { [key]: checked[key] });
    }
    if (checked.name !== undefined) group.name = checked.name;
    if (checked.members) group.members = members(checked.members);
    group.updatedAt = Date.now();
    return clone(group);
  },
  async delete({ groupId }) {
    getGroup(groupId);
    groups.delete(groupId);
    deleteConversations(groupId);
  },
  async bind({ groupId, binding }) {
    const group = getGroup(groupId);
    group.workspaceBinding = binding;
    group.epoch++;
    group.status = "idle";
    return clone(group);
  },
  async readExecution({ groupId, conversationId, executionId }) {
    const detail = await this.get({ groupId, conversationId });
    const execution = detail.executions.find((item) => item.executionId === executionId);
    if (!execution) throw new Error("crew.executionNotFound");
    return { execution, runtimeTask: null, unavailableReason: "runtimeReadFailed" };
  },
  async duplicate({ groupId, name }) {
    const group = getGroup(groupId);
    return this.create({
      name: name ?? group.name,
      members: group.members.map(({ memberId: _, ...member }) => member),
    });
  },
};
export const fixtureServices = {
  crewService: crew,
  crewAgentCatalogService: catalog,
} as IServiceAccessor;
export const fixtureState = () =>
  clone({
    agents: [...agents.values()],
    groups: [...groups.values()],
    conversations: conversationState(),
    ...fixtureDelays.state(),
  });
export const fixtureControl = {
  ...fixtureDelays,
  seedExecution: conversation.seedExecution,
  seedRelay: conversation.seedRelay,
};
