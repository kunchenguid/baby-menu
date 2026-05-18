import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BabyMenuCapabilityDescriptor } from "../shared/contracts";
import { compileExtensionModule, rewriteExtensionModuleImports } from "./extension-module-compiler";

export type ServerActionContext = {
  rootDir: string;
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
};

type CreateServerActionRegistryOptions = {
  rootDir: string;
  actionRoots?: string[];
  cacheDir?: string;
};

const DEFAULT_ACTION_ROOTS = ["extensions"];
const SERVER_ACTION_FILE_PATTERN = /(^server|\.server)\.(mjs|js|ts)$/;

export function createServerActionRegistry(options: CreateServerActionRegistryOptions): ServerActionRegistry {
  let importVersion = 0;
  const actionRoots = options.actionRoots ?? DEFAULT_ACTION_ROOTS;

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

      return capability.handler(input, { rootDir: options.rootDir });
    },
  };
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

async function loadServerActionFile(filePath: string, rootDir: string, importVersion: number, cacheDir?: string): Promise<LoadedServerAction[]> {
  const importPath = await prepareServerActionModule(filePath, rootDir, cacheDir);
  const moduleUrl = pathToFileURL(importPath);
  moduleUrl.searchParams.set("babyMenuServerActionVersion", String(importVersion));
  const module = (await import(moduleUrl.href)) as ServerActionModule;
  const extensionId = normalizeExtensionId(module.extensionId ?? module.id) ?? inferExtensionId(filePath);
  const actions = normalizeActions(module.actions);

  return Object.entries(actions).map(([action, handler]) => ({
    id: `${extensionId}.${action}`,
    extensionId,
    action,
    handler,
  }));
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

function inferExtensionId(filePath: string): string {
  const fileName = basename(filePath, extname(filePath));
  if (fileName === "server") return basename(dirname(filePath));
  return fileName.replace(/\.server$/, "") || relative(process.cwd(), filePath);
}
