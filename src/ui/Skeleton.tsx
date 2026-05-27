import type { ComponentProps } from "react";
import { cn } from "./lib/cn";

// A muted loading placeholder. Size it with width/height utilities.
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("animate-pulse rounded-sm bg-line-faint", className)}
      {...props}
    />
  );
}
