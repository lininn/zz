import { z } from "zod";
import { crewExecutionSchema, crewGetParamsSchema } from "./agent-crew.js";
import { crewRuntimeTaskSchema } from "./crew-external-runtime.js";

export const crewExecutionDetailParamsSchema = crewGetParamsSchema
  .extend({
    conversationId: z.string().min(1).max(128),
    executionId: z.string().min(1).max(128),
  })
  .strict();

/** 只读执行快照。当前外部桥仅暴露 task 投影，不能把摘要伪装成事件日志。 */
export const crewExecutionDetailSchema = z
  .object({
    execution: crewExecutionSchema,
    runtimeTask: crewRuntimeTaskSchema.nullable(),
    unavailableReason: z
      .enum(["taskNotCreated", "runtimeReadFailed", "externalEventsUnavailable"])
      .nullable(),
  })
  .strict();
export type CrewExecutionDetailParams = z.infer<typeof crewExecutionDetailParamsSchema>;
export type CrewExecutionDetail = z.infer<typeof crewExecutionDetailSchema>;
