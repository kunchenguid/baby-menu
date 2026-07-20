import { Progress, Skeleton, StatusDot } from "@babymenu/ui";
import type { KimiCredentialSource, KimiQuotaErrorCode, KimiQuotaResult, KimiQuotaWindow } from "@babymenu/contracts";
import { useKimiQuotaView, type KimiQuotaViewState } from "./store";

export function KimiQuotaView() {
  return <KimiQuotaContent view={useKimiQuotaView()} now={Date.now()} />;
}

export function KimiQuotaContent({ view, now }: { view: KimiQuotaViewState; now: number }) {
  if (!view.result) return <LoadingState />;
  const result = view.result;
  const snapshot = result.snapshot;
  if (!snapshot) return <FailureState result={result} now={now} />;

  const windows = orderedWindows(snapshot.windows);
  const status = snapshotStatus(result, view.refreshing);
  const lastSuccess = formatAge(snapshot.refreshedAt, now);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-kimi-quota-state={view.refreshing ? "refreshing" : result.status}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate text-xxs uppercase tracking-caps text-ink-label">Kimi Code</span>
        <span
          className={`flex shrink-0 items-center gap-1.5 text-xxs uppercase tracking-caps ${status.className}`}
          aria-label={view.refreshing ? "refreshing Kimi quota" : undefined}
          aria-live="polite"
        >
          <StatusDot tone={status.tone} pulse={status.pulse} />
          {status.label}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {windows.map((window, index) => (
          <QuotaWindowRow key={window.id} window={window} now={now} divided={index > 0} />
        ))}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 text-xxs text-ink-label">
        <span className="truncate">
          {result.stale ? `last success ${lastSuccess}` : `last sync ${lastSuccess}`}
          {result.retryAt ? ` · ${formatRetry(result.retryAt, now)}` : ""}
        </span>
        <span className="shrink-0 uppercase tracking-caps text-ink-soft">{result.source === "cache" ? "CACHE" : "API"}</span>
      </div>
    </div>
  );
}

function QuotaWindowRow({ window, now, divided }: { window: KimiQuotaWindow; now: number; divided: boolean }) {
  const label = windowLabel(window);
  const displayedPercent = Math.round(window.percentRemaining);
  return (
    <div
      className={`flex min-w-0 flex-col gap-2 ${divided ? "border-t border-line-faint pt-3" : ""}`}
      data-testid="kimi-quota-window"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="truncate text-xs uppercase tracking-caps text-ink-muted">{label}</span>
        <span className="shrink-0 text-xl font-light tracking-value text-ink-strong">
          {displayedPercent}<span className="ml-0.5 text-xs text-ink-soft">%</span>
        </span>
      </div>
      <Progress
        value={window.percentRemaining}
        aria-label={`${label} ${displayedPercent}% remaining`}
        className="bg-line-faint"
      />
      <div className="flex min-w-0 items-center justify-between gap-3 text-xxs text-ink-label">
        <span className="truncate">{window.resetsAt ? formatReset(window.resetsAt, now) : "reset not reported"}</span>
        <span className="shrink-0">remaining</span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xxs uppercase tracking-caps text-ink-label">Kimi Code</span>
        <span className="flex items-center gap-1.5 text-xxs uppercase tracking-caps text-signal-warn">
          <StatusDot tone="warn" pulse />
          checking quota
        </span>
      </div>
      <span className="sr-only">checking Kimi quota</span>
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

function FailureState({ result, now }: { result: KimiQuotaResult; now: number }) {
  const copy = failureCopy(result.error?.code, result.credentialSource);
  const retry = result.retryAt ? formatRetry(result.retryAt, now) : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-kimi-quota-state={result.status}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate text-xxs uppercase tracking-caps text-ink-label">Kimi Code</span>
        <span className={`flex shrink-0 items-center gap-1.5 text-xxs uppercase tracking-caps ${copy.className}`} aria-live="polite">
          <StatusDot tone={copy.tone} />
          {copy.title}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-ink-strong">{copy.detail}</span>
        {retry ? <span className="text-xs text-ink-soft">{retry}</span> : null}
      </div>
    </div>
  );
}

function orderedWindows(windows: KimiQuotaWindow[]): KimiQuotaWindow[] {
  const priority = (window: KimiQuotaWindow): number => window.id === "five_hour" ? 0 : window.id === "weekly" ? 1 : 2;
  return windows.map((window, index) => ({ window, index })).sort((left, right) => priority(left.window) - priority(right.window) || left.index - right.index).map(({ window }) => window);
}

function windowLabel(window: KimiQuotaWindow): string {
  if (window.id === "five_hour") return "5H";
  if (window.id === "weekly") return "7D";
  return window.label.toUpperCase();
}

function snapshotStatus(result: KimiQuotaResult, refreshing: boolean): {
  label: string;
  tone: "live" | "warn" | "danger" | "muted";
  className: string;
  pulse: boolean;
} {
  if (refreshing) return { label: "refreshing", tone: "warn", className: "text-signal-warn", pulse: true };
  if (result.stale && result.error?.code === "provider_rate_limited") {
    return { label: "rate limited · cached", tone: "warn", className: "text-signal-warn", pulse: false };
  }
  if (result.stale) return { label: "stale", tone: "warn", className: "text-signal-warn", pulse: false };
  return { label: "fresh", tone: "live", className: "text-signal-live", pulse: false };
}

function failureCopy(code: KimiQuotaErrorCode | undefined, credentialSource?: KimiCredentialSource): {
  title: string;
  detail: string;
  tone: "warn" | "danger";
  className: string;
} {
  if (code === "kimi_credential_unavailable" || code === "unsupported_credential_type") {
    return { title: "credential needed", detail: "sign in with Pi or Kimi CLI", tone: "warn", className: "text-signal-warn" };
  }
  if (code === "provider_auth_rejected") {
    const detail = credentialSource === "kimi-code-cli" ? "sign in again with Kimi CLI" : "check kimi-coding in Pi";
    return { title: "credential rejected", detail, tone: "danger", className: "text-signal-danger" };
  }
  if (code === "provider_rate_limited") {
    return { title: "rate limited", detail: "Kimi quota could not refresh", tone: "warn", className: "text-signal-warn" };
  }
  if (code === "network_unavailable" || code === "tls_failed") {
    return { title: "network unavailable", detail: "Kimi quota could not refresh", tone: "warn", className: "text-signal-warn" };
  }
  if (code === "request_timeout" || code === "provider_timeout") {
    return { title: "request timed out", detail: "Kimi quota could not refresh", tone: "warn", className: "text-signal-warn" };
  }
  if (code === "unexpected_content_type" || code === "response_too_large" || code === "response_invalid_utf8" || code === "malformed_json" || code === "schema_invalid") {
    return { title: "response changed", detail: "Kimi quota could not refresh", tone: "danger", className: "text-signal-danger" };
  }
  if (code === "provider_unavailable") {
    return { title: "service unavailable", detail: "Kimi quota could not refresh", tone: "warn", className: "text-signal-warn" };
  }
  return { title: "quota unavailable", detail: "Kimi quota could not refresh", tone: "danger", className: "text-signal-danger" };
}

function formatReset(value: string, now: number): string {
  const remaining = Date.parse(value) - now;
  return remaining <= 0 ? "reset due" : `resets in ${formatDuration(remaining)}`;
}

function formatRetry(value: string, now: number): string {
  const remaining = Date.parse(value) - now;
  return remaining <= 0 ? "retry now" : `retry in ${formatDuration(remaining)}`;
}

function formatAge(value: string, now: number): string {
  const age = Math.max(0, now - Date.parse(value));
  if (age < 60_000) return "now";
  return `${formatDuration(age)} ago`;
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) return remainderMinutes ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours ? `${days}d ${remainderHours}h` : `${days}d`;
}
