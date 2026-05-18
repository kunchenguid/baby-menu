import { describe, expect, it } from "vitest";
import { hostProtocolModuleSource, resolveWidgetProtocolFilePath } from "../src/main/widget-protocol";

describe("widget protocol", () => {
  it("resolves widget URLs only inside the compiler cache", () => {
    expect(resolveWidgetProtocolFilePath("/cache/widgets", "baby-menu-widget://cpu-temp/abc123/widget.mjs")).toBe(
      "/cache/widgets/cpu-temp/abc123/widget.mjs",
    );
  });

  it("rejects path traversal and non-module widget protocol URLs", () => {
    expect(() => resolveWidgetProtocolFilePath("/cache/widgets", "baby-menu-widget://cpu-temp/../secret.mjs")).toThrow(
      "Invalid widget module URL",
    );
    expect(() => resolveWidgetProtocolFilePath("/cache/widgets", "baby-menu-widget://cpu-temp/abc123/widget.txt")).toThrow(
      "Invalid widget module URL",
    );
  });

  it("serves host React shim modules from the renderer host object", () => {
    expect(hostProtocolModuleSource("baby-menu-host://react/index.mjs")).toContain(
      "window.__BABY_MENU_WIDGET_HOST__.React",
    );
    expect(hostProtocolModuleSource("baby-menu-host://react-jsx-runtime/index.mjs")).toContain(
      "window.__BABY_MENU_WIDGET_HOST__.jsxRuntime",
    );
    expect(() => hostProtocolModuleSource("baby-menu-host://unknown/index.mjs")).toThrow("Unknown host module URL");
  });
});
