import { useCallback, useState } from "react";
import { useServices } from "./useServices.js";
import { crewCacheScope } from "./crewCacheScope.js";

/** 仅导航意图，不存储群组/会话事实；换 Host 后旧选择立即失效。 */
export function useCrewHomeNavigation() {
  const { crewService } = useServices();
  const scope = crewCacheScope(crewService);
  const [selection, setSelection] = useState<{
    scope: string;
    groupId: string | null;
    conversationId: string | null;
    editing: boolean;
  } | null>(null);
  const current = selection?.scope === scope ? selection : null;
  const select = useCallback(
    (groupId: string, conversationId: string) => {
      setSelection({ scope, groupId, conversationId, editing: false });
    },
    [scope],
  );
  const edit = useCallback(
    (groupId: string) => {
      setSelection({ scope, groupId, conversationId: null, editing: true });
    },
    [scope],
  );
  const create = useCallback(() => {
    setSelection({ scope, groupId: null, conversationId: null, editing: true });
  }, [scope]);
  return {
    groupId: current?.groupId ?? null,
    conversationId: current?.conversationId ?? null,
    editing: current?.editing ?? false,
    select,
    edit,
    create,
    finishEditing: () =>
      setSelection((value) => (value?.scope === scope ? { ...value, editing: false } : value)),
  };
}
