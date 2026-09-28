import {
  crewPermissionParamsSchema,
  type CrewPermissionParams,
  type CrewCancelParams,
  type CrewExecution,
} from "@zcode/shared";
import type { CrewRuntimePort } from "./contract.js";
import type { CrewStore } from "./crewStore.js";

/** 权限仍需现有人为批准；接力模式不会改变此入口。 */
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
