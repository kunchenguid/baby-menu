export function refreshLifecycleStatus({ expected, lifecycle, view }) {
  if (lifecycle.started < expected) {
    return { settled: false, stage: "bridge-pending" };
  }
  if (lifecycle.resolved + lifecycle.rejected < expected) {
    return { settled: false, stage: "action-running" };
  }
  if (!view) {
    return { settled: false, stage: "renderer-pending" };
  }
  if (!view.terminal) {
    return { settled: false, stage: `renderer-${view.state || "pending"}` };
  }
  if (view.completed > 0 && view.completed !== expected) {
    return {
      settled: false,
      stage: view.completed < expected ? "renderer-previous-result" : "renderer-unexpected-extra-result",
    };
  }
  return { settled: true, stage: lifecycle.rejected > 0 ? "renderer-bridge-failure" : "renderer-settled" };
}
