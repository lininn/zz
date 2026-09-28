import useSWR from "swr";
import { crewExecutionDetailSchema, type CrewExecution } from "@zcode/shared";
import { useServices } from "./useServices.js";
import { crewCacheScope } from "./crewCacheScope.js";

/** 详情是既有执行的只读投影；折叠后卸载，SWR 不后台轮询历史任务。 */
export function useCrewExecutionDetail(execution: CrewExecution) {
  const { crewService } = useServices();
  return useSWR(
    crewService
      ? [
          "crew-execution-detail",
          crewCacheScope(crewService),
          execution.groupId,
          execution.conversationId,
          execution.executionId,
          execution.taskId,
          execution.status,
          execution.updatedAt,
        ]
      : null,
    async () => {
      if (!crewService) throw new Error("crew.serviceUnavailable");
      const result = crewExecutionDetailSchema.parse(
        await crewService.readExecution({
          groupId: execution.groupId,
          conversationId: execution.conversationId,
          executionId: execution.executionId,
        }),
      );
      if (
        result.execution.groupId !== execution.groupId ||
        result.execution.conversationId !== execution.conversationId ||
        result.execution.executionId !== execution.executionId
      )
        throw new Error("crew.executionNotFound");
      return result;
    },
    {
      keepPreviousData: false,
      shouldRetryOnError: false,
      refreshWhenHidden: false,
      refreshWhenOffline: false,
      refreshInterval: ["queued", "running"].includes(execution.status) ? 2500 : 0,
    },
  );
}
