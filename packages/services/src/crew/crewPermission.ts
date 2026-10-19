import {
  crewPermissionParamsSchema,
  type CrewPermissionParams,
  type CrewCancelParams,
  type CrewExecution,
} from "@zcode/shared";
import type { CrewRuntimePort } from "./contract.js";
import type { CrewStore } from "./crewStore.js";

/**
 * 群组成员以 yolo 模式派工，常规工具调用不再弹确认（见 crewRuntime 的 createSession）。
 * 这条入口留给仍会升级到人工的少数情况（工具自报 alwaysAsk 等 yolo 也压不过的 gate）。
 */
export async function respondCrewPermission(
  store: CrewStore,
  runtime: CrewRuntimePort,
  params: CrewPermissionParams,
  cancel: (params: CrewCancelParams) => Promise<CrewExecution>,
): Promise<CrewExecution> {
  const input = crewPermissionParamsSchema.parse(params);
  const execution = store.execution(input.executionId);
  const conversation = store.conversation(input.groupId, input.conversationId);
  if (
    execution.groupId !== input.groupId ||
    execution.conversationId !== conversation.conversationId ||
    execution.status !== "running" ||
    !execution.taskId
  )
    throw new Error("crew.permissionNotFound");
  if (!runtime.inspect || !runtime.respondPermission) throw new Error("crew.permissionUnsupported");
  const view = await runtime.inspect(execution.workspaceBinding, execution.taskId);
  if (view.permission?.requestId !== input.requestId) throw new Error("crew.permissionNotFound");
  if (!input.approved)
    return cancel({
      groupId: input.groupId,
      conversationId: execution.conversationId,
      executionId: input.executionId,
    });
  if (!view.permission.canRespond) throw new Error("crew.permissionUnsupported");
  await runtime.respondPermission(
    execution.workspaceBinding,
    execution.taskId,
    input.requestId,
    true,
  );
  return store.execution(input.executionId);
}
