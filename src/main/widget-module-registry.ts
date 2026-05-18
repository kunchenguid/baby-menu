import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { BabyMenuWidgetModuleDescriptor } from "../shared/contracts";
import { getExtensionsDir } from "../shared/paths";
import { compileExtensionModule } from "./extension-module-compiler";

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
  const moduleUrl =
    options.mode === "compiled"
      ? await compiledWidgetModuleUrl({ extensionsDir: options.extensionsDir, extensionId, filePath, widgetCacheDir: options.widgetCacheDir })
      : rendererModuleUrl(filePath, fileStat.mtimeMs);
  return {
    id: `${extensionId}.widget`,
    extensionId,
    moduleUrl,
  };
}

function inferExtensionId(extensionsDir: string, filePath: string): string | null {
  const relativePath = relative(extensionsDir, filePath);
  const firstSegment = relativePath.split(/[\\/]/)[0];
  if (firstSegment && firstSegment !== ".." && firstSegment !== ".") return firstSegment;

  const parent = basename(dirname(filePath));
  return parent && parent !== "." ? parent : basename(filePath, extname(filePath));
}

async function compiledWidgetModuleUrl({
  extensionsDir,
  extensionId,
  filePath,
  widgetCacheDir,
}: {
  extensionsDir: string;
  extensionId: string;
  filePath: string;
  widgetCacheDir?: string;
}): Promise<string> {
  if (!widgetCacheDir) throw new Error("widgetCacheDir is required for compiled widget modules");
  const extensionDir = join(resolve(extensionsDir), extensionId);
  const compiled = await compileExtensionModule({
    kind: "widget",
    extensionId,
    extensionDir,
    entryFile: filePath,
    cacheRoot: widgetCacheDir,
  });
  const outputRelativePath = relative(compiled.outputDir, compiled.outputPath).split("\\").join("/");
  const encodedExtensionId = encodeURIComponent(extensionId);
  const encodedPath = outputRelativePath.split("/").map(encodeURIComponent).join("/");
  return `baby-menu-widget://${encodedExtensionId}/${compiled.hash}/${encodedPath}`;
}

function rendererModuleUrl(filePath: string, mtimeMs: number): string {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(filePath);
  const normalizedPath = absolutePath.split("\\").join("/");
  const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
  return `/@fs${encodedPath.startsWith("/") ? "" : "/"}${encodedPath}?babyMenuWidgetVersion=${Math.trunc(mtimeMs)}`;
}
