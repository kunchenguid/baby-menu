import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

const require = createRequire(import.meta.url);

// Anchor PostCSS's `from` at the install root that owns `node_modules/tailwindcss`
// so `@import "tailwindcss"` resolves in both source and packaged runtimes,
// independent of process.cwd() (which is unreliable in a packaged Electron app).
function tailwindResolveBase(): string {
  const entry = require.resolve("tailwindcss");
  const [base] = entry.split(`${sep}node_modules${sep}`);
  return base || process.cwd();
}

export type CompileWidgetTailwindCssOptions = {
  // Directory scanned for Tailwind class candidates (the extension workspace).
  sourceDir: string;
  // The `@theme { ... }` block defining Baby Menu tokens, read from the single
  // source of truth at src/ui/theme.css. Off-palette utilities do not exist.
  themeCss: string;
};

// Compiles the utility CSS an agent authored in a widget's source. Used only in
// compiled/packaged mode; dev mode gets utilities from the global stylesheet.
export async function compileWidgetTailwindCss({ sourceDir, themeCss }: CompileWidgetTailwindCssOptions): Promise<string> {
  // Tailwind's scanner skips hidden path segments, and the packaged workspace
  // lives under ~/.baby-menu. Copy the sources into a clean, non-hidden temp dir
  // so scanning works regardless of where the extension actually resides.
  const scanDir = await mkdtemp(join(tmpdir(), "baby-menu-widget-scan-"));
  try {
    await cp(sourceDir, scanDir, { recursive: true });
    const input = `@import "tailwindcss" source(none);\n@source "${scanDir}";\n${themeCss}\n`;
    const result = await postcss([tailwind()]).process(input, {
      from: join(tailwindResolveBase(), "widget-tailwind-input.css"),
    });
    return result.css;
  } finally {
    await rm(scanDir, { recursive: true, force: true });
  }
}
