import { useState } from "react";
import type { ProviderModelDiscoveryApiType } from "@zcode/shared";
import { toast } from "@/components/ui/toast.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export interface ProviderModelDiscoveryTarget {
  apiType: ProviderModelDiscoveryApiType;
  baseUrl: string;
  apiKey?: string;
}

/**
 * 「获取模型」按钮的状态与拉取动作。
 *
 * 候选列表只活在调用方这次挂载期间（对话框关闭即随组件卸载丢弃），所以不做跨对话框缓存：
 * baseUrl / apiKey 改动后再打开必须重新拉，否则会拿到改动前的过期列表。
 */
export function useProviderModelDiscovery(target: ProviderModelDiscoveryTarget | undefined) {
  const { intl } = useZCodeIntl();
  const { providerSettingsService } = useServices();
  const [models, setModels] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);

  const fetchModels = async () => {
    if (!target || pending) return;
    const baseUrl = target.baseUrl.trim();
    if (!baseUrl) {
      toast(intl.formatMessage({ id: "settings.modelProvider.fetchModelsNeedBaseUrl" }));
      return;
    }
    setPending(true);
    try {
      const result = await providerSettingsService.discoverModels({
        apiType: target.apiType,
        baseUrl,
        ...(target.apiKey?.trim() ? { apiKey: target.apiKey.trim() } : {}),
      });
      if (result.success) {
        setModels(result.models);
        toast(
          intl.formatMessage(
            { id: "settings.modelProvider.fetchModelsSuccess" },
            { count: result.models.length },
          ),
        );
        return;
      }
      // 失败不清空已有候选，也不锁输入框：用户仍要能手填模型 ID。
      toast(
        intl.formatMessage(
          { id: "settings.modelProvider.fetchModelsFailed" },
          { message: result.error.message },
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return { models, pending, fetchModels };
}
