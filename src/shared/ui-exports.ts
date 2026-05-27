/**
 * The public surface of the @babymenu/ui design system.
 *
 * This is the stability contract for extension widgets, treated with the same
 * care as the preload bridge: removing or renaming an entry can break already
 * installed widgets. The host re-export shim (widget-protocol.ts) is generated
 * from this list, and a test asserts it stays in sync with the src/ui barrel,
 * so the three can never drift apart.
 */
export const UI_EXPORT_NAMES = [
  "cn",
  "Badge",
  "Button",
  "Card",
  "CardBody",
  "CardHeader",
  "DataTable",
  "Dialog",
  "DialogBody",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogTitle",
  "DialogTrigger",
  "DropdownMenu",
  "DropdownMenuContent",
  "DropdownMenuItem",
  "DropdownMenuTrigger",
  "Field",
  "Input",
  "Progress",
  "Select",
  "SelectContent",
  "SelectItem",
  "SelectTrigger",
  "SelectValue",
  "Skeleton",
  "Sparkline",
  "StatusDot",
  "Switch",
  "Tabs",
  "TabsContent",
  "TabsList",
  "TabsTrigger",
  "Textarea",
  "Tooltip",
] as const;

export type UiExportName = (typeof UI_EXPORT_NAMES)[number];
