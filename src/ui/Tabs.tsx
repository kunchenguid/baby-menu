import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex items-center gap-4 border-b border-line-faint", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "-mb-px border-b border-transparent pb-1.5 font-mono text-xs uppercase tracking-caps text-ink-soft outline-none transition-colors hover:text-ink-muted focus-visible:text-ink data-[state=active]:border-signal-live data-[state=active]:text-ink-strong",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("pt-3 outline-none", className)} {...props} />;
}
