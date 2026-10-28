import { foregroundErrorKind } from "../lib/foregroundRequest.js";

const CREW_ERROR_KEYS = new Set([
  "absolutePathRequired",
  "directoryRequired",
  "identityMismatch",
  "remoteUnavailable",
  "workspaceBusy",
  "groupBusy",
  "workspaceUnbound",
  "bindingChanged",
  "memberNotFound",
  "agentInUse",
  "agentNotFound",
  "duplicateAgentId",
  "multipleManagers",
  "builtinAgentLocked",
  "permissionEscalation",
  "capabilitiesUnsupported",
  "duplicateMemberId",
  "messageConflict",
  "groupNotFound",
  "conversationNotFound",
  "executionNotFound",
  "taskNotReady",
  "recoveryRequired",
  "serviceClosed",
  "cancelled",
  "runtimeUnavailable",
  "permissionUnsupported",
  "permissionNotFound",
  "externalFailed",
  "promptTooLarge",
  "relayNotFound",
  "relayDecisionConflict",
  "relayHopLimit",
  "relayBudgetExceeded",
  "relayDuplicate",
  "relayRuntimeUnavailable",
  "relayRecoveryRequired",
  "relayBindingChanged",
  "relayMemberNotFound",
  "relayCancelled",
  "relayFailed",
]);

/** 项目归属类拒绝：群组只绑目录，远端持库宿主强制要求唯一项目主目录。 */
const PROJECT_ERROR_KEYS: Record<string, string> = {
  "remote-project-required": "projectRootRequired",
  "cwd-not-in-roots": "projectCwdNotInRoots",
  "remote-single-root-required": "projectSingleRootRequired",
};

/** 只显示已本地化的协议错误，不向 UI 泄露路径、底层异常或凭据原文。 */
export function crewErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const key = message.startsWith("crew.") ? message.slice(5) : "";
  if (CREW_ERROR_KEYS.has(key)) return `error.${key}`;
  // 派工被项目归属拒时 message 是 project.* 键（见 crewService 的终态分类），
  // 原样渲染会把内部键直接暴露在对话气泡里，这里映射成可执行提示。
  const projectKey = message.startsWith("project.") ? PROJECT_ERROR_KEYS[message.slice(8)] : "";
  if (projectKey) return `error.${projectKey}`;

  // 连接已关闭时旧 accessor 不会因“重试”而重连；写入超时/断线的结果也不能视为未提交。
  switch (foregroundErrorKind(error)) {
    case "authentication":
      return "authentication";
    case "permission":
      return "accessDenied";
    case "closed":
      return "connectionClosed";
    case "timeout":
      return "commandTimeout";
    case "unavailable":
      return "connectionUnavailable";
    default:
      return "commandError";
  }
}
