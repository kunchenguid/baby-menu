export const GROK_OBSERVABILITY_ATTRIBUTES: readonly string[];

export type GrokPopoverObservation = {
  observabilityMode: "root-contract" | "installed-root" | "invalid";
  observabilityError?: string;
  state: string | null;
  text: string | null;
  failureKind: string | null;
  checkedAt: string | null;
  stale: string | null;
  warningKind: string | null;
  cacheSchema: string | null;
  operation: string | null;
  source: string | null;
  sourceVersion: string | null;
  periodType: string | null;
  percentUsed: string | null;
  percentRemaining: string | null;
  percentageField: string | null;
  resetAt: string | null;
  resetField: string | null;
  products: string | null;
  completed: number;
  terminal: boolean;
};

export function observeGrokPopover(
  document: Document,
  attributeNames?: readonly string[],
): GrokPopoverObservation | null;
export function grokPopoverObservationExpression(): string;
