import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: SelectPrimitive.SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-sm border border-line bg-elevated px-3 py-1.5 font-mono text-sm text-ink outline-none focus-visible:border-signal-live data-[placeholder]:text-ink-soft",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="size-3.5 text-ink-soft" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ className, children, ...props }: SelectPrimitive.SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-bm-overlay=""
        position="popper"
        sideOffset={4}
        // Cap to the space Radix measured against the viewport (the popover
        // window) and scroll internally, so the list can never exceed bounds.
        className={cn(
          "z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-y-auto rounded-sm border border-line bg-surface p-1 font-mono text-sm text-ink shadow-lg",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: SelectPrimitive.SelectItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-default items-center justify-between rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-pressed data-[highlighted]:text-ink-strong",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-signal-live" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
