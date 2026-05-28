import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BabyMenuBackgroundTask, BabyMenuCapabilityDescriptor, BabyMenuServerContext } from "../shared/contracts";
import { createExtensionDatabase, type ExtensionDatabase } from "./extension-database";
import { compileExtensionModule, rewriteExtensionModuleImports } from "./extension-module-compiler";

export type ServerActionContext = BabyMenuServerContext & {
  db: ExtensionDatabase;
};

export type DiscoveredBackgroundTask = {
  extensionId: string;
  sourceFile: string;
  intervalMs: number;
  runOnStart: boolean;
  run: BabyMenuBackgroundTask["run"];
};

export type BackgroundTaskSource = {
  list: () => Promise<DiscoveredBackgroundTask[]>;
};

export type ServerActionHandler = (input: unknown, context: ServerActionContext) => unknown | Promise<unknown>;

export type ServerActionRegistry = {
  list: () => Promise<BabyMenuCapabilityDescriptor[]>;
  invoke: (extensionId: string, action: string, input?: unknown) => Promise<unknown>;
};

type LoadedServerAction = BabyMenuCapabilityDescriptor & {
  handler: ServerActionHandler;
};

type ServerActionModule = {
  extensionId?: unknown;
  id?: unknown;
  actions?: unknown;
  background?: unknown;
};

type CreateServerActionRegistryOptions = {
  rootDir: string;
  actionRoots?: string[];
  cacheDir?: string;
  db?: ExtensionDatabase;
  notify?: ServerActionContext["notify"];
};

type CreateBackgroundTaskSourceOptions = {
  rootDir: string;
  actionRoots?: string[];
  cacheDir?: string;
  onError?: (extensionId: string, error: unknown) => void;
};

const DEFAULT_ACTION_ROOTS = ["extensions"];
const SERVER_ACTION_FILE_PATTERN = /(^server|\.server)\.(mjs|js|ts)$/;

export function createServerActionRegistry(options: CreateServerActionRegistryOptions): ServerActionRegistry {
  let importVersion = 0;
  const actionRoots = options.actionRoots ?? DEFAULT_ACTION_ROOTS;
  // Share the host database with actions. Default to an in-memory store so a registry
  // can be exercised in isolation (e.g. tests) without a backing file.
  let database = options.db ?? null;
  const getDatabase = (): ExtensionDatabase => (database ??= createExtensionDatabase(":memory:"));

  const loadActions = async (): Promise<LoadedServerAction[]> => {
    const files = (
      await Promise.all(actionRoots.map((root) => discoverServerActionFiles(resolveActionRoot(options.rootDir, root))))
    ).flat();

    const loaded = await Promise.all(files.map(async (filePath) => loadServerActionFile(filePath, options.rootDir, ++importVersion, options.cacheDir)));
    return loaded.flat();
  };

  return {
    async list() {
      return (await loadActions()).map(({ id, extensionId, action }) => ({ id, extensionId, action }));
    },
    async invoke(extensionId, action, input) {
      const capability = (await loadActions()).find(
        (candidate) => candidate.extensionId === extensionId && candidate.action === action,
      );
      if (!capability) throw new Error(`Unknown server action: ${extensionId}.${action}`);

      return capability.handler(input, {
        rootDir: options.rootDir,
        db: getDatabase(),
        notify: options.notify ?? (() => undefined),
      });
    },
  };
}

// Discovers `export const background` tasks from extension server modules. Shares the
// same file discovery and compilation as the action registry, so background and actions
// always come from one compiled module per file.
export function createBackgroundTaskSource(options: CreateBackgroundTaskSourceOptions): BackgroundTaskSource {
  let importVersion = 0;
  const actionRoots = options.actionRoots ?? DEFAULT_ACTION_ROOTS;

  return {
    async list() {
      const files = (
        await Promise.all(actionRoots.map((root) => discoverServerActionFiles(resolveActionRoot(options.rootDir, root))))
      ).flat();

      const loaded = await Promise.all(
        files.map(async (filePath) => {
          try {
            return await loadBackgroundTaskFile(filePath, options.rootDir, ++importVersion, options.cacheDir);
          } catch (error) {
            (options.onError ?? defaultBackgroundTaskDiscoveryError)(inferExtensionId(filePath), error);
            return null;
          }
        }),
      );
      return loaded.filter((task): task is DiscoveredBackgroundTask => task !== null);
    },
  };
}

function defaultBackgroundTaskDiscoveryError(extensionId: string, error: unknown): void {
  console.error(`[baby-menu] background task "${extensionId}" could not be loaded`, error);
}

function resolveActionRoot(rootDir: string, actionRoot: string): string {
  return isAbsolute(actionRoot) ? actionRoot : join(rootDir, actionRoot);
}

async function discoverServerActionFiles(rootDir: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(rootDir, entry.name);
      if (entry.isDirectory()) return discoverServerActionFiles(entryPath);
      if (entry.isFile() && SERVER_ACTION_FILE_PATTERN.test(entry.name)) return [entryPath];
      return [];
    }),
  );
  return files.flat().sort();
}

async function importServerModule(
  filePath: string,
  rootDir: string,
  importVersion: number,
  cacheDir?: string,
): Promise<{ extensionId: string; module: ServerActionModule }> {
  const importPath = await prepareServerActionModule(filePath, rootDir, cacheDir);
  const moduleUrl = pathToFileURL(importPath);
  moduleUrl.searchParams.set("babyMenuServerActionVersion", String(importVersion));
  const module = (await import(moduleUrl.href)) as ServerActionModule;
  const extensionId = normalizeExtensionId(module.extensionId ?? module.id) ?? inferExtensionId(filePath);
  return { extensionId, module };
}

async function loadServerActionFile(filePath: string, rootDir: string, importVersion: number, cacheDir?: string): Promise<LoadedServerAction[]> {
  const { extensionId, module } = await importServerModule(filePath, rootDir, importVersion, cacheDir);
  const actions = normalizeActions(module.actions);

  return Object.entries(actions).map(([action, handler]) => ({
    id: `${extensionId}.${action}`,
    extensionId,
    action,
    handler,
  }));
}

async function loadBackgroundTaskFile(
  filePath: string,
  rootDir: string,
  importVersion: number,
  cacheDir?: string,
): Promise<DiscoveredBackgroundTask | null> {
  const { extensionId, module } = await importServerModule(filePath, rootDir, importVersion, cacheDir);
  const background = normalizeBackgroundTask(module.background);
  if (!background) return null;

  return {
    extensionId,
    sourceFile: resolve(filePath),
    intervalMs: background.intervalMs,
    runOnStart: background.runOnStart ?? true,
    run: background.run,
  };
}

async function prepareServerActionModule(filePath: string, rootDir: string, cacheDir?: string): Promise<string> {
  const normalizedPath = resolve(filePath);
  const extensionId = inferExtensionId(normalizedPath);
  const compiled = await compileExtensionModule({
    kind: "server",
    extensionId,
    extensionDir: dirname(normalizedPath),
    entryFile: normalizedPath,
    cacheRoot: cacheDir ?? join(rootDir, ".cache", "baby-menu", "server-actions"),
  });
  return compiled.outputPath;
}

export async function rewriteLocalServerActionImports(source: string, filePath: string): Promise<string> {
  return rewriteExtensionModuleImports({
    kind: "server",
    extensionId: inferExtensionId(filePath),
    extensionDir: dirname(filePath),
    filePath,
    source,
    validateExternalImports: false,
  });
}

function normalizeExtensionId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeActions(value: unknown): Record<string, ServerActionHandler> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ServerActionHandler] => {
      const [name, handler] = entry;
      return Boolean(name.trim()) && typeof handler === "function";
    }),
  );
}

function normalizeBackgroundTask(value: unknown): BabyMenuBackgroundTask | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BabyMenuBackgroundTask>;
  if (typeof candidate.run !== "function") return null;
  if (typeof candidate.intervalMs !== "number" || !Number.isFinite(candidate.intervalMs) || candidate.intervalMs <= 0) {
    return null;
  }
  return {
    intervalMs: candidate.intervalMs,
    run: candidate.run,
    runOnStart: typeof candidate.runOnStart === "boolean" ? candidate.runOnStart : undefined,
  };
}

function inferExtensionId(filePath: string): string {
  const fileName = basename(filePath, extname(filePath));
  if (fileName === "server") return basename(dirname(filePath));
  return fileName.replace(/\.server$/, "") || relative(process.cwd(), filePath);
}
