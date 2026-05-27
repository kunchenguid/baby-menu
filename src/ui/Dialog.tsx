import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-void/70" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-bm-overlay=""
        // Sized to live inside the small tray window: never wider/taller than
        // the popover, with internal scroll for overflow.
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-line bg-surface font-mono text-sm text-ink shadow-2xl",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          aria-label="close"
          className="absolute right-3 top-3 text-ink-soft outline-none transition-colors hover:text-ink-strong focus-visible:text-ink-strong"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("px-4 pt-4 pr-9 text-md text-ink-strong", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("px-4 pt-1 text-sm text-ink-muted", className)}
      {...props}
    />
  );
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-body" className={cn("overflow-y-auto px-4 py-3", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex justify-end gap-2 border-t border-line-faint px-4 py-3", className)}
      {...props}
    />
  );
}
