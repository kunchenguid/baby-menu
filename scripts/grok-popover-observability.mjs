export const GROK_OBSERVABILITY_ATTRIBUTES = Object.freeze([
  "data-grok-e2e",
  "data-grok-checked-at",
  "data-grok-stale",
  "data-grok-warning-kind",
  "data-grok-failure-kind",
  "data-grok-cache-schema",
  "data-grok-source",
  "data-grok-source-version",
  "data-grok-operation",
  "data-grok-period",
  "data-grok-percent-used",
  "data-grok-percent-remaining",
  "data-grok-percentage-field",
  "data-grok-reset-at",
  "data-grok-reset-field",
  "data-grok-products",
  "data-grok-completed-acquisitions",
]);

export function observeGrokPopover(document) {
  const attributeNames = [
    "data-grok-e2e",
    "data-grok-checked-at",
    "data-grok-stale",
    "data-grok-warning-kind",
    "data-grok-failure-kind",
    "data-grok-cache-schema",
    "data-grok-source",
    "data-grok-source-version",
    "data-grok-operation",
    "data-grok-period",
    "data-grok-percent-used",
    "data-grok-percent-remaining",
    "data-grok-percentage-field",
    "data-grok-reset-at",
    "data-grok-reset-field",
    "data-grok-products",
    "data-grok-completed-acquisitions",
  ];
  const operation = "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig";
  const roots = [...document.querySelectorAll("[data-grok-e2e]")];

  function isExactIso(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }

  function hasTerminalEvidence(root) {
    if (root.getAttribute("data-grok-e2e") !== "waiting") return true;
    const completedText = root.getAttribute("data-grok-completed-acquisitions");
    if (completedText !== null && completedText !== "" && completedText !== "0") return true;
    if (root.getAttribute("data-grok-stale") === "true") return true;
    if (![null, "", "none"].includes(root.getAttribute("data-grok-warning-kind"))) return true;
    if (![null, "", "none"].includes(root.getAttribute("data-grok-failure-kind"))) return true;
    const completedValueAttributes = [
      "data-grok-checked-at",
      "data-grok-cache-schema",
      "data-grok-source",
      "data-grok-source-version",
      "data-grok-operation",
      "data-grok-period",
      "data-grok-percent-used",
      "data-grok-percent-remaining",
      "data-grok-percentage-field",
      "data-grok-reset-at",
      "data-grok-reset-field",
    ];
    if (completedValueAttributes.some((name) => Boolean(root.getAttribute(name)))) return true;
    const products = root.getAttribute("data-grok-products");
    return products !== null && products !== "" && products !== "[]";
  }

  function readRoot(root) {
    if (!attributeNames.every((name) => root.hasAttribute(name))) return null;
    const state = root.getAttribute("data-grok-e2e");
    const checkedAt = root.getAttribute("data-grok-checked-at");
    const stale = root.getAttribute("data-grok-stale");
    const warningKind = root.getAttribute("data-grok-warning-kind");
    const failureKind = root.getAttribute("data-grok-failure-kind");
    const cacheSchema = root.getAttribute("data-grok-cache-schema");
    const source = root.getAttribute("data-grok-source");
    const sourceVersion = root.getAttribute("data-grok-source-version");
    const observedOperation = root.getAttribute("data-grok-operation");
    const periodType = root.getAttribute("data-grok-period");
    const percentUsed = root.getAttribute("data-grok-percent-used");
    const percentRemaining = root.getAttribute("data-grok-percent-remaining");
    const percentageField = root.getAttribute("data-grok-percentage-field");
    const resetAt = root.getAttribute("data-grok-reset-at");
    const resetField = root.getAttribute("data-grok-reset-field");
    const productsText = root.getAttribute("data-grok-products");
    const completedText = root.getAttribute("data-grok-completed-acquisitions");
    let products;
    try {
      products = JSON.parse(productsText || "");
    } catch {
      return null;
    }
    const completed = Number(completedText);
    const validProducts = Array.isArray(products) && products.every((product) =>
      product && typeof product === "object" && !Array.isArray(product) &&
      Object.keys(product).sort().join(",") === "id,percentUsed" &&
      typeof product.id === "string" && product.id.startsWith("product:") &&
      Number.isFinite(product.percentUsed) && product.percentUsed >= 0 && product.percentUsed <= 100);
    const validCommon = ["waiting", "success", "failure"].includes(state) &&
      (stale === "true" || stale === "false") &&
      Boolean(warningKind) && Boolean(failureKind) &&
      /^\d+$/.test(completedText || "") && Number.isSafeInteger(completed) &&
      validProducts;
    if (!validCommon) return null;
    if (state === "waiting") {
      if (checkedAt || cacheSchema || source || sourceVersion || observedOperation || periodType || percentUsed ||
          percentRemaining || percentageField || resetAt || resetField || products.length > 0 ||
          stale !== "false" || warningKind !== "none" || failureKind !== "none" || completed !== 0) return null;
    } else if (completed === 0 || !isExactIso(checkedAt)) {
      return null;
    } else if (state === "failure") {
      if (failureKind === "none" || stale !== "false" || warningKind !== "none" || cacheSchema || source ||
          sourceVersion || observedOperation || periodType || percentUsed || percentRemaining || percentageField ||
          resetAt || resetField || products.length > 0) return null;
    } else {
      const validReset = (!resetAt && !resetField) ||
        (isExactIso(resetAt) && resetField === "config.currentPeriod.end");
      if (cacheSchema !== "2" || source !== "grok-credits-grpc-web" || sourceVersion !== "1" ||
          observedOperation !== operation || !["weekly", "monthly", "unspecified"].includes(periodType) ||
          !percentUsed || !percentRemaining || !Number.isFinite(Number(percentUsed)) ||
          !Number.isFinite(Number(percentRemaining)) || Number(percentUsed) < 0 || Number(percentUsed) > 100 ||
          Number(percentRemaining) < 0 || Number(percentRemaining) > 100 || !percentageField || !validReset ||
          failureKind !== "none" || (stale === "false" && warningKind !== "none") ||
          (stale === "true" && warningKind === "none")) return null;
    }
    return {
      observabilityMode: "root-contract",
      state,
      text: root.textContent,
      failureKind,
      checkedAt: checkedAt || null,
      stale,
      warningKind,
      cacheSchema: cacheSchema || null,
      operation: observedOperation || null,
      source: source || null,
      sourceVersion: sourceVersion || null,
      periodType: periodType || null,
      percentUsed: percentUsed || null,
      percentRemaining: percentRemaining || null,
      percentageField: percentageField || null,
      resetAt: resetAt || null,
      resetField: resetField || null,
      products: productsText,
      completed,
      terminal: state !== "waiting",
    };
  }

  for (const root of roots) {
    const view = readRoot(root);
    if (view) return view;
  }

  const region = document.querySelector("[aria-label='menu widgets']");
  const text = region?.textContent || "";
  const button = [...(region?.querySelectorAll("button") || [])]
    .find((node) => /^(?:refresh|check again|checking)$/i.test(node.textContent?.trim() || ""));
  const aliasNames = [
    "checked-at",
    "cache-schema",
    "operation",
    "source",
    "source-version",
    "period",
    "percent-used",
    "percent-remaining",
    "percentage-field",
    "reset-at",
    "reset-field",
    "products",
  ];
  const aliases = Object.fromEntries(aliasNames.map((name) => {
    const node = region?.querySelector(`[data-grok-${name}]`);
    return [name, node && !roots.includes(node) ? node.getAttribute(`data-grok-${name}`) : null];
  }));
  const lower = text.toLowerCase();
  const visibleCompleted = Number([...String(text).matchAll(/checked (\d+)/ig)].at(-1)?.[1] || 0);
  const visiblySettled = Boolean(button) && !button.disabled &&
    button.textContent?.trim().toLowerCase() !== "checking" && !lower.includes("reading");
  const hasAllAliases = aliasNames.every((name) => aliases[name] !== null);
  if (region && button && hasAllAliases && (visibleCompleted > 0 || !visiblySettled)) {
    const failure = lower.includes("quota unreported");
    const stale = lower.includes("stale");
    return {
      observabilityMode: "installed-fallback",
      state: failure && !stale ? "failure" : "success",
      text,
      failureKind: failure ? "quota_unreported" : null,
      checkedAt: aliases["checked-at"],
      stale: String(stale),
      warningKind: stale && failure ? "quota_unreported" : "none",
      cacheSchema: aliases["cache-schema"],
      operation: aliases.operation,
      source: aliases.source,
      sourceVersion: aliases["source-version"],
      periodType: aliases.period,
      percentUsed: aliases["percent-used"],
      percentRemaining: aliases["percent-remaining"],
      percentageField: aliases["percentage-field"],
      resetAt: aliases["reset-at"],
      resetField: aliases["reset-field"],
      products: aliases.products,
      completed: visibleCompleted,
      terminal: visiblySettled,
    };
  }

  if (roots.some(hasTerminalEvidence) || (visiblySettled && (visibleCompleted > 0 || hasAllAliases))) {
    const missing = attributeNames.filter((name) => !roots.some((root) => root.hasAttribute(name)));
    return {
      observabilityMode: "invalid",
      observabilityError: `data-grok-e2e root with terminal evidence does not satisfy the stable root contract${missing.length ? `; missing ${missing.join(", ")}` : "; invalid values"}`,
      state: "contract-invalid",
      text: "",
      failureKind: null,
      checkedAt: null,
      stale: null,
      warningKind: null,
      cacheSchema: null,
      operation: null,
      source: null,
      sourceVersion: null,
      periodType: null,
      percentUsed: null,
      percentRemaining: null,
      percentageField: null,
      resetAt: null,
      resetField: null,
      products: null,
      completed: 0,
      terminal: true,
    };
  }
  return null;
}

export function grokPopoverObservationExpression() {
  return `(${observeGrokPopover.toString()})(document)`;
}
