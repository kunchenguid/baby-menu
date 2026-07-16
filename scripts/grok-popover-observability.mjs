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

// Helpers stay inside observeGrokPopover so the CDP expression is self-contained.
// attributeNames is injected so the complete-root list has one module-level owner.
export function observeGrokPopover(document, attributeNames = GROK_OBSERVABILITY_ATTRIBUTES) {
  const operation = "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig";
  const completeValueAttributes = [
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
  const installedValueAttributes = completeValueAttributes.map((name) => name.replace("data-grok-", "data-"));
  const roots = [...document.querySelectorAll("[data-grok-e2e]")];

  function isExactIso(value) {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }

  function parseProducts(productsText) {
    try {
      const products = JSON.parse(productsText || "");
      if (!Array.isArray(products)) return null;
      if (!products.every((product) =>
        product && typeof product === "object" && !Array.isArray(product) &&
        Object.keys(product).sort().join(",") === "id,percentUsed" &&
        typeof product.id === "string" && product.id.startsWith("product:") &&
        Number.isFinite(product.percentUsed) && product.percentUsed >= 0 && product.percentUsed <= 100)) {
        return null;
      }
      return products;
    } catch {
      return null;
    }
  }

  function parseCompleted(text) {
    if (text === null || text === undefined || text === "") return null;
    if (!/^\d+$/.test(text)) return null;
    const completed = Number(text);
    return Number.isSafeInteger(completed) ? completed : null;
  }

  function attr(root, unprefixed, prefixed) {
    if (root.hasAttribute(unprefixed)) return root.getAttribute(unprefixed);
    if (prefixed && root.hasAttribute(prefixed)) return root.getAttribute(prefixed);
    return null;
  }

  function hasTerminalEvidence(root) {
    if (root.getAttribute("data-grok-e2e") !== "waiting") return true;
    const completedComplete = root.getAttribute("data-grok-completed-acquisitions");
    if (completedComplete !== null && completedComplete !== "" && completedComplete !== "0") return true;
    const completedInstalled = root.getAttribute("data-grok-completed-refreshes");
    if (completedInstalled !== null && completedInstalled !== "" && completedInstalled !== "0") return true;
    if (root.getAttribute("data-grok-stale") === "true" || root.getAttribute("data-stale") === "true") return true;
    if (![null, "", "none"].includes(root.getAttribute("data-grok-warning-kind"))) return true;
    if (![null, "", "none"].includes(root.getAttribute("data-warning-kind"))) return true;
    if (![null, "", "none"].includes(root.getAttribute("data-grok-failure-kind"))) return true;
    if (![null, "", "none"].includes(root.getAttribute("data-failure-kind"))) return true;
    if (completeValueAttributes.some((name) => Boolean(root.getAttribute(name)))) return true;
    if (installedValueAttributes.some((name) => Boolean(root.getAttribute(name)))) return true;
    const products = root.getAttribute("data-grok-products") ?? root.getAttribute("data-products");
    return products !== null && products !== "" && products !== "[]";
  }

  function readCompleteRoot(root) {
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
    const products = parseProducts(productsText);
    const completed = parseCompleted(root.getAttribute("data-grok-completed-acquisitions"));

    if (products === null || completed === null) return null;
    if (!["waiting", "success", "failure"].includes(state)) return null;
    if (stale !== "true" && stale !== "false") return null;
    if (!warningKind || !failureKind) return null;

    if (state === "waiting") {
      if (checkedAt || cacheSchema || source || sourceVersion || observedOperation || periodType || percentUsed ||
          percentRemaining || percentageField || resetAt || resetField || products.length > 0 ||
          stale !== "false" || warningKind !== "none" || failureKind !== "none" || completed !== 0) {
        return null;
      }
    } else if (completed === 0 || !isExactIso(checkedAt)) {
      return null;
    } else if (state === "failure") {
      if (failureKind === "none" || stale !== "false" || warningKind !== "none" || cacheSchema || source ||
          sourceVersion || observedOperation || periodType || percentUsed || percentRemaining || percentageField ||
          resetAt || resetField || products.length > 0) {
        return null;
      }
    } else {
      const validReset = (!resetAt && !resetField) ||
        (isExactIso(resetAt) && resetField === "config.currentPeriod.end");
      if (cacheSchema !== "2" || source !== "grok-credits-grpc-web" || sourceVersion !== "1" ||
          observedOperation !== operation || !["weekly", "monthly", "unspecified"].includes(periodType) ||
          !percentUsed || !percentRemaining || !Number.isFinite(Number(percentUsed)) ||
          !Number.isFinite(Number(percentRemaining)) || Number(percentUsed) < 0 || Number(percentUsed) > 100 ||
          Number(percentRemaining) < 0 || Number(percentRemaining) > 100 || !percentageField || !validReset ||
          failureKind !== "none" || (stale === "false" && warningKind !== "none") ||
          (stale === "true" && warningKind === "none")) {
        return null;
      }
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

  function looksLikeInstalledRoot(root) {
    // Authoritative installed root (dotfiles-private PR 48 merge): one data-grok-e2e root
    // owns unprefixed PR 77 parity values, optional data-grok-* aliases on the same root,
    // and data-grok-completed-refreshes. It does not use the future complete-root attribute set.
    return root.hasAttribute("data-grok-completed-refreshes");
  }

  function readInstalledRoot(root) {
    if (!looksLikeInstalledRoot(root)) return null;

    const state = root.getAttribute("data-grok-e2e");
    if (!["waiting", "success", "failure"].includes(state)) return null;

    const checkedAt = attr(root, "data-checked-at", "data-grok-checked-at");
    const stale = attr(root, "data-stale", "data-grok-stale") ?? "false";
    const warningKind = attr(root, "data-warning-kind", "data-grok-warning-kind") ?? "none";
    const failureKind = attr(root, "data-failure-kind", "data-grok-failure-kind");
    const cacheSchema = attr(root, "data-cache-schema", "data-grok-cache-schema");
    const source = attr(root, "data-source", "data-grok-source");
    const sourceVersion = attr(root, "data-source-version", "data-grok-source-version");
    const observedOperation = attr(root, "data-operation", "data-grok-operation");
    const periodType = attr(root, "data-period", "data-grok-period");
    const percentUsed = attr(root, "data-percent-used", "data-grok-percent-used");
    const percentRemaining = attr(root, "data-percent-remaining", "data-grok-percent-remaining");
    const percentageField = attr(root, "data-percentage-field", "data-grok-percentage-field");
    const resetAt = attr(root, "data-reset-at", "data-grok-reset-at");
    const resetField = attr(root, "data-reset-field", "data-grok-reset-field");
    const productsText = attr(root, "data-products", "data-grok-products");
    const refreshing = root.getAttribute("data-grok-refreshing") === "true";

    const completed = parseCompleted(root.getAttribute("data-grok-completed-refreshes"));
    if (completed === null) return null;

    if (state === "waiting") {
      if (hasTerminalEvidence(root)) return null;
      if (completed !== 0) return null;
      return {
        observabilityMode: "installed-root",
        state,
        text: root.textContent,
        failureKind: failureKind || null,
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
        completed: 0,
        terminal: false,
      };
    }

    if (completed < 1 || !checkedAt || !isExactIso(checkedAt)) return null;
    if (state === "success" &&
      (!root.hasAttribute("data-operation") || !root.hasAttribute("data-source") ||
        !root.hasAttribute("data-source-version") || !root.hasAttribute("data-cache-schema") ||
        !observedOperation || !source || !sourceVersion || !cacheSchema ||
        stale !== "false" || warningKind !== "none" || failureKind !== "")) {
      return null;
    }
    if (state === "failure" &&
      (!failureKind || failureKind === "none" || stale !== "false" || warningKind !== "none" ||
        cacheSchema || source || sourceVersion || observedOperation || periodType || percentUsed ||
        percentRemaining || percentageField || resetAt || resetField ||
        (productsText !== null && productsText !== "" && productsText !== "[]"))) {
      return null;
    }

    return {
      observabilityMode: "installed-root",
      state,
      text: root.textContent,
      failureKind: failureKind || null,
      checkedAt,
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
      terminal: !refreshing,
    };
  }

  for (const root of roots) {
    const complete = readCompleteRoot(root);
    if (complete) return complete;
  }

  for (const root of roots) {
    const installed = readInstalledRoot(root);
    if (installed) return installed;
  }

  if (roots.some(hasTerminalEvidence)) {
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
  const attributeNames = JSON.stringify([...GROK_OBSERVABILITY_ATTRIBUTES]);
  return `((document) => (${observeGrokPopover.toString()})(document, ${attributeNames}))(document)`;
}
