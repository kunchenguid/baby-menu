import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(import.meta.dirname, "../src/renderer/styles.css");

describe("renderer layout styles", () => {
  it("uses the Monochrome Lab token file and fixed tray popover width", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toContain('@import url("./colors_and_type.css")');
    expect(css).toMatch(/\.app-shell\s*\{[^}]*width:\s*360px/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*background:\s*var\(--bg-stage\)/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*border-radius:\s*var\(--radius-xl\)/s);
  });

  it("keeps widgets as dashed log sections above a pinned composer", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toMatch(/\.widget-host\s*\{[^}]*max-height:\s*360px/s);
    expect(css).toMatch(/\.widget\s*\{[^}]*border-bottom:\s*1px\s+dashed\s+var\(--line-faint\)/s);
    expect(css).toMatch(/\.composer-wrap\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--line\)/s);
    expect(css).not.toMatch(/\.message-list/);
  });

  it("covers the full BrowserWindow with the dark popover surface", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toMatch(/html,\s*\nbody,\s*\n#root\s*\{[^}]*background:\s*var\(--bg-stage\)/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*height:\s*auto/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*max-height:\s*min\(720px,\s*100vh\)/s);
    expect(css).not.toMatch(/\.app-shell\s*\{[^}]*height:\s*100vh/s);
  });

  it("includes compact settings styles for the open-at-login toggle", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toMatch(/\.settings-toggle\s*\{/);
    expect(css).toMatch(/\.settings-toggle\.enabled\s*\{/);
  });
});
