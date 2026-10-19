import * as React from "react";

import { cn } from "../lib/utils.js";
import { Input, type InputProps } from "./input.js";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./command.js";
import { Popover, PopoverAnchor, PopoverContent } from "./popover.js";

interface EditableComboboxProps extends Omit<InputProps, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  /** 候选项；为空时组件退化成普通 Input，不弹浮层。 */
  options: readonly string[];
  /** 浮层内候选为空时的文案（例如「没有匹配的模型」）。 */
  emptyLabel?: string;
  /** 浮层宽度跟随输入框；关掉后用 PopoverContent 自己的宽度。 */
  matchAnchorWidth?: boolean;
  popoverClassName?: string;
}

/**
 * 可自由输入 + 可搜索候选的组合框。
 *
 * 与 `RemoteConnectionFields` 里那种"按钮触发浮层"的纯选择型 combobox 不同：
 * 这里输入框本身始终可打字，候选只是建议。模型 ID 必须允许填上游没返回的值
 * （自建网关、刚上线的模型、拉取失败时），所以不能强制从列表里挑。
 *
 * cmdk 用 `shouldFilter={false}` + 自己过滤：它的内建过滤要配 CommandInput 才生效，
 * 而我们的输入框在浮层外面，交给 cmdk 会变成两个输入源互相打架。
 */
const EditableCombobox = React.forwardRef<HTMLInputElement, EditableComboboxProps>(
  function EditableCombobox(
    {
      value,
      onValueChange,
      options,
      emptyLabel,
      matchAnchorWidth = true,
      popoverClassName,
      className,
      onFocus,
      onKeyDown,
      disabled,
      readOnly,
      ...inputProps
    },
    ref,
  ) {
    const [open, setOpen] = React.useState(false);
    const canSuggest = options.length > 0 && !disabled && !readOnly;

    const filtered = React.useMemo(() => {
      const keyword = value.trim().toLowerCase();
      if (!keyword) return options;
      return options.filter((option) => option.toLowerCase().includes(keyword));
    }, [options, value]);

    const commit = (option: string) => {
      onValueChange(option);
      setOpen(false);
    };

    return (
      <Popover open={open && canSuggest} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            ref={ref}
            value={value}
            disabled={disabled}
            readOnly={readOnly}
            role="combobox"
            aria-expanded={open && canSuggest}
            aria-autocomplete="list"
            className={className}
            onChange={(event) => {
              onValueChange(event.target.value);
              if (canSuggest) setOpen(true);
            }}
            onFocus={(event) => {
              if (canSuggest) setOpen(true);
              onFocus?.(event);
            }}
            onKeyDown={(event) => {
              // Escape 只收浮层，不该冒泡去关外层对话框。
              if (event.key === "Escape" && open) {
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "ArrowDown" && !open && canSuggest) {
                event.preventDefault();
                setOpen(true);
              }
              onKeyDown?.(event);
            }}
            {...inputProps}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className={cn(
            "gap-0 bg-menu p-0",
            matchAnchorWidth && "w-[var(--radix-popover-trigger-width)]",
            popoverClassName,
          )}
          // 焦点必须留在输入框里，否则边打字边看候选就断了。
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <Command shouldFilter={false} className="bg-transparent p-0 text-foreground">
            <CommandList className="max-h-60 overscroll-contain">
              {filtered.length === 0 && emptyLabel ? (
                <CommandEmpty className="px-4 py-5 text-foreground-subtle">
                  {emptyLabel}
                </CommandEmpty>
              ) : null}
              <CommandGroup className="p-1">
                {filtered.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    data-checked={option === value ? "true" : undefined}
                    className="min-h-8 cursor-pointer px-2 font-mono text-ui-base"
                    onSelect={() => commit(option)}
                  >
                    <span className="truncate">{option}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  },
);

export { EditableCombobox, type EditableComboboxProps };
