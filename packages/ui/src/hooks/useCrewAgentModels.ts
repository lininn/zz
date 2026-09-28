import { useOptionalServices } from "./useServices.js";
import { useModelSelectionServiceView } from "./useModelSelectionView.js";

/** 独立 Agent 目录使用同一 Host 的模型注册表，不借用任意工作区/远端模型。 */
export function useCrewAgentModels() {
  const services = useOptionalServices();
  return useModelSelectionServiceView(services?.modelSelectionService);
}
