import type { CompositionEvent, KeyboardEvent } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { EditableCombobox } from "@/components/ui/editable-combobox.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";

/**
 * 模型 ID 字段：可自由输入，拉取成功后附带可搜索候选。
 *
 * 候选只是建议——自建网关、刚上线的模型、拉取失败时都必须能手填，所以这里用
 * EditableCombobox 而不是受限的 Select。
 */
export function ProviderModelIdField({
  value,
  readOnly,
  autoFocus,
  options,
  discovering,
  canFetch,
  saving,
  onValueChange,
  onFetchModels,
  onBlur,
  onCompositionStart,
  onCompositionEnd,
  onKeyDown,
}: {
  value: string;
  readOnly: boolean;
  autoFocus: boolean;
  options: readonly string[];
  discovering: boolean;
  canFetch: boolean;
  saving: boolean;
  onValueChange: (value: string) => void;
  onFetchModels: () => void;
  onBlur?: () => void;
  onCompositionStart: (event: CompositionEvent<HTMLInputElement>) => void;
  onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <label className="block text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "settings.modelProvider.modelId" })}
        </label>
        {canFetch && !readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 shrink-0 gap-1.5 px-2"
            disabled={discovering || saving}
            onClick={onFetchModels}
          >
            {discovering ? (
              <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
            ) : null}
            {intl.formatMessage({
              id: discovering
                ? "settings.modelProvider.fetchModelsPending"
                : "settings.modelProvider.fetchModels",
            })}
          </Button>
        ) : null}
      </div>
      <EditableCombobox
        {...TECHNICAL_INPUT_ATTRIBUTES}
        type="text"
        autoFocus={autoFocus}
        size="lg"
        className={cn("font-mono", modelEditorControlStyle(false))}
        readOnly={readOnly}
        value={value}
        options={options}
        emptyLabel={intl.formatMessage({ id: "settings.modelProvider.fetchModelsEmpty" })}
        placeholder={intl.formatMessage({ id: "settings.modelProvider.modelId" })}
        onValueChange={onValueChange}
        onBlur={onBlur}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
