import { useMemo } from "react";
import type { CrewWorkspaceBinding } from "@zcode/shared";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useOptionalPlatform } from "./usePlatform.js";
import { crewBindingKey } from "@/crew/crewUiHelpers.js";

export function useCrewWorkspaceOptions() {
  const tabs = useTabStore((state) => state.tabs);
  const platform = useOptionalPlatform();
  const workspaces = useMemo(() => {
    const bindings = new Map<string, CrewWorkspaceBinding>();
    for (const tab of tabs) {
      if (!isWorkspaceTab(tab)) continue;
      // 远端身份尚未确定时不能退化成本机同路径，等待已有连接完成身份解析。
      if (tab.remoteTarget && !tab.workspaceIdentity?.trim()) continue;
      const binding = {
        workspacePath: tab.workspacePath,
        workspaceIdentity: tab.workspaceIdentity,
        remoteSessionId: tab.remoteSessionId,
      };
      bindings.set(crewBindingKey(binding), binding);
    }
    return [...bindings.values()];
  }, [tabs]);
  return {
    workspaces,
    canSelectDirectory: Boolean(platform?.canSelectFilePath),
    selectDirectory: async (): Promise<CrewWorkspaceBinding | null> => {
      if (!platform?.canSelectFilePath) return null;
      const workspacePath = await platform.selectDirectory();
      return workspacePath ? { workspacePath } : null;
    },
  };
}
