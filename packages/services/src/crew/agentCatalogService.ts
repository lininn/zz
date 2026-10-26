import {
  CREW_BUILTIN_MANAGER_AGENT_ID,
  crewAgentSchema,
  crewAgentListParamsSchema,
  crewAgentGetParamsSchema,
  crewAgentCreateParamsSchema,
  crewAgentUpdateParamsSchema,
  crewAgentDeleteParamsSchema,
  type CrewAgent,
  type CrewAgentListParams,
  type CrewAgentGetParams,
  type CrewAgentCreateParams,
  type CrewAgentUpdateParams,
  type CrewAgentDeleteParams,
} from "@zcode/shared";
import { randomUUID } from "node:crypto";
import type { ICrewAgentCatalogService } from "./agentCatalogContract.js";
import { assertCrewCapabilities, readCrewAgent } from "./agentCatalogStore.js";
import { CrewStore } from "./crewStore.js";

/** Agent 定义唯一写入入口；共享同库写锁与 FK，引用校验和删除不存在 TOCTOU 窗口。 */
export class CrewAgentCatalogService implements ICrewAgentCatalogService {
  private readonly store: CrewStore;
  private closed = false;
  constructor(databasePath?: string) {
    this.store = new CrewStore(databasePath);
  }
  private async ready(): Promise<void> {
    if (this.closed) throw new Error("crew.serviceClosed");
    await this.store.initialize();
    if (this.closed) throw new Error("crew.serviceClosed");
  }
  async list(params: CrewAgentListParams): Promise<CrewAgent[]> {
    crewAgentListParamsSchema.parse(params);
    await this.ready();
    return this.store.transaction(() =>
      this.store.db
        .prepare("SELECT agent_id FROM agent_crew_agents ORDER BY agent_id")
        .all()
        .map((row) => readCrewAgent(this.store.db, String(row.agent_id))),
    );
  }
  async get(params: CrewAgentGetParams): Promise<CrewAgent> {
    const { agentId } = crewAgentGetParamsSchema.parse(params);
    await this.ready();
    return readCrewAgent(this.store.db, agentId);
  }
  async create(params: CrewAgentCreateParams): Promise<CrewAgent> {
    const input = crewAgentCreateParamsSchema.parse(params);
    assertCrewCapabilities(input);
    await this.ready();
    return this.store.transaction(() => {
      const now = Date.now();
      const agent = crewAgentSchema.parse({
        ...input,
        agentId: randomUUID(),
        configVersion: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      this.store.db
        .prepare("INSERT INTO agent_crew_agents VALUES(?,?)")
        .run(agent.agentId, JSON.stringify(agent));
      return agent;
    });
  }
  async update(params: CrewAgentUpdateParams): Promise<CrewAgent> {
    const { agentId, ...changes } = crewAgentUpdateParamsSchema.parse(params);
    await this.ready();
    return this.store.transaction(() => {
      const old = readCrewAgent(this.store.db, agentId);
      const merged = {
        ...old,
        ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
      };
      const agent = crewAgentSchema.parse({
        ...merged,
        modelSelection: merged.modelSelection ?? undefined,
        toolAllowlist: merged.toolAllowlist ?? undefined,
        configVersion: randomUUID(),
        updatedAt: Math.max(Date.now(), old.updatedAt + 1),
      });
      if (agent.modelSelection === undefined) delete agent.modelSelection;
      if (agent.toolAllowlist === undefined) delete agent.toolAllowlist;
      assertCrewCapabilities(agent);
      // 把已加入群组的 Agent 改成管理者时，不能与该群组现有管理者并存。
      if (agent.isManager === true) {
        const conflict = this.store.db
          .prepare(
            `SELECT 1 FROM agent_crew_members mine
             JOIN agent_crew_members other
               ON other.group_id = mine.group_id AND other.agent_id <> mine.agent_id
             JOIN agent_crew_agents peer ON peer.agent_id = other.agent_id
             WHERE mine.agent_id = ?
               AND json_extract(peer.definition_json, '$.isManager') = 1
             LIMIT 1`,
          )
          .get(agentId);
        if (conflict) throw new Error("crew.multipleManagers");
      }
      this.store.db
        .prepare("UPDATE agent_crew_agents SET definition_json=? WHERE agent_id=?")
        .run(JSON.stringify(agent), agentId);
      return agent;
    });
  }
  async delete(params: CrewAgentDeleteParams): Promise<void> {
    const { agentId } = crewAgentDeleteParamsSchema.parse(params);
    await this.ready();
    this.store.transaction(() => {
      readCrewAgent(this.store.db, agentId);
      // 内置管理者是首次安装的统筹角色，允许编辑但不能删除，否则会被下次启动重新写入。
      if (agentId === CREW_BUILTIN_MANAGER_AGENT_ID) throw new Error("crew.builtinAgentLocked");
      if (
        this.store.db
          .prepare("SELECT 1 FROM agent_crew_members WHERE agent_id=? LIMIT 1")
          .get(agentId)
      )
        throw new Error("crew.agentInUse");
      this.store.db.prepare("DELETE FROM agent_crew_agents WHERE agent_id=?").run(agentId);
    });
  }
  async dispose(): Promise<void> {
    this.closed = true;
    await this.store.shutdown();
  }
}
