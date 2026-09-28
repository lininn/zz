import { crewCreateParamsSchema } from "@zcode/shared";
import type {
  CrewAgent,
  CrewAgentInput,
  CrewAgentUpdateParams,
  CrewMemberInput,
} from "@zcode/shared";

/** 群组只传引用；旧的内嵌定义不能再次随 UI 保存到群组。 */
export function crewGroupInput(
  name: string,
  members: readonly CrewMemberInput[],
  agents: readonly CrewAgent[],
) {
  const seen = new Set<string>();
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  for (const member of members) {
    const agent = byId.get(member.agentId);
    if (!agent) throw new Error("crew.agentNotFound");
    if (seen.has(member.agentId)) throw new Error("crew.duplicateAgentId");
    if (agent.accessMode === "read" && member.accessMode === "write")
      throw new Error("crew.permissionEscalation");
    seen.add(member.agentId);
  }
  return crewCreateParamsSchema.parse({
    name: name.trim(),
    members: members.map(({ memberId, agentId, accessMode }) => ({
      ...(memberId ? { memberId } : {}),
      agentId,
      ...(accessMode ? { accessMode } : {}),
    })),
  });
}

/** catalog 降权不改旧引用；编辑器按有效只读权限构造草稿，避免仅改名也被旧 write 覆写阻塞。 */
export function crewEditorMembers(
  members: readonly CrewMemberInput[],
  agents: readonly CrewAgent[],
): CrewMemberInput[] {
  const readOnly = new Set(
    agents.filter((agent) => agent.accessMode === "read").map((agent) => agent.agentId),
  );
  return members.map((member) =>
    member.accessMode === "write" && readOnly.has(member.agentId)
      ? { ...member, accessMode: "read" }
      : member,
  );
}

export function toggleCrewAgent(
  members: readonly CrewMemberInput[],
  agentId: string,
): CrewMemberInput[] {
  return members.some((member) => member.agentId === agentId)
    ? members.filter((member) => member.agentId !== agentId)
    : [...members, { agentId }];
}

/** undefined 无法经 JSON 清除旧配置；切换外部 CLI 也必须显式清除 ZCode 专属字段。 */
export function crewAgentUpdate(agentId: string, input: CrewAgentInput): CrewAgentUpdateParams {
  return {
    ...input,
    agentId,
    modelSelection: input.runtime === "zcode" ? (input.modelSelection ?? null) : null,
    toolAllowlist: input.runtime === "zcode" ? (input.toolAllowlist ?? null) : null,
  };
}
