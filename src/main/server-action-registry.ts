import type { Dirent } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { BabyMenuBackgroundTask, BabyMenuCapabilityDescriptor, BabyMenuServerContext } from "../shared/contracts";
import { createExtensionDatabase, type ExtensionDatabase } from "./extension-database";
import { compileExtensionModule, rewriteExtensionModuleImports, type CompiledExtensionModule } from "./extension-module-compiler";

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
  const actionRoots = options.actionRoots ?? DEFAULT_ACTION_ROOTS;
  const loader = createServerModuleLoader({ cacheDir: options.cacheDir });
  // Share the host database with actions. Default to an in-memory store so a registry
  // can be exercised in isolation (e.g. tests) without a backing file.
  let database = options.db ?? null;
  const getDatabase = (): ExtensionDatabase => (database ??= createExtensionDatabase(":memory:"));

  const loadActions = async (): Promise<LoadedServerAction[]> => {
    const files = (
      await Promise.all(actionRoots.map((root) => discoverServerActionFiles(resolveActionRoot(options.rootDir, root))))
    ).flat();

    loader.prune(files);
    const loaded = await Promise.all(files.map((filePath) => loadServerActionFile(loader, filePath, options.rootDir)));
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
  const actionRoots = options.actionRoots ?? DEFAULT_ACTION_ROOTS;
  const loader = createServerModuleLoader({ cacheDir: options.cacheDir });

  return {
    async list() {
      const files = (
        await Promise.all(actionRoots.map((root) => discoverServerActionFiles(resolveActionRoot(options.rootDir, root))))
      ).flat();

      loader.prune(files);
      const loaded = await Promise.all(
        files.map(async (filePath) => {
          try {
            return await loadBackgroundTaskFile(loader, filePath, options.rootDir);
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

export type ServerModuleLoad = { extensionId: string; module: ServerActionModule };

export type ServerModuleLoader = {
  load: (filePath: string, rootDir: string) => Promise<ServerModuleLoad>;
  // Drop cache entries for files that are no longer present, so deleting an extension
  // does not leak its cached module forever.
  prune: (activePaths: Iterable<string>) => void;
};

type CreateServerModuleLoaderOptions = {
  cacheDir?: string;
  // Overridable for tests so the compile/import steps can be observed.
  compile?: typeof compileExtensionModule;
  importModule?: (moduleUrl: string) => Promise<unknown>;
};

type ServerModuleCacheEntry = {
  signature: string;
  sourceFiles: string[];
  result: ServerModuleLoad;
};

// Compiles, imports, and caches an extension server module per source file.
//
// The compiler is content-addressed: identical source compiles to the same module URL, and
// edited source compiles to a new one. Importing that URL therefore reuses a single module
// instance while the code is unchanged - module-scope state survives across calls - and
// loads a fresh module (with reset state) only after a real edit. This is why server actions
// must not rely on a fresh module per call, and why durable state belongs in the database.
//
// On top of that, an mtime/size signature over the module graph lets a repeated load skip
// recompiling entirely while nothing on disk has changed, so a hot path like a 1-2s view
// refresh does not re-read and re-hash every extension source on every invoke.
export function createServerModuleLoader(options: CreateServerModuleLoaderOptions = {}): ServerModuleLoader {
  const compile = options.compile ?? compileExtensionModule;
  const importModule = options.importModule ?? ((moduleUrl: string) => import(moduleUrl));
  const cache = new Map<string, ServerModuleCacheEntry>();
  const inFlight = new Map<string, Promise<ServerModuleLoad>>();
  let reloadGeneration = 0;

  return {
    async load(filePath, rootDir) {
      const normalizedPath = resolve(filePath);
      const cached = cache.get(normalizedPath);
      if (cached && (await sourceSignature(cached.sourceFiles)) === cached.signature) {
        return cached.result;
      }

      const pending = inFlight.get(normalizedPath);
      if (pending) return pending;

      const load = loadFreshServerModule(normalizedPath, rootDir)
        .then((entry) => {
          cache.set(normalizedPath, entry);
          return entry.result;
        })
        .finally(() => {
          inFlight.delete(normalizedPath);
        });
      inFlight.set(normalizedPath, load);
      return load;
    },
    prune(activePaths) {
      const active = new Set([...activePaths].map((filePath) => resolve(filePath)));
      for (const key of [...cache.keys()]) {
        if (!active.has(key)) cache.delete(key);
      }
    },
  };

  async function loadFreshServerModule(normalizedPath: string, rootDir: string): Promise<ServerModuleCacheEntry> {
    const inferredId = inferExtensionId(normalizedPath);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const generation = ++reloadGeneration;
      const compiled = await compile({
        kind: "server",
        extensionId: inferredId,
        extensionDir: dirname(normalizedPath),
        entryFile: normalizedPath,
        cacheRoot: options.cacheDir ?? join(rootDir, ".cache", "baby-menu", "server-actions"),
      });
      await prepareServerModuleGraph(compiled, dirname(normalizedPath), generation);
      const module = (await importModule(withReloadGeneration(compiled.moduleUrl, generation))) as ServerActionModule;
      const signature = await sourceSignature(compiled.sourceFiles);
      if (signature !== compiled.sourceSignature) continue;
      const extensionId = normalizeExtensionId(module.extensionId ?? module.id) ?? inferredId;
      const result: ServerModuleLoad = { extensionId, module };

      return {
        signature,
        sourceFiles: compiled.sourceFiles,
        result,
      };
    }

    throw new Error(`Server action source changed while loading ${relative(process.cwd(), normalizedPath)}`);
  }
}

function withReloadGeneration(moduleUrl: string, generation: number): string {
  const url = new URL(moduleUrl);
  url.searchParams.set("babyMenuServerActionReload", String(generation));
  return url.href;
}

async function prepareServerModuleGraph(compiled: CompiledExtensionModule, extensionDir: string, generation: number): Promise<void> {
  await Promise.all(
    compiled.sourceFiles.map(async (sourceFile) => {
      const outputPath = join(compiled.outputDir, replaceExtension(relative(extensionDir, sourceFile), ".mjs"));
      const source = await readFile(outputPath, "utf8");
      const rewritten = rewriteCompiledLocalImports(source, generation);
      if (rewritten !== source) await writeFile(outputPath, rewritten);
    }),
  );
}

const COMPILED_STATIC_IMPORT_PATTERN = /(\b(?:import|export)\b[\s\S]*?\bfrom\s*["'])([^"']+)(["'])/g;
const COMPILED_SIDE_EFFECT_IMPORT_PATTERN = /(\bimport\s*["'])([^"']+)(["'])/g;

function rewriteCompiledLocalImports(source: string, generation: number): string {
  return source
    .replace(COMPILED_STATIC_IMPORT_PATTERN, (_match, prefix: string, specifier: string, suffix: string) => {
      return `${prefix}${withLocalReloadGeneration(specifier, generation)}${suffix}`;
    })
    .replace(COMPILED_SIDE_EFFECT_IMPORT_PATTERN, (_match, prefix: string, specifier: string, suffix: string) => {
      return `${prefix}${withLocalReloadGeneration(specifier, generation)}${suffix}`;
    });
}

function withLocalReloadGeneration(specifier: string, generation: number): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  const [path, fragment = ""] = specifier.split("#", 2);
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("babyMenuServerActionReload", String(generation));
  return `${pathname}?${params.toString()}${fragment ? `#${fragment}` : ""}`;
}

function replaceExtension(filePath: string, extension: string): string {
  return filePath.slice(0, filePath.length - extname(filePath).length) + extension;
}

// A cheap fingerprint of a module graph: the size and mtime of every source file. A real
// edit always changes at least one of these, so this detects changes without reading or
// hashing file contents on every load.
async function sourceSignature(files: string[]): Promise<string> {
  const parts = await Promise.all(
    files.map(async (filePath) => {
      try {
        const stats = await stat(filePath);
        return `${filePath}:${stats.size}:${stats.mtimeMs}`;
      } catch {
        return `${filePath}:missing`;
      }
    }),
  );
  return parts.join("|");
}

async function loadServerActionFile(loader: ServerModuleLoader, filePath: string, rootDir: string): Promise<LoadedServerAction[]> {
  const { extensionId, module } = await loader.load(filePath, rootDir);
  const actions = normalizeActions(module.actions);

  return Object.entries(actions).map(([action, handler]) => ({
    id: `${extensionId}.${action}`,
    extensionId,
    action,
    handler,
  }));
}

async function loadBackgroundTaskFile(
  loader: ServerModuleLoader,
  filePath: string,
  rootDir: string,
): Promise<DiscoveredBackgroundTask | null> {
  const { extensionId, module } = await loader.load(filePath, rootDir);
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
