import {
  providerModelDiscoveryRequestSchema,
  type ProviderModelDiscoveryRequest,
  type ProviderModelDiscoveryResult,
} from "@zcode/shared";

/** 上游 /models 可能很慢或不响应；不设上限会让「获取模型」按钮一直转。 */
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

/** 上游 /models 返回 { data: [{ id }] }；Anthropic 与 OpenAI 形式一致。 */
function extractModelIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  // 上游偶尔返回重复条目；候选列表里出现两条同名会让人以为选错了。
  return [...new Set(ids)];
}

function buildHeaders(
  apiType: ProviderModelDiscoveryRequest["apiType"],
  apiKey: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiType === "anthropic-messages") {
    if (apiKey) headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * 拉取 provider 上游的可用模型列表，供「添加/编辑模型」对话框做候选。
 *
 * 所有失败路径都收敛成 `{ success: false }`，绝不抛：调用方在拉取失败后仍要让用户
 * 手动填写模型 ID，异常会把表单打断。
 */
export async function discoverProviderModels(
  input: ProviderModelDiscoveryRequest,
  dependencies: { readonly fetch?: typeof fetch } = {},
): Promise<ProviderModelDiscoveryResult> {
  const parsed = providerModelDiscoveryRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: { message: "请求参数不合法：需要 apiType 与 baseUrl" } };
  }
  const { apiType, baseUrl, apiKey } = parsed.data;
  const doFetch = dependencies.fetch ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    return { success: false, error: { message: "当前运行环境不支持发起网络请求" } };
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    const upstream = await doFetch(endpoint, {
      method: "GET",
      headers: buildHeaders(apiType, apiKey),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return { success: false, error: { message: `上游返回 ${upstream.status}` } };
    }
    const models = extractModelIds(await upstream.json());
    if (models.length === 0) {
      return { success: false, error: { message: "上游未返回可识别的模型列表" } };
    }
    return { success: true, models };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, error: { message: "拉取模型超时，请检查请求地址是否可达" } };
    }
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  } finally {
    clearTimeout(timer);
  }
}
