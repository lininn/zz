import type { CrewConversation, CrewGroup } from "@zcode/shared";
import { crewBindingKey } from "./crewUiHelpers.js";

export interface CrewSidebarBucket {
  key: string | null;
  workspacePath: string | null;
  groups: CrewGroup[];
}

/** 只派生分组：身份隔离用既有 binding key；路径仅用于展示，null 不与任何真实 key 冲突。 */
export function crewSidebarTree(groups: readonly CrewGroup[]): CrewSidebarBucket[] {
  const buckets = new Map<string | null, CrewSidebarBucket>();
  for (const group of groups) {
    const binding = group.workspaceBinding;
    const key = binding ? crewBindingKey(binding) : null;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, workspacePath: binding?.workspacePath ?? null, groups: [] };
      buckets.set(key, bucket);
    }
    bucket.groups.push(group);
  }
  return [...buckets.values()];
}

/** 缓存或迟到投影不得把另一群的同名/同 ID 对话展示到当前群。 */
export function crewSidebarConversations(items: readonly CrewConversation[], groupId: string) {
  return items.filter((conversation) => conversation.groupId === groupId);
}
