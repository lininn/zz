import type { IZCodeAgentService } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useZCodeAgentService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IZCodeAgentService {
  // Bugfix：这里曾用三元在两个 hook 之间切换（与 useZCodeSessionService 同款问题）。
  // workspacePath 启动期会从无到有，两次 render 的 hook 数量随之错位，触发
  // "change in the order of Hooks"。Rules of Hooks：无条件调用，再按条件取值。
  const contextServices = useServices();
  const workspaceServices = useWorkspaceServices(
    workspacePath ?? "",
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  return (workspacePath ? workspaceServices : contextServices).zcodeAgentService;
}
