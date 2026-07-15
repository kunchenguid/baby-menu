import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesPath = resolve(import.meta.dirname, "../src/renderer/styles.css");

describe("renderer layout styles", () => {
  it("uses the Monochrome Lab token file and fills the content-sized popover window", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toContain('@import url("./colors_and_type.css")');
    // The shell fills the window; the main process sizes the window's width to
    // the reported content (504 by default, or the active layout canvas plus
    // host chrome).
    expect(css).toMatch(/\.app-shell\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*background:\s*var\(--bg-stage\)/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*border-radius:\s*var\(--radius-xl\)/s);
    // A custom layout canvas shrink-wraps its content so its width is measurable.
    expect(css).toMatch(/\.widget-canvas\s*\{[^}]*width:\s*max-content/s);
  });

  it("keeps widgets as dashed log sections in a scroll region above a pinned composer", async () => {
    const css = await readFile(stylesPath, "utf8");

    // The widget region scrolls via .pop-body, which flexes to fill the window
    // (so the popover auto-extends to fit content) while the composer stays pinned.
    expect(css).toMatch(/\.pop-body\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(css).toMatch(/\.pop-body\s*\{[^}]*min-height:\s*0/s);
    expect(css).toMatch(/\.pop-body\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).not.toMatch(/\.widget-host\s*\{[^}]*max-height/s);
    expect(css).toMatch(/\.composer-wrap\s*\{[^}]*flex:\s*0 0 auto/s);
    expect(css).toMatch(/\.widget\s*\{[^}]*border-bottom:\s*1px\s+dashed\s+var\(--line-faint\)/s);
    expect(css).toMatch(/\.composer-wrap\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--line\)/s);
    expect(css).not.toMatch(/\.message-list/);
  });

  it("covers the full BrowserWindow with the dark popover surface", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toMatch(/html,\s*\nbody,\s*\n#root\s*\{[^}]*background:\s*var\(--bg-stage\)/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*height:\s*auto/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*max-height:\s*720px/s);
    // 100vh equals the auto-sized window height, which ratchets the popover.
    expect(css).not.toMatch(/\.app-shell\s*\{[^}]*100vh/s);
  });

  it("wraps actionable failure guidance within the popover", async () => {
    const css = await readFile(stylesPath, "utf8");

    expect(css).toMatch(/\.sessionbar\.error \.sb-msg\s*\{[^}]*white-space:\s*normal/s);
    expect(css).toMatch(/\.sessionbar\.error \.sb-msg\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

});
