import { ServiceChannels } from "@zcode/shared";
import type {
  CrewExecutionDetail,
  CrewExecutionDetailParams,
  CrewConversation,
  CrewConversationListParams,
  CrewConversationCreateParams,
  CrewConversationDeleteParams,
  CrewPermissionParams,
  CrewRelayParams,
  CrewRuntimeProbe,
  CrewRuntimeTask,
  CrewBindParams,
  CrewCancelParams,
  CrewCreateParams,
  CrewDeleteParams,
  CrewDuplicateParams,
  CrewExecution,
  CrewGetParams,
  CrewGroup,
  CrewGroupDetail,
  CrewListParams,
  CrewResolvedMember,
  CrewMessage,
  CrewRecoverParams,
  CrewSendParams,
  CrewSendResult,
  CrewUpdateParams,
  CrewWorkspaceBinding,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ICrewService {
  /** 交接决定走同一持久化准入路径；不重放执行、也不替代runtime权限批准。 */
  respondRelay(params: CrewRelayParams): Promise<CrewExecution>;
  readExecution(params: CrewExecutionDetailParams): Promise<CrewExecutionDetail>;
  /** 对话复用成员与绑定，不复制工作历史。省略 ID 的旧调用固定使用默认对话。 */
  listConversations(params: CrewConversationListParams): Promise<CrewConversation[]>;
  createConversation(params: CrewConversationCreateParams): Promise<CrewConversation>;
  deleteConversation(params: CrewConversationDeleteParams): Promise<void>;
  list(params: CrewListParams): Promise<CrewGroup[]>;
  get(params: CrewGetParams): Promise<CrewGroupDetail>;
  create(params: CrewCreateParams): Promise<CrewGroup>;
  update(params: CrewUpdateParams): Promise<CrewGroup>;
  delete(params: CrewDeleteParams): Promise<void>;
  duplicate(params: CrewDuplicateParams): Promise<CrewGroup>;
  bind(params: CrewBindParams): Promise<CrewGroup>;
  send(params: CrewSendParams): Promise<CrewSendResult>;
  recover(params: CrewRecoverParams): Promise<CrewGroupDetail>;
  cancel(params: CrewCancelParams): Promise<CrewExecution>;
  respondPermission(params: CrewPermissionParams): Promise<CrewExecution>;
}
export const ICrewService = createServiceDescriptor<ICrewService>(ServiceChannels.Crew);

/**
 * 提交任何 runtime 输入前必须 await onTaskCreated；cancel 成功表示已证明安全停止。
 * crew.workspaceBusy 仅用于已明确拒绝、未发送输入的准入失败；未知 ACK/进程/存储错误
 * 使用 crew.recoveryRequired（未知异常同样隔离），不能以普通失败释放重绑限制。
 */
export interface CrewRuntimePort {
  preflight(binding: CrewWorkspaceBinding): Promise<void>;
  /** 人工确认恢复后的强制收口：清理 interrupted 准入 entry 与孤儿进程组。 */
  confirmRecovery?(binding: CrewWorkspaceBinding): Promise<void>;
  probeMember?(
    binding: CrewWorkspaceBinding,
    member: CrewResolvedMember,
  ): Promise<CrewRuntimeProbe | null>;
  inspect?(binding: CrewWorkspaceBinding, taskId: string): Promise<CrewRuntimeTask>;
  respondPermission?(
    binding: CrewWorkspaceBinding,
    taskId: string,
    requestId: string,
    approved: boolean,
  ): Promise<void>;
  /** 返回 text 必须是最终回复正文（外部 runtime 为最终结构化 summary），不是流式拼接。 */
  execute(input: {
    group: CrewGroup;
    member: CrewResolvedMember;
    execution: CrewExecution;
    /** 同会话同纪元、截止本次用户消息（含本次任务）的有界群板数据，不是角色指令。 */
    messages: CrewMessage[];
    /** 当前目录解析的可交接成员名；只作协议声明，不放入角色权限。 */
    relayMembers?: string[];
    onTaskCreated(taskId: string): Promise<void>;
    resumeTaskId?: string;
  }): Promise<{ taskId: string; text: string; status: "succeeded" | "failed" | "cancelled" }>;
  cancel(binding: CrewWorkspaceBinding, taskId: string): Promise<void>;
}
export interface CrewServiceOptions {
  databasePath?: string;
  ownerId: string;
  isOwnerAlive(ownerId: string): boolean | Promise<boolean>;
  runtime: CrewRuntimePort;
}
