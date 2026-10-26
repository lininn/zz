import {
  crewAgentSchema,
  type CrewAgent,
  type CrewMember,
  type CrewResolvedMember,
} from "@zcode/shared";
import type { DatabaseSync } from "node:sqlite";

export function readCrewAgent(db: DatabaseSync, agentId: string): CrewAgent {
  const row = db
    .prepare("SELECT definition_json FROM agent_crew_agents WHERE agent_id=?")
    .get(agentId);
  if (!row) throw new Error("crew.agentNotFound");
  return crewAgentSchema.parse(JSON.parse(String(row.definition_json)));
}

export function assertCrewCapabilities(agent: Pick<CrewAgent, "runtime" | "toolAllowlist">): void {
  // 外部 CLI 尚无逐工具约束端口，空列表也不能被静默当成无限制执行。
  if (agent.runtime !== "zcode" && agent.toolAllowlist !== undefined)
    throw new Error("crew.capabilitiesUnsupported");
}

export function resolveCrewMember(
  db: DatabaseSync,
  member: CrewMember,
  validateOverride = false,
): CrewResolvedMember {
  const agent = readCrewAgent(db, member.agentId);
  if (validateOverride && agent.accessMode === "read" && member.accessMode === "write")
    throw new Error("crew.permissionEscalation");
  // 资产降权后既有引用仍可展示/派工，但有效权限必须收敛到最新资产上限。
  return {
    memberId: member.memberId,
    agentId: agent.agentId,
    configVersion: agent.configVersion,
    name: agent.name,
    rolePrompt: agent.systemPrompt,
    runtime: agent.runtime,
    accessMode: agent.accessMode === "read" ? "read" : (member.accessMode ?? agent.accessMode),
    // 仅在管理者上输出 true；普通成员省略该字段，保持旧快照比较稳定。
    ...(agent.isManager === true ? { isManager: true } : {}),
    ...(agent.modelSelection !== undefined ? { modelSelection: agent.modelSelection } : {}),
    ...(agent.toolAllowlist !== undefined ? { toolAllowlist: agent.toolAllowlist } : {}),
  };
}
