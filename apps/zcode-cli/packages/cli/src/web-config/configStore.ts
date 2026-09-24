import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createNodePersonalProviderConfigRepository,
  decodeProviderConfigFile,
  PERSONAL_PROVIDER_CONFIG_FILE_NAME,
  ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
} from "@zcode/provider-node";
import {
  ModelConfig,
  ModelConfigRules,
  parsePersonalProviderConfigMap,
  type ModelConfigRule,
  type ModelSelection,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";

// ── Web UI 数据合同 ──

export type ApiType = "anthropic-messages" | "openai-chat-completions" | "openai-responses";

export interface WebModel {
  modelId: string;
  enabled: boolean;
  supportsImage: boolean;
  supportsVideo: boolean;
  supportsPdf: boolean;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface WebProvider {
  providerId: string;
  providerName: string;
  enabled: boolean;
  apiType: ApiType;
  baseUrl: string;
  apiKey: string;
  models: WebModel[];
}

export interface WebConfig {
  providers: WebProvider[];
  defaultModelSelection?: { providerId: string; modelId: string } | null;
}

const API_TYPES: readonly ApiType[] = [
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
];

export function isApiType(value: unknown): value is ApiType {
  return typeof value === "string" && (API_TYPES as readonly string[]).includes(value);
}

// ── 路径 ──

function resolvePersonalConfigPath(): string {
  const explicit = process.env[ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]?.trim();
  if (explicit) return explicit;
  const dataBaseDir = process.env.ZCODE_DATA_BASE_DIR?.trim() || homedir();
  return join(dataBaseDir, ".zcode", "v2", PERSONAL_PROVIDER_CONFIG_FILE_NAME);
}

// ── 读取 ──

/** 只读取 Web UI 可管理的 Provider：无 templateId 且非 account:*。模板型/账号型保持原样。 */
export function readWebConfig(): WebConfig {
  const filePath = resolvePersonalConfigPath();
  try {
    if (!existsSync(filePath)) return { providers: [] };
    const decoded = decodeProviderConfigFile(JSON.parse(readFileSync(filePath, "utf-8")));

    const providers: WebProvider[] = [];
    for (const rule of decoded.providers.toJSON()) {
      if (rule.templateId != null) continue;
      if (rule.providerId.startsWith("account:")) continue;

      const apiType = isApiType(rule.config.api?.type) ? rule.config.api.type : "openai-chat-completions";
      const modelIds = rule.config.personalModelIds ?? [];

      const models: WebModel[] = modelIds.map((modelId) => {
        const exact = decoded.models.getExact(rule.providerId, modelId)?.toJSON();
        return {
          modelId,
          enabled: exact?.enabled !== false,
          supportsImage: exact?.properties?.inputFormat?.supportsImage === true,
          supportsVideo: exact?.properties?.inputFormat?.supportsVideo === true,
          supportsPdf: exact?.properties?.inputFormat?.supportsPdf === true,
          contextWindow: exact?.properties?.contextWindow ?? 0,
          maxOutputTokens: exact?.optionSpecs?.maxOutputTokens?.max ?? 0,
        };
      });

      providers.push({
        providerId: rule.providerId,
        providerName: rule.providerName ?? rule.providerId,
        enabled: rule.enabled !== false,
        apiType,
        baseUrl: rule.config.api?.baseUrl ?? "",
        apiKey:
          rule.config.access?.type === "api-key" ? (rule.config.access.apiKey ?? "") : "",
        models,
      });
    }

    const selection = decoded.defaultModelSelection;
    const defaultModelSelection =
      selection &&
      providers.some(
        (provider) =>
          provider.providerId === selection.providerId &&
          provider.models.some((model) => model.modelId === selection.modelId),
      )
        ? { providerId: selection.providerId, modelId: selection.modelId }
        : undefined;

    return { providers, ...(defaultModelSelection ? { defaultModelSelection } : {}) };
  } catch {
    // 文件损坏时按空配置降级展示，不阻断配置页；写入仍走 repository 的锁与校验。
    return { providers: [] };
  }
}

// ── 写入 ──

export class WebConfigValidationError extends Error {}

function assertProviderIdsUnique(providers: readonly WebProvider[]): void {
  const seen = new Set<string>();
  for (const provider of providers) {
    const id = provider.providerId.trim();
    if (!id) throw new WebConfigValidationError("providerId 不能为空");
    if (id.startsWith("account:")) {
      throw new WebConfigValidationError(`providerId 不能以 account: 开头: ${id}`);
    }
    if (seen.has(id)) throw new WebConfigValidationError(`重复的 providerId: ${id}`);
    seen.add(id);
  }
}

/** 无任何自定义时省略规则，让内置匹配规则继续提供默认值。 */
function modelNeedsRule(model: WebModel): boolean {
  return (
    !model.enabled ||
    model.contextWindow > 0 ||
    model.maxOutputTokens > 0 ||
    model.supportsImage ||
    model.supportsVideo ||
    model.supportsPdf
  );
}

function buildManagedModelRule(providerId: string, model: WebModel): ModelConfigRule {
  const data = {
    ...(model.enabled ? {} : { enabled: false }),
    properties: {
      ...(model.contextWindow > 0 ? { contextWindow: Math.floor(model.contextWindow) } : {}),
      ...(model.supportsImage || model.supportsVideo || model.supportsPdf
        ? {
            inputFormat: {
              ...(model.supportsImage ? { supportsImage: true } : {}),
              ...(model.supportsVideo ? { supportsVideo: true } : {}),
              ...(model.supportsPdf ? { supportsPdf: true } : {}),
            },
          }
        : {}),
    },
    ...(model.maxOutputTokens > 0
      ? { optionSpecs: { maxOutputTokens: { max: Math.floor(model.maxOutputTokens) } } }
      : {}),
  };
  return {
    type: "provider-model",
    providerId,
    modelId: model.modelId,
    config: ModelConfig.fromData(data),
  };
}

export async function writeWebConfig(config: WebConfig): Promise<void> {
  assertProviderIdsUnique(config.providers);
  for (const provider of config.providers) {
    const modelIds = new Set<string>();
    for (const model of provider.models) {
      const modelId = model.modelId.trim();
      if (!modelId) throw new WebConfigValidationError(`${provider.providerId} 存在空 modelId`);
      if (modelIds.has(modelId)) {
        throw new WebConfigValidationError(`${provider.providerId} 重复 modelId: ${modelId}`);
      }
      modelIds.add(modelId);
    }
  }

  const managedIds = new Set(config.providers.map((provider) => provider.providerId.trim()));
  const managedRules = config.providers.map((provider) => ({
    providerId: provider.providerId.trim(),
    ...(provider.providerName.trim() ? { providerName: provider.providerName.trim() } : {}),
    enabled: provider.enabled,
    config: {
      group: "standard-personal" as const,
      access: {
        type: "api-key" as const,
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      },
      api: {
        type: provider.apiType,
        ...(provider.baseUrl.trim() ? { baseUrl: provider.baseUrl.trim() } : {}),
      },
      personalModelIds: provider.models.map((model) => model.modelId.trim()),
    },
  }));

  const repository = createNodePersonalProviderConfigRepository({
    filePath: resolvePersonalConfigPath(),
  });
  try {
    await repository.update((current) => {
      // 模板型 / 账号型 Provider 及其模型规则原样保留，Web UI 不越权改写。
      const preservedProviderRules = current.providers
        .toJSON()
        .filter(
          (rule) => rule.templateId != null || rule.providerId.startsWith("account:"),
        );
      const providers = parsePersonalProviderConfigMap({
        providerRules: [...preservedProviderRules, ...managedRules],
      });

      // 只保留最终仍存在的 Provider 的模型规则，重命名/删除后的孤儿规则一并清理。
      const finalProviderIds = new Set(providers.keys());
      const survivingModelRules = current.models
        .rules()
        .filter(
          (rule) =>
            "providerId" in rule &&
            !managedIds.has(rule.providerId) &&
            finalProviderIds.has(rule.providerId),
        );

      const managedModelRules = config.providers.flatMap((provider) =>
        provider.models
          .filter((model) => modelNeedsRule(model))
          .map((model) => buildManagedModelRule(provider.providerId.trim(), model)),
      );
      const models = new ModelConfigRules([...survivingModelRules, ...managedModelRules]);

      const finalIds = finalProviderIds;
      const providerOrder = current.providerOrder?.filter((id) => finalIds.has(id));

      // 默认选择默认保留现状；UI 选中有效目标时才覆盖，避免误清模板型 Provider 的选择。
      let selection: ModelSelection | undefined = current.defaultModelSelection;
      if (
        selection &&
        managedIds.has(selection.providerId) &&
        !config.providers.some(
          (provider) =>
            provider.providerId.trim() === selection?.providerId &&
            provider.models.some((model) => model.modelId.trim() === selection?.modelId),
        )
      ) {
        selection = undefined;
      }
      const requested = config.defaultModelSelection;
      if (requested && managedIds.has(requested.providerId)) {
        const provider = config.providers.find(
          (candidate) => candidate.providerId.trim() === requested.providerId,
        );
        if (provider?.models.some((model) => model.modelId.trim() === requested.modelId)) {
          selection = {
            providerId: requested.providerId,
            modelId: requested.modelId,
          };
        }
      }

      const update: ProviderConfigLayerUpdate = {
        providers,
        models,
        ...(providerOrder === undefined ? {} : { providerOrder }),
        ...(selection === undefined ? {} : { defaultModelSelection: selection }),
      };
      return update;
    });
  } finally {
    repository.dispose();
  }
}
