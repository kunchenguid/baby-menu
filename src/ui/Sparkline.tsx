import { useId } from "react";

export type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  tone?: "live" | "ink";
  className?: string;
  // Fill the area under the line with a faint gradient.
  area?: boolean;
};

const stroke = {
  live: "var(--color-signal-live)",
  ink: "var(--color-ink-muted)",
} as const;

// Dependency-free SVG sparkline. Charts in a tray should be small and quiet;
// this avoids pulling a charting library into the host bundle.
export function Sparkline({ data, width = 120, height = 28, tone = "live", className, area = false }: SparklineProps) {
  const gradientId = useId();
  if (data.length < 2) {
    return <svg data-slot="sparkline" width={width} height={height} className={className} aria-hidden="true" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((value, index) => {
    const x = index * stepX;
    const y = height - ((value - min) / span) * height;
    return [x, y] as const;
  });

  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPath = `${line} L${width.toFixed(2)},${height} L0,${height} Z`;

  return (
    <svg
      data-slot="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke[tone]} stopOpacity="0.25" />
              <stop offset="100%" stopColor={stroke[tone]} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path d={line} fill="none" stroke={stroke[tone]} strokeWidth="1" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
