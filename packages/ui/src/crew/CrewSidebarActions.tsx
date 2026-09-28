import { useRef, useState } from "react";
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { useCrewText } from "@/hooks/useCrewText.js";

export function CrewSidebarActions({
  name,
  disabled,
  locked,
  commandError,
  onCreate,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  name: string;
  disabled: boolean;
  locked: boolean;
  commandError: string | null;
  onCreate: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
}) {
  const t = useCrewText();
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-lg"
            className="size-9 rounded-lg sm:size-7"
            disabled={disabled}
            aria-label={t("home.actions", { name })}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={disabled} onSelect={() => void onCreate()}>
            <Plus aria-hidden="true" />
            {t("createConversation")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onSelect={() => void onDuplicate()}>
            <Copy aria-hidden="true" />
            {t("duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled || locked} onSelect={onEdit}>
            <Pencil aria-hidden="true" />
            {t("edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={disabled || locked}
            onSelect={() => setConfirming(true)}
          >
            <Trash2 aria-hidden="true" />
            {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription", { name })}</AlertDialogDescription>
          </AlertDialogHeader>
          {commandError && (
            <p role="alert" className="text-ui-sm text-destructive">
              {t(commandError)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabled}>{t("cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled || locked}
              onClick={async () => {
                // 删除失败保留确认框；错误由既有 command scope 展示，不误报成功或自动重试。
                if (await onDelete()) setConfirming(false);
              }}
            >
              {t("delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
