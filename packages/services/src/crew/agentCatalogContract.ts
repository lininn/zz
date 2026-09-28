import { ServiceChannels } from "@zcode/shared";
import type {
  CrewAgent,
  CrewAgentListParams,
  CrewAgentGetParams,
  CrewAgentCreateParams,
  CrewAgentUpdateParams,
  CrewAgentDeleteParams,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 独立 Agent 资产库；更新不改写群引用，删除被引用资产必须拒绝。 */
export interface ICrewAgentCatalogService {
  list(params: CrewAgentListParams): Promise<CrewAgent[]>;
  get(params: CrewAgentGetParams): Promise<CrewAgent>;
  create(params: CrewAgentCreateParams): Promise<CrewAgent>;
  update(params: CrewAgentUpdateParams): Promise<CrewAgent>;
  delete(params: CrewAgentDeleteParams): Promise<void>;
}
export const ICrewAgentCatalogService = createServiceDescriptor<ICrewAgentCatalogService>(
  ServiceChannels.CrewAgentCatalog,
);
