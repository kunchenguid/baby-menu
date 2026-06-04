import type { Dirent } from "node:fs";
import { access, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { BabyMenuLayoutModuleDescriptor, BabyMenuWidgetModuleDescriptor } from "../shared/contracts";
import { getExtensionsDir } from "../shared/paths";
import { compileExtensionModule } from "./extension-module-compiler";
import { compileWidgetTailwindCss, widgetTailwindCssCacheKey } from "./widget-tailwind-css";
// The single @theme source, inlined into the main bundle so it ships with the
// packaged app. electron-vite (dev + build) resolves `?raw` to the file text;
// note vitest returns "" for `.css?raw`, so token-mapping coverage lives in
// tests/widget-tailwind-css.test.ts which reads theme.css via fs instead.
import themeCss from "../ui/theme.css?raw";

const WIDGET_CSS_FILENAME = "widget.css";
const WIDGET_CSS_CACHE_KEY_FILENAME = "widget.css.cache-key";

export type WidgetModuleRegistry = {
  list: () => Promise<BabyMenuWidgetModuleDescriptor[]>;
};

export type DiscoverWidgetModulesOptions = {
  rootDir: string;
  extensionsDir?: string;
  mode?: "vite" | "compiled";
  widgetCacheDir?: string;
};

const STARTER_EXTENSION_ID = "hello-world";
const WIDGET_FILE_PATTERN = /^widget\.(tsx|jsx|ts|js|mjs)$/;
// The agent-authored layout component lives at the root of the extension
// workspace. It is discovered separately from widgets (which live one directory
// down as `widget.tsx`), so the recursive widget scan never picks it up.
const LAYOUT_FILE_PATTERN = /^layout\.(tsx|jsx|ts|js|mjs)$/;
// Reserved namespace for the single root layout module in the widget cache and
// the `baby-menu-widget://` protocol. Not a real extension id, so it never
// collides with a user-created extension directory.
const LAYOUT_EXTENSION_ID = "__layout";

type CreateWidgetModuleRegistryOptions = DiscoverWidgetModulesOptions;

export function createWidgetModuleRegistry(rootDir: string | CreateWidgetModuleRegistryOptions): WidgetModuleRegistry {
  const options = typeof rootDir === "string" ? { rootDir } : rootDir;
  return {
    list: () => discoverWidgetModules(options),
  };
}

export async function discoverWidgetModules({
  rootDir,
  extensionsDir = getExtensionsDir(rootDir),
  mode = "vite",
  widgetCacheDir,
}: DiscoverWidgetModulesOptions): Promise<BabyMenuWidgetModuleDescriptor[]> {
  const files = await discoverWidgetFiles(resolve(extensionsDir));
  const modules = await Promise.all(
    files.map(async (filePath) => {
      try {
        return await widgetModuleDescriptor({ rootDir, extensionsDir, mode, widgetCacheDir }, filePath);
      } catch (error) {
        if (mode !== "compiled") throw error;
        return null;
      }
    }),
  );
  return modules
    .filter((module): module is BabyMenuWidgetModuleDescriptor => Boolean(module))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export type LayoutModuleRegistry = {
  get: () => Promise<BabyMenuLayoutModuleDescriptor | null>;
};

export function createLayoutModuleRegistry(rootDir: string | CreateWidgetModuleRegistryOptions): LayoutModuleRegistry {
  const options = typeof rootDir === "string" ? { rootDir } : rootDir;
  return {
    get: () => discoverLayoutModule(options),
  };
}

// Resolves the optional root `layout.tsx`, or null when the workspace ships
// none (the renderer then falls back to the built-in column). Mirrors widget
// discovery: a `/@fs` URL in dev, a compiled `baby-menu-widget://` module plus a
// sibling `cssUrl` when packaged.
export async function discoverLayoutModule({
  rootDir,
  extensionsDir = getExtensionsDir(rootDir),
  mode = "vite",
  widgetCacheDir,
}: DiscoverWidgetModulesOptions): Promise<BabyMenuLayoutModuleDescriptor | null> {
  const resolvedExtensionsDir = resolve(extensionsDir);
  const filePath = await findLayoutFile(resolvedExtensionsDir);
  if (!filePath) return null;

  try {
    if (mode === "compiled") {
      return await compiledLayoutModuleUrls({ extensionsDir: resolvedExtensionsDir, filePath, widgetCacheDir });
    }
    const fileStat = await stat(filePath);
    return { moduleUrl: rendererModuleUrl(filePath, fileStat.mtimeMs) };
  } catch (error) {
    if (mode !== "compiled") throw error;
    // Packaged mode never throws from layout discovery (a broken layout must not
    // wedge the popover), but swallowing silently makes a real compile failure
    // look identical to "no layout authored". Warn so the cause is visible.
    console.warn(`[baby-menu] failed to compile root layout at ${filePath}; using the built-in column`, error);
    return null;
  }
}

async function findLayoutFile(extensionsDir: string): Promise<string | null> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(extensionsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const match = entries
    .filter((entry) => entry.isFile() && LAYOUT_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()[0];
  return match ? join(extensionsDir, match) : null;
}

async function compiledLayoutModuleUrls({
  extensionsDir,
  filePath,
  widgetCacheDir,
}: {
  extensionsDir: string;
  filePath: string;
  widgetCacheDir?: string;
}): Promise<BabyMenuLayoutModuleDescriptor> {
  if (!widgetCacheDir) throw new Error("widgetCacheDir is required for compiled layout modules");
  const compiled = await compileExtensionModule({
    kind: "layout",
    extensionId: LAYOUT_EXTENSION_ID,
    extensionDir: extensionsDir,
    entryFile: filePath,
    cacheRoot: widgetCacheDir,
  });

  const cssFileUrl = await ensureWidgetCss({ extensionDir: extensionsDir, outputDir: compiled.outputDir });
  const encodedExtensionId = encodeURIComponent(LAYOUT_EXTENSION_ID);
  const moduleUrl = `baby-menu-widget://${encodedExtensionId}/${compiled.hash}/${encodeModulePath(compiled.outputDir, compiled.outputPath)}`;
  const cssUrl = `baby-menu-widget://${encodedExtensionId}/${compiled.hash}/${encodeModulePath(compiled.outputDir, cssFileUrl)}`;
  return { moduleUrl, cssUrl };
}

async function discoverWidgetFiles(rootDir: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) return discoverWidgetFiles(entryPath);
      if (entry.isFile() && WIDGET_FILE_PATTERN.test(entry.name)) return [entryPath];
      return [];
    }),
  );
  return files.flat();
}

async function widgetModuleDescriptor(options: Required<Pick<DiscoverWidgetModulesOptions, "rootDir" | "extensionsDir" | "mode">> & Pick<DiscoverWidgetModulesOptions, "widgetCacheDir">, filePath: string): Promise<BabyMenuWidgetModuleDescriptor | null> {
  const extensionId = inferExtensionId(options.extensionsDir, filePath);
  if (!extensionId || extensionId === STARTER_EXTENSION_ID) return null;

  const fileStat = await stat(filePath);
  const urls =
    options.mode === "compiled"
      ? await compiledWidgetModuleUrls({ extensionsDir: options.extensionsDir, extensionId, filePath, widgetCacheDir: options.widgetCacheDir })
      : { moduleUrl: rendererModuleUrl(filePath, fileStat.mtimeMs) };
  return {
    id: `${extensionId}.widget`,
    extensionId,
    ...urls,
  };
}

function inferExtensionId(extensionsDir: string, filePath: string): string | null {
  const relativePath = relative(extensionsDir, filePath);
  const firstSegment = relativePath.split(/[\\/]/)[0];
  if (firstSegment && firstSegment !== ".." && firstSegment !== ".") return firstSegment;

  const parent = basename(dirname(filePath));
  return parent && parent !== "." ? parent : basename(filePath, extname(filePath));
}

async function compiledWidgetModuleUrls({
  extensionsDir,
  extensionId,
  filePath,
  widgetCacheDir,
}: {
  extensionsDir: string;
  extensionId: string;
  filePath: string;
  widgetCacheDir?: string;
}): Promise<{ moduleUrl: string; cssUrl: string }> {
  if (!widgetCacheDir) throw new Error("widgetCacheDir is required for compiled widget modules");
  const extensionDir = join(resolve(extensionsDir), extensionId);
  const compiled = await compileExtensionModule({
    kind: "widget",
    extensionId,
    extensionDir,
    entryFile: filePath,
    cacheRoot: widgetCacheDir,
  });

  const cssFileUrl = await ensureWidgetCss({ extensionDir, outputDir: compiled.outputDir });
  const encodedExtensionId = encodeURIComponent(extensionId);
  const moduleUrl = `baby-menu-widget://${encodedExtensionId}/${compiled.hash}/${encodeModulePath(compiled.outputDir, compiled.outputPath)}`;
  const cssUrl = `baby-menu-widget://${encodedExtensionId}/${compiled.hash}/${encodeModulePath(compiled.outputDir, cssFileUrl)}`;
  return { moduleUrl, cssUrl };
}

// Compiles the widget's Tailwind utilities once per content hash (the JS compile
// already keys the output dir by source hash), so polling list() is cheap.
async function ensureWidgetCss({ extensionDir, outputDir }: { extensionDir: string; outputDir: string }): Promise<string> {
  const cssPath = join(outputDir, WIDGET_CSS_FILENAME);
  const cacheKeyPath = join(outputDir, WIDGET_CSS_CACHE_KEY_FILENAME);
  const cacheKey = widgetTailwindCssCacheKey(themeCss);
  if (!(await pathExists(cssPath)) || (await readCacheKey(cacheKeyPath)) !== cacheKey) {
    const css = await compileWidgetTailwindCss({ sourceDir: extensionDir, themeCss });
    await writeFile(cssPath, css, "utf8");
    await writeFile(cacheKeyPath, cacheKey, "utf8");
  }
  return cssPath;
}

async function readCacheKey(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function encodeModulePath(outputDir: string, filePath: string): string {
  const relativePath = relative(outputDir, filePath).split("\\").join("/");
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function rendererModuleUrl(filePath: string, mtimeMs: number): string {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
  const normalizedPath = absolutePath.split("\\").join("/");
  const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
  return `/@fs${encodedPath.startsWith("/") ? "" : "/"}${encodedPath}?babyMenuWidgetVersion=${Math.trunc(mtimeMs)}`;
}
