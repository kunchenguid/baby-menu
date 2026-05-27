import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm font-mono tracking-tight outline-none transition-colors focus-visible:ring-1 focus-visible:ring-signal-live disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      // Monochrome Lab: emphasis comes from inversion, not color. Mint stays a
      // signal; coral is reserved for destructive intent.
      variant: {
        default: "border border-line bg-elevated text-ink hover:bg-pressed",
        primary: "bg-ink-strong text-stage hover:bg-ink",
        ghost: "text-ink-muted hover:bg-pressed hover:text-ink",
        danger: "border border-line text-signal-danger hover:bg-pressed",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-sm",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} data-slot="button" className={cn(button({ variant, size }), className)} {...props} />;
}
