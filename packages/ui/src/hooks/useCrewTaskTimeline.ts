import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { CrewExecution } from "@zcode/shared";
import { useZCodeAgentService } from "./useZCodeAgentService.js";
import {
  acquireWorkspaceConnection,
  peekWorkspaceConversationStore,
  type WorkspaceConnectionLease,
} from "@/v4/workspaceConnectionRegistry.js";
import type { ConversationProjectionStore } from "@/v4/conversationProjectionStore.js";

/**
 * crew 执行详情的时间线读取分两档：
 * - 运行中（zcode runtime）：主动 acquire V4 投影。live 会话在 agent 内存中，
 *   conversationSubscribe 直接 attach 现有 publisher，不会触发冷恢复或会话钩子。
 * - 其余（冷会话/外部 runtime）：只 peek 现成投影。普通 rows/range 会冷恢复并运行
 *   SessionStart，被动详情宁可显示不可用。
 */
export function useCrewTaskTimeline(execution: CrewExecution) {
  const binding = execution.workspaceBinding;
  const agent = useZCodeAgentService(
    binding.workspacePath,
    binding.remoteSessionId,
    binding.workspaceIdentity,
  );
  const shouldSubscribe =
    execution.status === "running" &&
    execution.memberSnapshot.runtime === "zcode" &&
    !!execution.taskId &&
    !!binding;
  const [subscribedStore, setSubscribedStore] = useState<ConversationProjectionStore | null>(null);
  const connectionLeaseRef = useRef<WorkspaceConnectionLease | null>(null);
  useEffect(() => {
    if (!shouldSubscribe || !binding || !execution.taskId) {
      setSubscribedStore(null);
      return;
    }
    const connection = acquireWorkspaceConnection(
      {
        workspacePath: binding.workspacePath,
        ...(binding.remoteSessionId ? { remoteSessionId: binding.remoteSessionId } : {}),
        ...(binding.workspaceIdentity ? { workspaceIdentity: binding.workspaceIdentity } : {}),
      },
      agent,
    );
    connectionLeaseRef.current = connection;
    const sessionLease = connection.layer.acquire(execution.taskId);
    setSubscribedStore(sessionLease.store);
    return () => {
      setSubscribedStore(null);
      sessionLease.release();
      connection.release();
      connectionLeaseRef.current = null;
    };
  }, [
    shouldSubscribe,
    execution.taskId,
    agent,
    binding?.workspacePath,
    binding?.remoteSessionId,
    binding?.workspaceIdentity,
  ]);
  const store = subscribedStore ?? (
    execution.taskId ? peekWorkspaceConversationStore(binding, agent, execution.taskId) : null
  );
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const snapshot = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => {
      const state = store?.getState();
      return state?.status === "live" && state.snapshot?.sessionId === execution.taskId
        ? state.snapshot
        : null;
    },
    () => null,
  );
  return { snapshot, refresh };
}
