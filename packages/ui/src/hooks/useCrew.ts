import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ICrewService } from "@zcode/services";
import { crewGroupDetailSchema } from "@zcode/shared";
import type {
  CrewBindParams,
  CrewCancelParams,
  CrewConversationCreateParams,
  CrewConversationDeleteParams,
  CrewCreateParams,
  CrewDuplicateParams,
  CrewPermissionParams,
  CrewRecoverParams,
  CrewRelayParams,
  CrewSendParams,
  CrewUpdateParams,
} from "@zcode/shared";
import { crewErrorKey } from "@/crew/crewErrors.js";
import { crewCacheScope } from "./crewCacheScope.js";
import { useServices } from "./useServices.js";
import { createCrewRequestScope, runCrewCommand } from "./crewRequestScope.js";

type ConversationCommand<T> = T & { conversationId: string };

/** CrewService 是事实源；SWR 只缓存读投影，不产生 optimistic execution 或 accepted queue。 */
export function useCrew(
  groupId: string | null,
  conversationId: string | null = null,
  visible = true,
  readDetail = true,
) {
  const { crewService } = useServices();
  const { mutate } = useSWRConfig();
  // 非 secure context（局域网 IP 访问 Web）没有 crypto.randomUUID，必须走 crew 兼容实现。
  const ownerKey = useMemo(() => crewCacheScope(crewService), [crewService]);
  const options = {
    shouldRetryOnError: false,
    keepPreviousData: false,
    revalidateOnFocus: visible,
    revalidateOnReconnect: visible,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  };
  const listKey = useMemo(() => ["crew-list", ownerKey], [ownerKey]);
  const conversationsKey = useMemo(
    () => (groupId ? ["crew-conversations", ownerKey, groupId] : null),
    [ownerKey, groupId],
  );
  // 隐藏只暂停 fetcher/轮询，不丢弃同 key 缓存，避免设置覆盖时卸载输入框并丢失草稿。
  const list = useSWR(
    crewService && !groupId ? listKey : null,
    crewService && visible ? () => crewService.list({}) : null,
    {
      ...options,
      refreshInterval: (groups) =>
        !visible ? 0 : groups?.some((group) => group.status === "active") ? 2500 : 5000,
    },
  );
  const conversations = useSWR(
    crewService ? conversationsKey : null,
    crewService && groupId && visible ? () => crewService.listConversations({ groupId }) : null,
    {
      ...options,
      refreshInterval: (items) =>
        visible ? (items?.some((item) => item.status === "active") ? 2500 : 5000) : 0,
    },
  );
  // 群概览也显式读取服务声明的默认会话，不能用省略 ID 或列表顺序猜测。
  const selectedId =
    conversationId ?? conversations.data?.find((item) => item.isDefault)?.conversationId;
  const detailKey = useMemo(
    () => (groupId && selectedId ? ["crew-detail", ownerKey, groupId, selectedId] : null),
    [ownerKey, groupId, selectedId],
  );
  const detail = useSWR(
    crewService && readDetail ? detailKey : null,
    crewService && groupId && selectedId && visible && readDetail
      ? async () => {
          // 无效/错属响应曾被静默过滤成 undefined，主区因而误显示“未选择”。
          // 在读边界拒绝，让 SWR 保留目标 key 并进入可重试的错误态。
          const view = crewGroupDetailSchema.parse(
            await crewService.get({ groupId, conversationId: selectedId }),
          );
          if (view.group.groupId !== groupId) throw new Error("crew.groupNotFound");
          if (
            view.conversation.groupId !== groupId ||
            view.conversation.conversationId !== selectedId
          )
            throw new Error("crew.conversationNotFound");
          return view;
        }
      : null,
    {
      ...options,
      refreshInterval: (view) =>
        !visible
          ? 0
          : view?.group.status === "active" ||
              view?.executions.some((execution) => ["queued", "running"].includes(execution.status))
            ? 2500
            : 5000,
    },
  );
  const previousVisible = useRef(visible);
  useEffect(() => {
    const resumed = visible && !previousVisible.current;
    previousVisible.current = visible;
    if (!resumed) return;
    // SWR 的同 key 从 null fetcher 恢复不会自动首读；只刷新未在请求中的当前投影。
    for (const [key, loading] of [
      [groupId ? null : listKey, list.isLoading],
      [conversationsKey, conversations.isLoading],
      [readDetail ? detailKey : null, detail.isLoading],
    ] as const) {
      if (key && !loading) void mutate(key).catch(() => {});
    }
  }, [
    visible,
    groupId,
    listKey,
    conversationsKey,
    detailKey,
    readDetail,
    list.isLoading,
    conversations.isLoading,
    detail.isLoading,
    mutate,
  ]);
  const scope = useMemo(createCrewRequestScope, [ownerKey, groupId, conversationId, visible]);
  const current = useRef<typeof scope | null>(scope);
  current.current = scope;
  useEffect(() => {
    current.current = scope;
    return () => {
      if (current.current === scope) current.current = null;
    };
  }, [scope]);
  const [, notify] = useReducer((revision: number) => revision + 1, 0);
  const refresh = useCallback(
    async (targetGroupId = groupId, allDetails = false) => {
      // 使用捕获的 key，而非指向当前选中项的 bound mutate，晚到响应不会刷新另一个会话。
      await Promise.allSettled(
        [
          listKey,
          targetGroupId ? ["crew-conversations", ownerKey, targetGroupId] : conversationsKey,
          detailKey,
        ]
          .filter((key) => key !== null)
          .map((key) => mutate(key)),
      );
      if (allDetails && targetGroupId) {
        await mutate(
          (key) =>
            Array.isArray(key) &&
            key[0] === "crew-detail" &&
            key[1] === ownerKey &&
            key[2] === targetGroupId,
        );
      }
    },
    [mutate, listKey, conversationsKey, detailKey, groupId, ownerKey],
  );
  const run = <T>(
    operation: (service: ICrewService) => Promise<T>,
    targetGroupId = groupId,
    allDetails = false,
  ) => {
    const isCurrent = () => current.current === scope;
    if (!crewService) return Promise.resolve({ ok: false, isCurrent, error: null } as const);
    return runCrewCommand(
      scope,
      isCurrent,
      () => operation(crewService),
      () => refresh(targetGroupId, allDetails),
      notify,
    );
  };
  const runConversation = <P extends { groupId: string; conversationId: string }, T>(
    params: P,
    operation: (service: ICrewService, params: P) => Promise<T>,
  ) =>
    run((service) => {
      if (params.groupId !== groupId || params.conversationId !== conversationId)
        throw new Error("crew.conversationNotFound");
      return operation(service, params);
    });
  const projection =
    !detail.error &&
    detail.data?.group.groupId === groupId &&
    detail.data?.conversation.conversationId === selectedId
      ? detail.data
      : undefined;

  return {
    groups: list.data ?? [],
    conversations: conversations.data ?? [],
    detail: projection,
    loading:
      list.isLoading ||
      Boolean(groupId && (conversations.isLoading || (readDetail && detail.isLoading))),
    pending: scope.pending,
    unavailable: !crewService,
    readError: Boolean(list.error || conversations.error || detail.error),
    readErrorKey: crewErrorKey(list.error || conversations.error || detail.error),
    commandError: scope.error,
    clearError: () => {
      scope.error = null;
      notify();
    },
    refresh,
    create: (params: CrewCreateParams) => run((service) => service.create(params)),
    update: (params: CrewUpdateParams) =>
      run((service) => service.update(params), params.groupId, true),
    remove: (id: string) => run((service) => service.delete({ groupId: id }), id, true),
    duplicate: (params: CrewDuplicateParams) => run((service) => service.duplicate(params)),
    bind: (params: CrewBindParams) => run((service) => service.bind(params), params.groupId, true),
    createConversation: (params: CrewConversationCreateParams) =>
      run((service) => service.createConversation(params), params.groupId),
    deleteConversation: (params: CrewConversationDeleteParams) =>
      // allDetails 使被删会话对应的主区 detail 投影一并失效，避免残留已删除会话视图。
      run((service) => service.deleteConversation(params), params.groupId, true),
    send: (params: ConversationCommand<CrewSendParams>) =>
      runConversation(params, (service, input) => service.send(input)),
    recover: (params: ConversationCommand<CrewRecoverParams>) =>
      runConversation(params, (service, input) => service.recover(input)),
    respondPermission: (params: ConversationCommand<CrewPermissionParams>) =>
      runConversation(params, (service, input) => service.respondPermission(input)),
    respondRelay: (params: ConversationCommand<CrewRelayParams>) =>
      runConversation(params, (service, input) => service.respondRelay(input)),
    cancel: (params: ConversationCommand<CrewCancelParams>) =>
      runConversation(params, (service, input) => service.cancel(input)),
  };
}
export type CrewController = ReturnType<typeof useCrew>;
