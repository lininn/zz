import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { ICrewAgentCatalogService } from "@zcode/services";
import type { CrewAgentInput } from "@zcode/shared";
import { useServices } from "./useServices.js";
import { crewErrorKey } from "@/crew/crewErrors.js";
import { createCrewId } from "@/crew/crewUiHelpers.js";
import { crewAgentUpdate } from "@/crew/crewCatalogUi.js";

/** catalog 服务是定义唯一所有者；这里只保存读投影和表单命令状态。 */
export function useCrewAgentCatalog(onChanged?: () => Promise<unknown>) {
  const { crewAgentCatalogService: service } = useServices();
  // 非 secure context（局域网 IP）没有 crypto.randomUUID，必须走 crew 兼容实现。
  const ownerKey = useMemo(() => createCrewId(), [service]);
  const list = useSWR(
    service ? ["crew-agent-catalog", ownerKey] : null,
    service ? () => service.list({}) : null,
    {
      shouldRetryOnError: false,
    },
  );
  const [pending, setPending] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    await Promise.allSettled([list.mutate()]);
  }, [list.mutate]);
  const run = useCallback(
    async <T>(operation: (owner: ICrewAgentCatalogService) => Promise<T>) => {
      if (!service || inFlight.current) return { ok: false } as const;
      inFlight.current = true;
      setPending(true);
      setCommandError(null);
      try {
        const value = await operation(service);
        // 提交成功之后的刷新失败不能变成创建失败，避免用户重试生成重复资产。
        await Promise.allSettled([refresh(), Promise.resolve().then(() => onChanged?.())]);
        return { ok: true, value } as const;
      } catch (error) {
        setCommandError(crewErrorKey(error));
        await Promise.allSettled([refresh(), Promise.resolve().then(() => onChanged?.())]);
        return { ok: false } as const;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [service, refresh, onChanged],
  );
  return {
    agents: list.data ?? [],
    loading: list.isLoading,
    unavailable: !service,
    readError: Boolean(list.error),
    pending,
    commandError,
    refresh,
    clearError: () => setCommandError(null),
    create: (input: CrewAgentInput) => run((owner) => owner.create(input)),
    update: (agentId: string, input: CrewAgentInput) =>
      run((owner) => owner.update(crewAgentUpdate(agentId, input))),
    remove: (agentId: string) => run((owner) => owner.delete({ agentId })),
  };
}
export type CrewAgentCatalogController = ReturnType<typeof useCrewAgentCatalog>;
