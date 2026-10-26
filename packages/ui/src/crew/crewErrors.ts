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

/** 只显示已本地化的协议错误，不向 UI 泄露路径、底层异常或凭据原文。 */
export function crewErrorKey(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const key = message.startsWith("crew.") ? message.slice(5) : "";
  if (CREW_ERROR_KEYS.has(key)) return `error.${key}`;
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
