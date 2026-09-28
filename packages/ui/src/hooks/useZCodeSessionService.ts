import type { IZCodeSessionService } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

export function useZCodeSessionService(
  workspacePath?: string,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string | null,
): IZCodeSessionService {
  // Bugfix：这里曾用三元在两个 hook 之间切换。workspacePath 在启动期会从无到有
  // （workspace tab 恢复激活），两次 render 的 hook 数量随之错位，触发
  // "change in the order of Hooks" 并崩掉 OnboardingDialog 子树（每次刷新必现）。
  // Rules of Hooks：无条件调用两个 hook，再按条件选择结果。
  const contextServices = useServices();
  const workspaceServices = useWorkspaceServices(
    workspacePath ?? "",
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  return (workspacePath ? workspaceServices : contextServices).zcodeSessionService;
}
