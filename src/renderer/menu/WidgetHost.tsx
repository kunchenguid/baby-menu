import { useEffect, useState } from "react";
import type { RefreshableBabyMenuWidget } from "../../shared/contracts";
import { helloWorldWidget } from "../../../extensions/hello-world/widget";
import { importRuntimeModule, loadExtensionModules, type RuntimeModuleImporter } from "../extension-modules";
import { useViewRefresh } from "./useViewRefresh";

export type RuntimeWidgetImporter = RuntimeModuleImporter;

const DEFAULT_RUNTIME_REFRESH_INTERVAL_MS = 1000;

function WidgetCard({ widget }: { widget: RefreshableBabyMenuWidget }) {
  // Drives automatic refresh only: once each time the popover opens, plus the
  // optional interval while visible. There is no manual refresh control.
  useViewRefresh({
    id: widget.id,
    viewRefreshIntervalMs: widget.viewRefreshIntervalMs,
    refreshView: widget.refreshView ?? (() => undefined),
  });

  return (
    <article className="widget">
      <header className="w-head">
        <h3 className="key">{widget.title}</h3>
      </header>
      <div>{widget.render()}</div>
    </article>
  );
}

type WidgetHostProps = {
  widgets?: RefreshableBabyMenuWidget[];
  runtimeImporter?: RuntimeWidgetImporter;
  runtimeRefreshIntervalMs?: number;
};

export function WidgetHost({ widgets, runtimeImporter, runtimeRefreshIntervalMs }: WidgetHostProps) {
  const runtimeWidgets = useRuntimeWidgets({
    enabled: widgets === undefined,
    importer: runtimeImporter,
    refreshIntervalMs: runtimeRefreshIntervalMs,
  });
  const visibleWidgets = widgets ?? (runtimeWidgets.length > 0 ? runtimeWidgets : [helloWorldWidget]);

  return (
    <div className="widget-host">
      {visibleWidgets.map((widget) => (
        <WidgetCard key={widget.id} widget={widget} />
      ))}
    </div>
  );
}

function useRuntimeWidgets({
  enabled,
  importer = importRuntimeModule,
  refreshIntervalMs = DEFAULT_RUNTIME_REFRESH_INTERVAL_MS,
}: {
  enabled: boolean;
  importer?: RuntimeWidgetImporter;
  refreshIntervalMs?: number;
}) {
  const [widgets, setWidgets] = useState<RefreshableBabyMenuWidget[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function refresh() {
      const loadedWidgets = await loadRuntimeWidgets(importer);
      if (!cancelled) setWidgets(loadedWidgets);
    }

    void refresh();
    if (!refreshIntervalMs || refreshIntervalMs <= 0) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, importer, refreshIntervalMs]);

  return widgets;
}

export async function loadRuntimeWidgets(importer: RuntimeWidgetImporter = importRuntimeModule) {
  const modules = await loadExtensionModules(importer);
  return modules.flatMap(widgetsFromModule);
}

export function widgetsFromModule(module: unknown): RefreshableBabyMenuWidget[] {
  if (!module || typeof module !== "object") return [];
  const exports = Object.values(module as Record<string, unknown>);
  return exports.filter(isRefreshableBabyMenuWidget);
}

function isRefreshableBabyMenuWidget(value: unknown): value is RefreshableBabyMenuWidget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RefreshableBabyMenuWidget>;
  const hasRefresh = typeof candidate.refreshView === "function";
  const hasInvalidRefresh = candidate.refreshView !== undefined && !hasRefresh;
  const hasInvalidInterval = candidate.viewRefreshIntervalMs !== undefined && !hasRefresh;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.render === "function" &&
    !hasInvalidRefresh &&
    !hasInvalidInterval
  );
}
