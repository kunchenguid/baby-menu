// Public barrel for @babymenu/ui. The set of *value* names exported here is the
// stability contract in src/shared/ui-exports.ts (a test keeps them in sync, and
// the host re-export shim is generated from it). Type-only exports are erased and
// do not count toward the runtime surface.
export { cn } from "./lib/cn";

export { Badge, StatusDot } from "./Badge";
export type { BadgeProps, StatusDotProps } from "./Badge";

export { Button } from "./Button";
export type { ButtonProps } from "./Button";

export { Card, CardBody, CardHeader } from "./Card";

export { DataTable } from "./DataTable";
export type { DataTableColumn, DataTableProps } from "./DataTable";

export {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./DropdownMenu";

export { Field, Input, Textarea } from "./Field";
export type { FieldProps } from "./Field";

export { Progress } from "./Progress";
export type { ProgressProps } from "./Progress";

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

export { Skeleton } from "./Skeleton";

export { Sparkline } from "./Sparkline";
export type { SparklineProps } from "./Sparkline";

export { Switch } from "./Switch";

export { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

export { Tooltip } from "./Tooltip";
export type { TooltipProps } from "./Tooltip";
