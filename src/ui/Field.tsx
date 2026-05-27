import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";
import { cn } from "./lib/cn";

const controlClass =
  "w-full rounded-sm border border-line bg-elevated px-2.5 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft focus-visible:border-signal-live disabled:opacity-40";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(controlClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(controlClass, "resize-y", className)} {...props} />;
}

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactElement<{ id?: string }>;
  className?: string;
};

// Wraps a single control with a tracked-caps label and optional hint, wiring
// label htmlFor to the control id (generated if the control has none).
export function Field({ label, hint, children, className }: FieldProps) {
  const generatedId = useId();
  const id = (isValidElement(children) && children.props.id) || generatedId;
  const control = isValidElement(children) ? cloneElement(children, { id }) : children;

  return (
    <div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xxs uppercase tracking-caps text-ink-label">
        {label}
      </label>
      {control}
      {hint ? <span className="text-xs text-ink-soft">{hint}</span> : null}
    </div>
  );
}
