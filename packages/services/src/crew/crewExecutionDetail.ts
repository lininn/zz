import {
  crewExecutionDetailParamsSchema,
  crewExecutionDetailSchema,
  type CrewGroupDetail,
  type CrewGetParams,
  type CrewExecutionDetail,
  type CrewExecutionDetailParams,
} from "@zcode/shared";
import type { CrewRuntimePort } from "./contract.js";
import type { CrewStore } from "./crewStore.js";

/** 先验证群/会话所属关系，再按执行时绑定读取，避免重绑后误读另一个工作区。 */
export async function readCrewExecutionDetail(
  store: CrewStore,
  runtime: CrewRuntimePort,
  params: CrewExecutionDetailParams,
): Promise<CrewExecutionDetail> {
  const input = crewExecutionDetailParamsSchema.parse(params);
  store.conversation(input.groupId, input.conversationId);
  const execution = store.execution(input.executionId);
  if (execution.groupId !== input.groupId || execution.conversationId !== input.conversationId)
    throw new Error("crew.executionNotFound");
  const view: CrewExecutionDetail = {
    execution,
    runtimeTask: null,
    unavailableReason: execution.taskId ? null : "taskNotCreated",
  };
  if (execution.taskId && execution.memberSnapshot.runtime !== "zcode") {
    view.unavailableReason = "externalEventsUnavailable";
    try {
      if (!runtime.inspect) throw new Error("Missing runtime reader");
      const task = await runtime.inspect(execution.workspaceBinding, execution.taskId);
      if (task.taskId !== execution.taskId || task.runtimeId !== execution.memberSnapshot.runtime)
        throw new Error("Mismatched runtime task");
      view.runtimeTask = task;
    } catch {
      view.unavailableReason = "runtimeReadFailed";
    }
  }
  return crewExecutionDetailSchema.parse(view);
}

/** 读取派生能力/权限投影，不建立新的状态所有者。 */
export async function readCrewGroupDetail(
  store: CrewStore,
  runtime: CrewRuntimePort,
  { groupId, conversationId }: CrewGetParams,
): Promise<CrewGroupDetail> {
  const detail = store.transaction(() => store.detail(groupId, conversationId));
  if (detail.group.workspaceBinding && runtime.probeMember) {
    detail.runtimeAvailability = (
      await Promise.all(
        detail.resolvedMembers.map(async (member) => {
          const probe = await runtime.probeMember!(detail.group.workspaceBinding!, member);
          return probe ? { ...probe, memberId: member.memberId } : null;
        }),
      )
    ).filter((probe) => probe !== null);
  }
  if (runtime.inspect) {
    detail.executions = await Promise.all(
      detail.executions.map(async (execution) => {
        if (
          execution.status !== "running" ||
          execution.memberSnapshot.runtime === "zcode" ||
          !execution.taskId
        )
          return execution;
        try {
          const view = await runtime.inspect!(execution.workspaceBinding, execution.taskId);
          return view.permission ? { ...execution, permission: view.permission } : execution;
        } catch {
          return execution;
        }
      }),
    );
  }
  return detail;
}
