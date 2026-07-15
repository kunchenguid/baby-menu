export type GrokPopoverLifecycle = {
  started: number;
  resolved: number;
  rejected: number;
};

export type GrokPopoverViewLifecycle = {
  state: string | null;
  terminal: boolean;
  completed: number;
  checkedAt?: string | null;
};

export function refreshLifecycleStatus(input: {
  expected: number;
  lifecycle: GrokPopoverLifecycle;
  view: GrokPopoverViewLifecycle | null;
  previousCheckedAt?: string | null;
}): { settled: boolean; stage: string };
