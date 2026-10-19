import * as React from "react";

import { cn } from "../lib/utils.js";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          // 可编辑性必须自证：实心 bg-input + input-border 与 Input 保持同一套 token。
          // 曾用 bg-input/20 让输入区透出页面底色，border-input 又解析到 --color-input（背景色）
          // 导致边框与填充同色，整个输入框看起来和静态文本无异。
          "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-input-border bg-input px-2 py-2 text-ui-base text-foreground transition-colors outline-none placeholder:text-foreground-subtlest hover:border-input-border-hover focus-visible:border-input-border-focused focus-visible:bg-input-focused focus-visible:ring-2 focus-visible:ring-input-border-focused/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-ui-base/relaxed",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
