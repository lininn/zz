import { z } from "zod";
import { crewRelaySchema, crewRelaySettings } from "./agent-crew-relay.js";
import {
  crewExternalRuntimeIdSchema,
  crewRuntimePermissionSchema,
  crewRuntimeProbeSchema,
} from "./crew-external-runtime.js";
import { modelSelectionSchema } from "./model-selection.js";

const id = z.string().trim().min(1).max(256);
const name = z.string().trim().min(1).max(200);
export const CREW_ANNOUNCEMENT_MAX_CHARS = 2000;
/** 首次初始化写入目录的内置管理者；每个群组最多引用一名管理者。 */
export const CREW_BUILTIN_MANAGER_AGENT_ID = "crew-builtin-manager";
export const CREW_BUILTIN_MANAGER_NAME = "管理者";
const announcement = z.string().trim().max(CREW_ANNOUNCEMENT_MAX_CHARS);
const runtime = z.union([z.literal("zcode"), crewExternalRuntimeIdSchema]);
const accessMode = z.enum(["read", "write"]);
const toolAllowlist = z.array(z.string().trim().min(1).max(200)).max(128);

/** 独立 catalog 定义；群成员只引用 agentId，不保存角色、模型或版本。 */
export const crewAgentInputSchema = z
  .object({
    name,
    systemPrompt: z.string().max(32000),
    runtime,
    accessMode,
    /** 缺省即非管理者；兼容没有该字段的历史定义。 */
    isManager: z.boolean().optional(),
    modelSelection: modelSelectionSchema.optional(),
    toolAllowlist: toolAllowlist.optional(),
  })
  .strict();
export const crewAgentSchema = crewAgentInputSchema.extend({
  agentId: id,
  configVersion: id,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export const crewAgentListParamsSchema = z.object({}).strict();
export const crewAgentGetParamsSchema = z.object({ agentId: id }).strict();
export const crewAgentCreateParamsSchema = crewAgentInputSchema;
export const crewAgentUpdateParamsSchema = crewAgentInputSchema.partial().extend({
  agentId: id,
  // JSON/RPC 会省略 undefined；显式 null 用于清除目录级可选配置。
  modelSelection: modelSelectionSchema.nullable().optional(),
  toolAllowlist: toolAllowlist.nullable().optional(),
});
export const crewAgentDeleteParamsSchema = crewAgentGetParamsSchema;

export const crewMemberSchema = z
  .object({
    memberId: id,
    agentId: id,
    accessMode: accessMode.optional(),
  })
  .strict();
export const crewMemberInputSchema = crewMemberSchema.extend({ memberId: id.optional() });
/** 派工时解析的审计快照/读取投影，保留 P1 runtime port 的 rolePrompt 字段。 */
export const crewResolvedMemberSchema = z
  .object({
    memberId: id,
    agentId: id,
    configVersion: id,
    name,
    rolePrompt: z.string().max(32000),
    runtime,
    accessMode,
    /** 仅管理者为 true；旧执行快照没有该字段时按非管理者处理。 */
    isManager: z.boolean().optional(),
    modelSelection: modelSelectionSchema.optional(),
    toolAllowlist: toolAllowlist.optional(),
  })
  .strict();
export const crewWorkspaceBindingSchema = z
  .object({
    workspacePath: z.string().min(1).max(4096),
    workspaceIdentity: z.string().trim().min(1).max(4096).optional(),
    remoteSessionId: id.optional(),
  })
  .strict();
export const crewExecutionStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "recovery_required",
]);
export const crewGroupSchema = z
  .object({
    ...crewRelaySettings,
    groupId: id,
    name,
    /** 每次派工都注入提示词的群级说明；不属于角色指令，也不参与权限判断。 */
    announcement: announcement.default(""),
    members: z.array(crewMemberSchema).max(32),
    workspaceBinding: crewWorkspaceBindingSchema.nullable(),
    epoch: z.number().int().nonnegative(),
    status: z.enum(["unbound", "idle", "active", "recovery_required"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
/** 群组共享团队配置，会话仅拥有独立任务历史；空名称由 UI 本地化展示。 */
export const crewConversationSchema = z
  .object({
    groupId: id,
    conversationId: id,
    name: z.string().trim().max(200),
    isDefault: z.boolean(),
    status: z.enum(["idle", "active", "recovery_required", "failed", "awaiting_user_approval"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export const crewConversationListParamsSchema = z.object({ groupId: id }).strict();
export const crewConversationCreateParamsSchema = crewConversationListParamsSchema
  .extend({ name: name.optional() })
  .strict();
export const crewConversationDeleteParamsSchema = z
  .object({ groupId: id, conversationId: id })
  .strict();
export const crewMessageSchema = z
  .object({
    groupId: id,
    conversationId: id,
    messageId: id,
    epoch: z.number().int().nonnegative(),
    sequence: z.number().int().positive(),
    sender: z.enum(["user", "member"]),
    /** event 是不可发言的状态行（审批/熔断等），不进入成员上下文。 */
    kind: z.enum(["chat", "event"]).default("chat"),
    memberId: id.nullable(),
    text: z.string().max(64000),
    mentions: z.array(id).max(1),
    executionId: id.nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
export const crewExecutionSchema = z
  .object({
    permission: crewRuntimePermissionSchema.optional(),
    rootRequestId: id.optional(),
    /** 根请求冻结的预算；群设置修改只影响新根。 */
    relayBudgetMinutes: z.number().int().min(1).max(1440).optional(),
    hop: z.number().int().min(0).max(8).optional(),
    relay: crewRelaySchema.optional(),
    executionId: id,
    groupId: id,
    conversationId: id,
    messageId: id,
    memberId: id,
    epoch: z.number().int().nonnegative(),
    status: crewExecutionStatusSchema,
    memberSnapshot: crewResolvedMemberSchema,
    workspaceBinding: crewWorkspaceBindingSchema,
    ownerId: id.nullable(),
    taskId: id.nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export const crewGroupDetailSchema = z
  .object({
    group: crewGroupSchema,
    conversation: crewConversationSchema,
    conversations: z.array(crewConversationSchema),
    resolvedMembers: z.array(crewResolvedMemberSchema).max(32),
    messages: z.array(crewMessageSchema),
    /** 审批/熔断等状态行；与聊天消息分开，避免污染成员上下文和消息计数。 */
    events: z.array(crewMessageSchema).optional(),
    executions: z.array(crewExecutionSchema),
    runtimeAvailability: z.array(crewRuntimeProbeSchema.extend({ memberId: id })).optional(),
  })
  .strict();
export const crewListParamsSchema = z.object({}).strict();
// 旧调用省略 ID 时固定使用默认会话，禁止解析成“最近/当前”会话。
export const crewGetParamsSchema = z
  .object({ groupId: id, conversationId: id.optional() })
  .strict();
export const crewCreateParamsSchema = z
  .object({
    ...crewRelaySettings,
    name,
    announcement: announcement.optional(),
    members: z.array(crewMemberInputSchema).max(32),
  })
  .strict();
export const crewUpdateParamsSchema = z
  .object({
    ...crewRelaySettings,
    groupId: id,
    name: name.optional(),
    announcement: announcement.optional(),
    members: z.array(crewMemberInputSchema).max(32).optional(),
  })
  .strict();
export const crewDeleteParamsSchema = crewConversationListParamsSchema;
export const crewDuplicateParamsSchema = z.object({ groupId: id, name: name.optional() }).strict();
export const crewBindParamsSchema = z
  .object({
    groupId: id,
    binding: crewWorkspaceBindingSchema,
  })
  .strict();
export const crewSendParamsSchema = z
  .object({
    groupId: id,
    conversationId: id.optional(),
    messageId: id,
    text: z.string().min(1).max(64000),
    mentions: z.array(id).max(1),
  })
  .strict();
// confirm=false（默认）仅探测归属：重启自动恢复保持未决等人工处理；
// confirm=true 表示用户在 UI 显式点「检查恢复」：死亡 owner 的未决执行被
// 安全放弃（cancelled，绝不重放），会话解锁；owner 存活时保持未决。
export const crewRecoverParamsSchema = crewGetParamsSchema.extend({
  confirm: z.boolean().optional(),
});
export const crewCancelParamsSchema = z
  .object({ groupId: id, conversationId: id.optional(), executionId: id })
  .strict();
export const crewSendResultSchema = z
  .object({
    message: crewMessageSchema,
    execution: crewExecutionSchema.nullable(),
  })
  .strict();

export type CrewAgent = z.infer<typeof crewAgentSchema>;
export type CrewAgentInput = z.infer<typeof crewAgentInputSchema>;
export type CrewAgentListParams = z.infer<typeof crewAgentListParamsSchema>;
export type CrewAgentGetParams = z.infer<typeof crewAgentGetParamsSchema>;
export type CrewAgentCreateParams = z.infer<typeof crewAgentCreateParamsSchema>;
export type CrewAgentUpdateParams = z.infer<typeof crewAgentUpdateParamsSchema>;
export type CrewAgentDeleteParams = z.infer<typeof crewAgentDeleteParamsSchema>;
export type CrewResolvedMember = z.infer<typeof crewResolvedMemberSchema>;
export type CrewMember = z.infer<typeof crewMemberSchema>;
export type CrewMemberInput = z.infer<typeof crewMemberInputSchema>;
export type CrewWorkspaceBinding = z.infer<typeof crewWorkspaceBindingSchema>;
export type CrewConversation = z.infer<typeof crewConversationSchema>;
export type CrewConversationListParams = z.infer<typeof crewConversationListParamsSchema>;
export type CrewConversationCreateParams = z.infer<typeof crewConversationCreateParamsSchema>;
export type CrewConversationDeleteParams = z.infer<typeof crewConversationDeleteParamsSchema>;
export type CrewGroup = z.infer<typeof crewGroupSchema>;
export type CrewMessage = z.infer<typeof crewMessageSchema>;
export type CrewExecution = z.infer<typeof crewExecutionSchema>;
export type CrewExecutionStatus = z.infer<typeof crewExecutionStatusSchema>;
export type CrewGroupDetail = z.infer<typeof crewGroupDetailSchema>;
export type CrewListParams = z.infer<typeof crewListParamsSchema>;
export type CrewGetParams = z.infer<typeof crewGetParamsSchema>;
export type CrewCreateParams = z.infer<typeof crewCreateParamsSchema>;
export type CrewUpdateParams = z.infer<typeof crewUpdateParamsSchema>;
export type CrewDeleteParams = z.infer<typeof crewDeleteParamsSchema>;
export type CrewDuplicateParams = z.infer<typeof crewDuplicateParamsSchema>;
export type CrewBindParams = z.infer<typeof crewBindParamsSchema>;
export type CrewSendParams = z.infer<typeof crewSendParamsSchema>;
export type CrewRecoverParams = z.infer<typeof crewRecoverParamsSchema>;
export type CrewCancelParams = z.infer<typeof crewCancelParamsSchema>;
export type CrewSendResult = z.infer<typeof crewSendResultSchema>;

export const crewPermissionParamsSchema = crewCancelParamsSchema
  .extend({ requestId: id, approved: z.boolean() })
  .strict();
export type CrewPermissionParams = z.infer<typeof crewPermissionParamsSchema>;

export const crewRelayParamsSchema = crewCancelParamsSchema
  .extend({ approved: z.boolean() })
  .strict();
export type CrewRelayParams = z.infer<typeof crewRelayParamsSchema>;
