import {
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
