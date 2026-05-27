import { describe, expect, it } from "vitest";
import { installWidgetHostShims } from "../src/renderer/widget-host-shim";

describe("renderer widget host shims", () => {
  it("exposes the host React, JSX runtime, and design system for compiled widgets", () => {
    const target = {} as Window;
    const React = { useState: () => undefined };
    const jsxRuntime = { jsx: () => undefined, Fragment: Symbol.for("fragment") };
    const ui = { Button: () => undefined };

    installWidgetHostShims(target, React, jsxRuntime, ui);

    expect(target.__BABY_MENU_WIDGET_HOST__).toEqual({ React, jsxRuntime, ui });
  });
});
