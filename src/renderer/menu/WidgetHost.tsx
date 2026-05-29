import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BabyMenuLayout, BabyMenuLayoutWidget, RefreshableBabyMenuWidget } from "../../shared/contracts";
import { helloWorldWidget } from "../../../extensions/hello-world/widget";
import {
  ensureWidgetStylesheet,
  importRuntimeModule,
  loadExtensionModules,
  type RuntimeModuleImporter,
} from "../extension-modules";
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

  // No host-drawn title: the extension owns its entire area.
  return <article className="widget">{widget.render()}</article>;
}

// The built-in layout: the historical stacked column, used whenever the
// workspace ships no `layout.tsx`. Keeps old extensions and the no-layout case
// rendering exactly as before.
function WidgetColumn({ widgets }: { widgets: RefreshableBabyMenuWidget[] }) {
  return (
    <div className="widget-host">
      {widgets.map((widget) => (
        <WidgetCard key={widget.id} widget={widget} />
      ))}
    </div>
  );
}

// Resets to the built-in column if the agent-authored layout throws while
// rendering, so a broken layout never blanks the popover. Clears the error when
// the layout module changes (e.g. the agent fixes it) so it can recover live.
class LayoutBoundary extends Component<
  { layout: BabyMenuLayout; fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prev: { layout: BabyMenuLayout }) {
    if (prev.layout !== this.props.layout && this.state.hasError) this.setState({ hasError: false });
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function WidgetCanvas({ layout, widgets }: { layout: BabyMenuLayout | null; widgets: RefreshableBabyMenuWidget[] }) {
  const byId = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget] as const)), [widgets]);
  const renderWidget = useCallback(
    (id: string): ReactNode => {
      const widget = byId.get(id);
      return widget ? <WidgetCard widget={widget} /> : null;
    },
    [byId],
  );

  if (!layout) return <WidgetColumn widgets={widgets} />;

  // The layout decides the arrangement and its own width; [data-bm-canvas] marks
  // it so the host measures that intrinsic width and resizes the popover to fit.
  const meta: BabyMenuLayoutWidget[] = widgets.map(({ id, title }) => ({ id, title }));
  const Layout = layout;
  return (
    <div className="widget-canvas" data-bm-canvas>
      <LayoutBoundary layout={layout} fallback={<WidgetColumn widgets={widgets} />}>
        <Layout widgets={meta} renderWidget={renderWidget} />
      </LayoutBoundary>
    </div>
  );
}

type WidgetHostProps = {
  widgets?: RefreshableBabyMenuWidget[];
  runtimeImporter?: RuntimeWidgetImporter;
  runtimeRefreshIntervalMs?: number;
  // Test/override hook: a custom layout component (or null for the built-in
  // column), bypassing runtime discovery. Undefined means discover at runtime.
  layout?: BabyMenuLayout | null;
  layoutImporter?: RuntimeModuleImporter;
};

export function WidgetHost({ widgets, runtimeImporter, runtimeRefreshIntervalMs, layout, layoutImporter }: WidgetHostProps) {
  const runtimeWidgets = useRuntimeWidgets({
    enabled: widgets === undefined,
    importer: runtimeImporter,
    refreshIntervalMs: runtimeRefreshIntervalMs,
  });
  const visibleWidgets = widgets ?? (runtimeWidgets.length > 0 ? runtimeWidgets : [helloWorldWidget]);

  const runtimeLayout = useRuntimeLayout({
    enabled: widgets === undefined && layout === undefined,
    importer: layoutImporter,
    refreshIntervalMs: runtimeRefreshIntervalMs,
  });
  const activeLayout = layout === undefined ? runtimeLayout : layout;

  return <WidgetCanvas layout={activeLayout} widgets={visibleWidgets} />;
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

// Polls for the root layout module on the same cadence as widget discovery, so
// editing `layout.tsx` hot-reloads the arrangement. Returns null when there is
// no layout module (the canvas then renders the built-in column).
function useRuntimeLayout({
  enabled,
  importer = importRuntimeModule,
  refreshIntervalMs = DEFAULT_RUNTIME_REFRESH_INTERVAL_MS,
}: {
  enabled: boolean;
  importer?: RuntimeModuleImporter;
  refreshIntervalMs?: number;
}) {
  const [layout, setLayout] = useState<BabyMenuLayout | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function refresh() {
      const loaded = await loadRuntimeLayout(importer);
      // setState updater form because the stored value is itself a function.
      if (!cancelled) setLayout(() => loaded);
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

  return layout;
}

export async function loadRuntimeWidgets(importer: RuntimeWidgetImporter = importRuntimeModule) {
  const modules = await loadExtensionModules(importer);
  return modules.flatMap(widgetsFromModule);
}

export async function loadRuntimeLayout(
  importer: RuntimeModuleImporter = importRuntimeModule,
): Promise<BabyMenuLayout | null> {
  try {
    // Optional-chain `layout` too: an older host bridge without it must degrade
    // to the built-in column, not throw an unhandled rejection.
    const descriptor = await window.babyMenu?.layout?.get?.();
    if (!descriptor) return null;
    if (descriptor.cssUrl) ensureWidgetStylesheet(descriptor.cssUrl);
    const module = await importer(descriptor.moduleUrl);
    const layout = layoutFromModule(module);
    if (!layout) console.warn("[baby-menu] layout.tsx has no default-export component; using the built-in column");
    return layout;
  } catch (error) {
    // A broken layout module must not blank the menu - fall back to the column,
    // but surface why so a failed custom layout is debuggable in dev.
    console.warn("[baby-menu] failed to load layout.tsx; using the built-in column", error);
    return null;
  }
}

export function layoutFromModule(module: unknown): BabyMenuLayout | null {
  if (!module || typeof module !== "object") return null;
  const candidate = (module as { default?: unknown }).default;
  return typeof candidate === "function" ? (candidate as BabyMenuLayout) : null;
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
