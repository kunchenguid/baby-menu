import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "./lib/cn";

export type ProgressProps = ProgressPrimitive.ProgressProps & {
  // Tone of the fill. Mint by default (a signal); use warn/danger for alerts.
  tone?: "live" | "warn" | "danger";
};

const fillTone = {
  live: "bg-signal-live",
  warn: "bg-signal-warn",
  danger: "bg-signal-danger",
} as const;

// The 1px scanline progress track from the design language.
export function Progress({ className, value, tone = "live", ...props }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn("h-px w-full overflow-hidden bg-line", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("h-full transition-[width] duration-300", fillTone[tone])}
        style={{ width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
}
