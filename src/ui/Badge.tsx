import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./lib/cn";

const badge = cva(
  "inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 font-mono text-xxs uppercase tracking-caps",
  {
    variants: {
      tone: {
        neutral: "border-line text-ink-muted",
        live: "border-signal-live/30 text-signal-live",
        warn: "border-signal-warn/30 text-signal-warn",
        danger: "border-signal-danger/30 text-signal-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badge>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badge({ tone }), className)} {...props} />;
}

const dotTone = {
  live: "bg-signal-live shadow-[0_0_6px_currentColor] text-signal-live",
  warn: "bg-signal-warn shadow-[0_0_6px_currentColor] text-signal-warn",
  danger: "bg-signal-danger shadow-[0_0_6px_currentColor] text-signal-danger",
  muted: "bg-ink-soft",
} as const;

export type StatusDotProps = ComponentProps<"span"> & {
  tone?: keyof typeof dotTone;
  // Slowly fades the dot in and out to signal a live / breathing state.
  pulse?: boolean;
};

// The canonical Monochrome Lab signal: a small glowing dot. Pair with a terse
// uppercase status word next to it.
export function StatusDot({ className, tone = "live", pulse = false, ...props }: StatusDotProps) {
  return (
    <span
      data-slot="status-dot"
      aria-hidden="true"
      className={cn("inline-block size-1.5 rounded-full", dotTone[tone], pulse && "animate-pulse", className)}
      {...props}
    />
  );
}
