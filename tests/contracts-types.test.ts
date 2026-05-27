import type { RefreshableBabyMenuWidget } from "../src/shared/contracts";
import { describe, expect, it } from "vitest";

const refreshableWidget: RefreshableBabyMenuWidget = {
  id: "quota",
  title: "Quota",
  refreshIntervalMs: 1000,
  refresh: async () => undefined,
  render: () => null,
};

void refreshableWidget;

// @ts-expect-error refresh intervals require a refresh callback.
const intervalWithoutRefresh: RefreshableBabyMenuWidget = {
  id: "quota",
  title: "Quota",
  refreshIntervalMs: 1000,
  render: () => null,
};

void intervalWithoutRefresh;

describe("RefreshableBabyMenuWidget contract", () => {
  it("accepts widgets that pair refresh intervals with refresh callbacks", () => {
    expect(refreshableWidget.refreshIntervalMs).toBe(1000);
  });
});
