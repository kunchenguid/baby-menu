import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { RefreshableBabyMenuWidget } from "../../shared/contracts";
import { helloWorldWidget } from "../../../extensions/hello-world/widget";
import { Button } from "../../ui";
import { useViewRefresh } from "./useViewRefresh";

export type RuntimeWidgetImporter = (moduleUrl: string) => Promise<unknown>;

const DEFAULT_RUNTIME_REFRESH_INTERVAL_MS = 1000;

function WidgetCard({ widget }: { widget: RefreshableBabyMenuWidget }) {
  const { refreshNow } = useViewRefresh({
    id: widget.id,
    viewRefreshIntervalMs: widget.viewRefreshIntervalMs,
    refreshView: widget.refreshView ?? (() => undefined),
  });

  return (
    <article className="widget">
      <header className="w-head">
        <h3 className="key">{widget.title}</h3>
        <Button
          variant="ghost"
          size="sm"
          className="refresh -mr-1 px-1.5"
          onClick={refreshNow}
          aria-label={`refresh ${widget.title}`}
        >
          <RefreshCw className="size-3.5" />
        </Button>
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

  if (visibleWidgets.length === 0) {
    return (
      <div className="empty-state">
        <span className="top">› no widgets</span>
        <p>ask the agent to add one.</p>
        <span className="ex">try: battery · cpu temp · calendar</span>
      </div>
    );
  }

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
  importer = importRuntimeWidgetModule,
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

export async function loadRuntimeWidgets(importer: RuntimeWidgetImporter = importRuntimeWidgetModule) {
  const descriptors = await window.babyMenu?.widgets.list();
  if (!descriptors?.length) return [];

  const widgetGroups = await Promise.all(
    descriptors.map(async (descriptor) => {
      try {
        if (descriptor.cssUrl) ensureWidgetStylesheet(descriptor.cssUrl);
        return widgetsFromModule(await importer(descriptor.moduleUrl));
      } catch {
        return [];
      }
    }),
  );
  return widgetGroups.flat();
}

// Injects a compiled widget's Tailwind stylesheet (packaged mode only). Dev mode
// descriptors carry no cssUrl because utilities come from the global stylesheet.
function ensureWidgetStylesheet(href: string) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[data-baby-menu-widget-css="${CSS.escape(href)}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.babyMenuWidgetCss = href;
  document.head.appendChild(link);
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

function importRuntimeWidgetModule(moduleUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleUrl) as Promise<unknown>;
}
