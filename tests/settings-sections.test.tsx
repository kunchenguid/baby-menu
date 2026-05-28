// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BabyMenuApi, BabyMenuSettingsSection } from "../src/shared/contracts";
import { loadRuntimeSettingsSections, settingsSectionsFromModule } from "../src/renderer/settings/settings-sections";

function installWidgetList(list: BabyMenuApi["widgets"]["list"]) {
  window.babyMenu = { widgets: { list } } as unknown as typeof window.babyMenu;
}

afterEach(() => {
  delete window.babyMenu;
  vi.restoreAllMocks();
});

const section = (extensionId: string, title = extensionId): BabyMenuSettingsSection => ({
  extensionId,
  title,
  render: () => null,
});

describe("settingsSectionsFromModule", () => {
  it("extracts exports that match the settings-section shape", () => {
    const calendar = section("calendar", "CALENDAR");
    expect(settingsSectionsFromModule({ calendarSettings: calendar, other: 5 })).toEqual([calendar]);
  });

  it("ignores widget exports that lack an extensionId", () => {
    // A RefreshableBabyMenuWidget has id/title/render but no extensionId, so it
    // must not be mistaken for a settings section sharing the same module.
    const widget = { id: "calendar", title: "CALENDAR", render: () => null };
    expect(settingsSectionsFromModule({ calendarWidget: widget })).toEqual([]);
  });

  it("returns nothing for non-object modules", () => {
    expect(settingsSectionsFromModule(null)).toEqual([]);
    expect(settingsSectionsFromModule("nope")).toEqual([]);
  });
});

describe("loadRuntimeSettingsSections", () => {
  it("loads sections across modules and sorts them by extension id", async () => {
    installWidgetList(
      vi.fn(async () => [
        { id: "calendar.widget", extensionId: "calendar", moduleUrl: "/@fs/calendar/widget.tsx" },
        { id: "battery.widget", extensionId: "battery", moduleUrl: "/@fs/battery/widget.tsx" },
      ]),
    );
    const modules: Record<string, unknown> = {
      "/@fs/calendar/widget.tsx": { calendarSettings: section("calendar") },
      "/@fs/battery/widget.tsx": { batterySettings: section("battery") },
    };

    const sections = await loadRuntimeSettingsSections(async (url) => modules[url]);

    expect(sections.map((s) => s.extensionId)).toEqual(["battery", "calendar"]);
  });

  it("returns an empty list when no extensions are discovered", async () => {
    installWidgetList(vi.fn(async () => []));
    expect(await loadRuntimeSettingsSections(async () => ({}))).toEqual([]);
  });

  it("skips a module that fails to import without dropping the others", async () => {
    installWidgetList(
      vi.fn(async () => [
        { id: "calendar.widget", extensionId: "calendar", moduleUrl: "/@fs/calendar/widget.tsx" },
        { id: "broken.widget", extensionId: "broken", moduleUrl: "/@fs/broken/widget.tsx" },
      ]),
    );

    const sections = await loadRuntimeSettingsSections(async (url) => {
      if (url.includes("broken")) throw new Error("boom");
      return { calendarSettings: section("calendar") };
    });

    expect(sections.map((s) => s.extensionId)).toEqual(["calendar"]);
  });
});
