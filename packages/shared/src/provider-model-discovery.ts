import { z } from "zod";

/**
 * 「添加/编辑模型」对话框的模型发现契约。
 *
 * 与 `providerApiTypeDataSchema`（@zcode/provider）保持同样的取值，但这里重新声明而不是复用：
 * shared 不依赖 provider，反向引入会把配置 schema 的依赖方向倒过来。取值变化时两处同步。
 */
export const providerModelDiscoveryApiTypeSchema = z.enum([
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
]);

export const providerModelDiscoveryRequestSchema = z
  .object({
    apiType: providerModelDiscoveryApiTypeSchema,
    baseUrl: z.string().trim().min(1),
    /** 可缺省：部分自建网关不校验鉴权，没有 key 也能列模型。 */
    apiKey: z.string().trim().optional(),
  })
  .strict();

/**
 * 失败用 result 对象而不是抛异常：拉取失败后用户仍要能手填模型 ID，
 * 异常会把整个表单打断，与「失败就让用户填写」的产品决策相悖。
 */
export const providerModelDiscoveryResultSchema = z.union([
  z.object({ success: z.literal(true), models: z.array(z.string()) }).strict(),
  z
    .object({
      success: z.literal(false),
      error: z.object({ message: z.string() }).strict(),
    })
    .strict(),
]);

export type ProviderModelDiscoveryApiType = z.infer<typeof providerModelDiscoveryApiTypeSchema>;
export type ProviderModelDiscoveryRequest = z.infer<typeof providerModelDiscoveryRequestSchema>;
export type ProviderModelDiscoveryResult = z.infer<typeof providerModelDiscoveryResultSchema>;
