import { z } from "zod";

export const crewRelaySettings = {
  relayMode: z.enum(["manual", "semi", "auto"]).optional(),
  relayAutoHops: z.number().int().min(0).max(8).optional(),
  relayBudgetMinutes: z.number().int().min(1).max(1440).optional(),
  relayPaused: z.boolean().optional(),
};

/** 协议只接受一个明确下一站；自由文本和多标签不形成并行队列。 */
// 宽松解析：模型（尤其外部 runtime）经常多写字段（note/reason/summary 等），
// strict 会整条拒绝并让链路静默中断——这是线上反复出现的断链根因。
// 必需字段仍严格校验类型与长度，未知字段直接丢弃；context 缺失按空串处理。
export const crewHandoffSchema = z.object({
  to: z.string().trim().min(1).max(200),
  objective: z.string().trim().min(1).max(16000),
  context: z.string().max(16000).default(""),
});
export const crewRelaySchema = crewHandoffSchema
  .extend({
    kind: z.enum(["plan", "handoff"]),
    status: z.enum(["awaiting_user_approval", "dispatched", "rejected", "blocked"]),
    toMemberId: z.string().trim().min(1).max(256).optional(),
    automatic: z.boolean().optional(),
    /** 持久化控制版本；暂停/恢复会使在途准入失效，UI不写此字段。 */
    admissionRevision: z.number().int().nonnegative().optional(),
    reason: z
      .enum([
        "relayHopLimit",
        "relayBudgetExceeded",
        "relayDuplicate",
        "relayRuntimeUnavailable",
        "relayRecoveryRequired",
        "relayBindingChanged",
        "relayMemberNotFound",
        "relayCancelled",
        "relayFailed",
      ])
      .optional(),
  })
  .strict();
export type CrewRelay = z.infer<typeof crewRelaySchema>;
export type CrewRelayMode = NonNullable<
  z.infer<z.ZodObject<typeof crewRelaySettings>>["relayMode"]
>;
export type CrewHandoff = z.infer<typeof crewHandoffSchema>;
