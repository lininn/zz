import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen } from "lucide-react";
import type { CrewWorkspaceBinding } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Label } from "@/components/ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { DirectoryBrowser } from "@/DirectoryBrowser.js";
import { useCrewWorkspaceOptions } from "@/hooks/useCrewWorkspaceOptions.js";
import { useCrewText } from "@/hooks/useCrewText.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { crewBindingKey } from "./crewUiHelpers.js";

export function CrewWorkspaceField({
  value,
  disabled,
  allowUnbound = true,
  onChange,
}: {
  value: CrewWorkspaceBinding | null;
  disabled: boolean;
  allowUnbound?: boolean;
  onChange: (value: CrewWorkspaceBinding | null) => void;
}) {
  const t = useCrewText();
  const id = useId();
  // Bugfix：web 平台没有系统原生目录选择器（canSelectFilePath=false），
  // 原先「选择目录」按钮被 canSelectDirectory 门控后直接消失，用户只能手选
  // 已打开的 workspace。Web 复用服务端目录浏览组件（fileService.readdir），
  // 与 Electron 原生对话框并存：有原生能力走原生，没有则走 DirectoryBrowser。
  const { workspaces, canSelectDirectory, selectDirectory } = useCrewWorkspaceOptions();
  const services = useOptionalServices();
  const canBrowseServerDirectories = !canSelectDirectory && Boolean(services);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [error, setError] = useState(false);
  const options = [...workspaces];
  if (value && !options.some((item) => crewBindingKey(item) === crewBindingKey(value)))
    options.push(value);
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{t("workspace")}</Label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Select
          value={value ? crewBindingKey(value) : "unbound"}
          disabled={disabled}
          onValueChange={(key) => {
            // Radix 的隐藏原生 select 会在受控值变化时派发一次 change；下拉项只在展开时
            // 挂载，浏览器匹配不到 option 就把值置空并回传 ""。若把空 key 当作“未绑定”，
            // 刚从目录选择器选中的路径会被立刻清空，编辑器一直显示待绑定。
            if (key === "unbound") {
              if (allowUnbound) onChange(null);
              return;
            }
            const next = options.find((item) => crewBindingKey(item) === key);
            if (next) onChange(next);
          }}
        >
          <SelectTrigger id={id} className="min-w-0 flex-1">
            <SelectValue>{value ? value.workspacePath : t("status.unbound")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {allowUnbound && <SelectItem value="unbound">{t("status.unbound")}</SelectItem>}
            {options.map((binding) => (
              <SelectItem key={crewBindingKey(binding)} value={crewBindingKey(binding)}>
                <span className="break-all">
                  {binding.workspacePath}
                  {binding.workspaceIdentity ? ` · ${binding.workspaceIdentity}` : ""}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(canSelectDirectory || canBrowseServerDirectories) && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={async () => {
              if (canBrowseServerDirectories) {
                setBrowserOpen(true);
                return;
              }
              setError(false);
              try {
                const binding = await selectDirectory();
                if (binding) onChange(binding);
              } catch {
                setError(true);
              }
            }}
          >
            <FolderOpen className="size-4" />
            {t("chooseDirectory")}
          </Button>
        )}
      </div>
      {!canSelectDirectory && !canBrowseServerDirectories && options.length === 0 && (
        <p className="text-ui-caption text-muted-foreground">{t("workspaceRequired")}</p>
      )}
      {error && (
        <p role="alert" className="text-ui-caption text-destructive">
          {t("directoryError")}
        </p>
      )}
      {/* DirectoryBrowser 非 embedded 模式自带完整遮罩弹窗与确认 footer。
          Bugfix：本字段位于 CrewGroupEditor 的 <form> 内，DirectoryBrowser 内部
          也有 <form>（HTML 禁止嵌套表单），内层提交会冒泡成外层原生提交并整页
          刷新。用 portal 挂到 body，让弹层彻底脱离外层表单。 */}
      {browserOpen && services
        ? createPortal(
            <DirectoryBrowser
              services={services}
              onCancel={() => setBrowserOpen(false)}
              onSelect={(path) => {
                setBrowserOpen(false);
                setError(false);
                onChange({ workspacePath: path });
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
