import type { ComponentProps } from "react";
import { cn } from "./lib/cn";

// A quiet grouping surface. Tray widgets usually do not need their own card
// (the host owns the outer chrome); use this for nested grouping inside a widget.
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn("rounded-md border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex items-center justify-between border-b border-line-faint px-3 py-2", className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-body" className={cn("px-3 py-2.5", className)} {...props} />;
}
