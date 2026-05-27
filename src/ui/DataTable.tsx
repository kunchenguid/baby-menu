import type { ReactNode } from "react";
import { cn } from "./lib/cn";

export type DataTableColumn<Row> = {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  render?: (row: Row) => ReactNode;
};

export type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey?: (row: Row, index: number) => string | number;
  className?: string;
  empty?: ReactNode;
};

// A compact, scannable table for tray reports. Numbers right-align and use
// tabular figures; headers are quiet tracked-caps metadata.
export function DataTable<Row>({ columns, rows, getRowKey, className, empty = "no data" }: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <div className="py-3 text-center text-xs text-ink-soft">{empty}</div>;
  }

  return (
    <table data-slot="data-table" className={cn("w-full border-collapse font-mono text-sm tabular-nums", className)}>
      <thead>
        <tr className="border-b border-line">
          {columns.map((column) => (
            <th
              key={column.key}
              className={cn(
                "px-1.5 py-1 text-xxs font-normal uppercase tracking-caps text-ink-label",
                column.align === "right" ? "text-right" : "text-left",
              )}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={getRowKey?.(row, index) ?? index} className="border-b border-line-faint last:border-0">
            {columns.map((column) => (
              <td
                key={column.key}
                className={cn("px-1.5 py-1 text-ink", column.align === "right" ? "text-right" : "text-left")}
              >
                {column.render ? column.render(row) : (row as Record<string, ReactNode>)[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
