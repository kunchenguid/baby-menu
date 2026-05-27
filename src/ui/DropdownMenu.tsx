import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "./lib/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({ className, ...props }: DropdownMenuPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        data-bm-overlay=""
        sideOffset={4}
        className={cn(
          "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-40 overflow-y-auto rounded-sm border border-line bg-surface p-1 font-mono text-sm text-ink shadow-lg",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: DropdownMenuPrimitive.DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-default items-center rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-pressed data-[highlighted]:text-ink-strong",
        className,
      )}
      {...props}
    />
  );
}
