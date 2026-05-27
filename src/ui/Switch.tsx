import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "./lib/cn";

export function Switch({ className, ...props }: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-4 w-7 shrink-0 items-center rounded-pill border border-line bg-elevated outline-none transition-colors focus-visible:ring-1 focus-visible:ring-signal-live data-[state=checked]:border-signal-live/40 data-[state=checked]:bg-signal-live/15 disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none ml-0.5 size-3 rounded-full bg-ink-soft transition-transform data-[state=checked]:translate-x-3 data-[state=checked]:bg-signal-live data-[state=checked]:shadow-[0_0_6px_currentColor]" />
    </SwitchPrimitive.Root>
  );
}
