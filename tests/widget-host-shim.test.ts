import { describe, expect, it } from "vitest";
import { installWidgetHostShims } from "../src/renderer/widget-host-shim";

describe("renderer widget host shims", () => {
  it("exposes the host React and JSX runtime objects for compiled widgets", () => {
    const target = {} as Window;
    const React = { useState: () => undefined };
    const jsxRuntime = { jsx: () => undefined, Fragment: Symbol.for("fragment") };

    installWidgetHostShims(target, React, jsxRuntime);

    expect(target.__BABY_MENU_WIDGET_HOST__).toEqual({ React, jsxRuntime });
  });
});
