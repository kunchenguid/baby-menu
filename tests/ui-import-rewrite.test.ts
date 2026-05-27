import { describe, expect, it } from "vitest";
import { rewriteExtensionModuleImports, UI_IMPORT_SPECIFIER } from "../src/main/extension-module-compiler";

const widgetContext = {
  kind: "widget" as const,
  extensionId: "demo",
  extensionDir: "/extensions/demo",
  filePath: "/extensions/demo/widget.tsx",
};

describe("@babymenu/ui widget import rewriting", () => {
  it("rewrites the design-system specifier to the host protocol module", async () => {
    const rewritten = await rewriteExtensionModuleImports({
      ...widgetContext,
      source: `import { Button } from "${UI_IMPORT_SPECIFIER}";\n`,
    });
    expect(rewritten).toContain('"baby-menu-host://ui/index.mjs"');
    expect(rewritten).not.toContain(UI_IMPORT_SPECIFIER);
  });

  it("still rewrites react to the host shim alongside the design system", async () => {
    const rewritten = await rewriteExtensionModuleImports({
      ...widgetContext,
      source: `import { useState } from "react";\nimport { Card } from "${UI_IMPORT_SPECIFIER}";\n`,
    });
    expect(rewritten).toContain('"baby-menu-host://react/index.mjs"');
    expect(rewritten).toContain('"baby-menu-host://ui/index.mjs"');
  });

  it("still rejects arbitrary npm imports in widgets", async () => {
    await expect(
      rewriteExtensionModuleImports({ ...widgetContext, source: `import thing from "lodash";\n` }),
    ).rejects.toThrow(/Unsupported widget import/);
  });
});
