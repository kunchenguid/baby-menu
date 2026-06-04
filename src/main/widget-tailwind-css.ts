import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

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
    // Resolve the source before copying. When the workspace root is a
    // home-manager/Nix symlink (~/.baby-menu/extensions -> /nix/store/...), the
    // layout compile passes that symlink node as sourceDir, and fs.cp refuses to
    // copy a non-directory node onto the temp scan dir (ERR_FS_CP_NON_DIR_TO_DIR).
    // Copying the resolved real path sidesteps that, mirroring the seeder's
    // resolveSeedTarget. Falls back to the original path if it cannot be resolved.
    const resolvedSourceDir = await realpath(sourceDir).catch(() => sourceDir);
    await cp(resolvedSourceDir, scanDir, { recursive: true });
    const input = `@import "tailwindcss" source(none);\n@source "${scanDir}";\n${themeCss}\n`;
    const result = await postcss([tailwind()]).process(input, {
      from: join(tailwindResolveBase(), "widget-tailwind-input.css"),
    });
    return result.css;
  } finally {
    await rm(scanDir, { recursive: true, force: true });
  }
}

export function widgetTailwindCssCacheKey(themeCss: string): string {
  const compilerPackageMetadata = ["tailwindcss", "@tailwindcss/postcss", "postcss"].map((packageName) =>
    readFileSync(resolvePackageJson(packageName), "utf8"),
  );
  return createHash("sha256")
    .update("widget-tailwind-css-v1")
    .update("\0")
    .update(themeCss)
    .update("\0")
    .update(compilerPackageMetadata.join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function resolvePackageJson(packageName: string): string {
  let currentDir = dirname(require.resolve(packageName));
  while (currentDir !== dirname(currentDir)) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) return packageJsonPath;
    currentDir = dirname(currentDir);
  }
  throw new Error(`Could not resolve package.json for ${packageName}`);
}
