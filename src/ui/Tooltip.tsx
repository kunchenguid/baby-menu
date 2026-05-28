import type { ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./lib/cn";

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  side?: TooltipPrimitive.TooltipContentProps["side"];
  defaultOpen?: boolean;
};

// Self-contained tooltip: wraps a trigger and shows quiet help text. Provider is
// included so widgets do not need to mount one. Unlike Dialog/Select/Dropdown,
// the content is intentionally NOT marked data-bm-overlay: a tooltip is a small
// positioned hint and must not make the popover grow to the full overlay height.
export function Tooltip({ content, children, className, side = "top", defaultOpen }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root defaultOpen={defaultOpen}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            data-slot="tooltip-content"
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 max-w-48 rounded-sm border border-line bg-surface px-2 py-1 font-mono text-xs text-ink-muted shadow-lg",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
