import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// "layout" is the root layout.tsx module; it is a React surface with the exact
// same import rules as a widget (react, react/jsx-runtime, @babymenu/ui), so it
// shares the widget rewrite path.
export type ExtensionModuleKind = "widget" | "server" | "layout";

export type CompileExtensionModuleOptions = {
  kind: ExtensionModuleKind;
  extensionId: string;
  extensionDir: string;
  entryFile: string;
  cacheRoot: string;
};

export type CompiledExtensionModule = {
  hash: string;
  outputDir: string;
  outputPath: string;
  moduleUrl: string;
  // Absolute paths of every source file in the compiled module graph (entry plus local
  // imports). Callers use these to detect edits cheaply via mtime/size before recompiling.
  sourceFiles: string[];
  sourceSignature: string;
};

type SourceModule = {
  filePath: string;
  source: string;
  signature: string;
};

type ResolvedLocalImport = {
  path: string;
};

// Host-provided design system. Widgets import this bare specifier; it is
// rewritten to the host protocol so Radix/cva/lucide stay inside the host
// bundle and never reach the widget compiler. Mirrors how `react` is handled.
export const UI_IMPORT_SPECIFIER = "@babymenu/ui";

const LOCAL_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs"];
const STATIC_IMPORT_PATTERN = /(\b(?:import|export)\b[\s\S]*?\bfrom\s*["'])([^"']+)(["'])/g;
const SIDE_EFFECT_IMPORT_PATTERN = /(\bimport\s*["'])([^"']+)(["'])/g;
const HASH_LENGTH = 16;

export async function compileExtensionModule(options: CompileExtensionModuleOptions): Promise<CompiledExtensionModule> {
  const extensionDir = resolve(options.extensionDir);
  const entryFile = resolve(options.entryFile);
  assertInsideExtension(extensionDir, entryFile, options.extensionId);

  const graph = await collectModuleGraph({
    kind: options.kind,
    extensionId: options.extensionId,
    extensionDir,
    entryFile,
  });
  const hash = contentHash(graph, extensionDir, options.kind);
  const cacheRoot = resolve(options.cacheRoot);
  const extensionCacheDir = resolve(cacheRoot, options.extensionId);
  assertInsideCache(cacheRoot, extensionCacheDir, options.extensionId);
  await assertSafeCacheParent(extensionCacheDir);
  const outputDir = join(extensionCacheDir, hash);
  const outputPath = compiledOutputPath(outputDir, extensionDir, entryFile);
  const sourceFiles = graph.map((module) => module.filePath);
  const sourceSignature = graph.map((module) => module.signature).join("|");

  const outputs = await Promise.all(
    graph.map(async (module) => ({
      outputPath: compiledOutputPath(outputDir, extensionDir, module.filePath),
      output: await transpileAndRewriteModule({
        kind: options.kind,
        extensionId: options.extensionId,
        extensionDir,
        filePath: module.filePath,
        source: module.source,
      }),
    })),
  );

  const cacheMatches = await Promise.all(
    outputs.map(async ({ outputPath, output }) => {
      try {
        if (!(await isSafeCachedOutput(outputDir, outputPath))) return false;
        return (await readFile(outputPath, "utf8")) === output;
      } catch {
        return false;
      }
    }),
  );

  if (cacheMatches.some((matches) => !matches)) {
    await rm(outputDir, { recursive: true, force: true });
    await Promise.all(
      outputs.map(async ({ outputPath, output }) => {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output);
      }),
    );
  }

  return {
    hash,
    outputDir,
    outputPath,
    moduleUrl: pathToFileURL(outputPath).href,
    sourceFiles,
    sourceSignature,
  };
}

async function assertSafeCacheParent(extensionCacheDir: string): Promise<void> {
  try {
    const details = await lstat(extensionCacheDir);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Extension cache path is not a safe directory: ${extensionCacheDir}`);
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    await mkdir(extensionCacheDir, { recursive: true });
    const details = await lstat(extensionCacheDir);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`Extension cache path is not a safe directory: ${extensionCacheDir}`);
    }
  }
}

async function isSafeCachedOutput(outputDir: string, outputPath: string): Promise<boolean> {
  const relativePath = relative(outputDir, outputPath);
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  let currentPath = outputDir;
  for (const [index, part] of parts.entries()) {
    const details = await lstat(currentPath);
    if (!details.isDirectory() || details.isSymbolicLink()) return false;
    currentPath = join(currentPath, part);
    if (index === parts.length - 1) {
      const outputDetails = await lstat(currentPath);
      return outputDetails.isFile() && !outputDetails.isSymbolicLink();
    }
  }
  return false;
}

function assertInsideCache(cacheRoot: string, candidate: string, extensionId: string): void {
  const relativePath = relative(cacheRoot, candidate);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Extension cache path escapes cache root for ${extensionId}`);
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function rewriteExtensionModuleImports(options: {
  kind: ExtensionModuleKind;
  extensionId: string;
  extensionDir: string;
  filePath: string;
  source: string;
  validateExternalImports?: boolean;
}): Promise<string> {
  const extensionDir = resolve(options.extensionDir);
  const filePath = resolve(options.filePath);
  const replacements = await Promise.all(
    importSpecifierMatches(options.source).map(async (match) => {
      const rewritten = await rewriteImportSpecifier({
        kind: options.kind,
        extensionId: options.extensionId,
        extensionDir,
        filePath,
        specifier: match.specifier,
        validateExternalImports: options.validateExternalImports ?? true,
      });
      if (rewritten === match.specifier) return null;
      return { start: match.start, end: match.end, value: rewritten };
    }),
  );

  return applyReplacements(options.source, replacements.filter((replacement) => replacement !== null));
}

async function collectModuleGraph(options: {
  kind: ExtensionModuleKind;
  extensionId: string;
  extensionDir: string;
  entryFile: string;
}): Promise<SourceModule[]> {
  const modules = new Map<string, SourceModule>();

  async function visit(filePath: string) {
    const normalizedPath = resolve(filePath);
    if (modules.has(normalizedPath)) return;
    assertInsideExtension(options.extensionDir, normalizedPath, options.extensionId);

    const { source, signature } = await readStableSource(normalizedPath);
    modules.set(normalizedPath, { filePath: normalizedPath, source, signature });

    const dependencies = await Promise.all(
      importSpecifierMatches(source, { includeTypeOnly: false }).map(async (match) => {
        if (!isLocalSpecifier(match.specifier)) {
          assertSupportedExternalImport(options.kind, match.specifier, options.extensionId, options.extensionDir, normalizedPath);
          return null;
        }
        return resolveLocalImport(normalizedPath, match.specifier, options.extensionDir, options.extensionId);
      }),
    );
    await Promise.all(dependencies.filter((dependency): dependency is ResolvedLocalImport => Boolean(dependency)).map((dependency) => visit(dependency.path)));
  }

  await visit(options.entryFile);
  return [...modules.values()].sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function readStableSource(filePath: string): Promise<{ source: string; signature: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const before = await stat(filePath);
    const source = await readFile(filePath, "utf8");
    const after = await stat(filePath);
    if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
      return { source, signature: `${filePath}:${after.size}:${after.mtimeMs}` };
    }
  }
  throw new Error(`Source changed while reading ${filePath}`);
}

async function transpileAndRewriteModule(options: {
  kind: ExtensionModuleKind;
  extensionId: string;
  extensionDir: string;
  filePath: string;
  source: string;
}) {
  const transpiled = ts.transpileModule(options.source, {
    fileName: options.filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      sourceMap: false,
    },
  }).outputText;

  return rewriteExtensionModuleImports({ ...options, source: transpiled, validateExternalImports: true });
}

async function rewriteImportSpecifier(options: {
  kind: ExtensionModuleKind;
  extensionId: string;
  extensionDir: string;
  filePath: string;
  specifier: string;
  validateExternalImports: boolean;
}): Promise<string> {
  if (!isLocalSpecifier(options.specifier)) {
    if (options.kind === "widget" || options.kind === "layout") return rewriteWidgetExternalImport(options);
    if (options.validateExternalImports) {
      assertSupportedExternalImport(options.kind, options.specifier, options.extensionId, options.extensionDir, options.filePath);
    }
    return options.specifier;
  }

  const resolved = await resolveLocalImport(options.filePath, options.specifier, options.extensionDir, options.extensionId);
  return relativeModuleSpecifier(options.filePath, resolved.path, options.extensionDir);
}

function rewriteWidgetExternalImport(options: {
  extensionId: string;
  extensionDir: string;
  filePath: string;
  specifier: string;
  validateExternalImports: boolean;
}): string {
  if (options.specifier === "react") return "baby-menu-host://react/index.mjs";
  if (options.specifier === "react/jsx-runtime" || options.specifier === "react/jsx-dev-runtime") {
    return "baby-menu-host://react-jsx-runtime/index.mjs";
  }
  if (options.specifier === UI_IMPORT_SPECIFIER) return "baby-menu-host://ui/index.mjs";
  if (options.validateExternalImports) {
    assertSupportedExternalImport("widget", options.specifier, options.extensionId, options.extensionDir, options.filePath);
  }
  return options.specifier;
}

function assertSupportedExternalImport(
  kind: ExtensionModuleKind,
  specifier: string,
  extensionId: string,
  extensionDir: string,
  filePath: string,
) {
  if (
    (kind === "widget" || kind === "layout") &&
    (specifier === "react" ||
      specifier === "react/jsx-runtime" ||
      specifier === "react/jsx-dev-runtime" ||
      specifier === UI_IMPORT_SPECIFIER)
  ) {
    return;
  }
  if (kind === "server" && (specifier.startsWith("node:") || builtinModules.includes(specifier))) return;

  throw new Error(
    `Unsupported ${kind} import "${specifier}" in ${formatExtensionPath(extensionId, extensionDir, filePath)}`,
  );
}

async function resolveLocalImport(
  filePath: string,
  specifier: string,
  extensionDir: string,
  extensionId: string,
): Promise<ResolvedLocalImport> {
  const basePath = resolve(dirname(filePath), specifier);
  assertInsideExtension(extensionDir, basePath, extensionId, "Local import escapes extension workspace");

  const candidates = extname(specifier)
    ? [basePath]
    : [...LOCAL_EXTENSIONS.map((extension) => `${basePath}${extension}`), ...LOCAL_EXTENSIONS.map((extension) => join(basePath, `index${extension}`))];

  for (const candidate of candidates) {
    try {
      const source = await readFile(candidate, "utf8");
      void source;
      return { path: resolve(candidate) };
    } catch {
      // Try the next import candidate.
    }
  }

  throw new Error(`Cannot resolve local import "${specifier}" in ${formatExtensionPath(extensionId, extensionDir, filePath)}`);
}

function compiledOutputPath(outputDir: string, extensionDir: string, filePath: string): string {
  return join(outputDir, replaceExtension(relative(extensionDir, filePath), ".mjs"));
}

function relativeModuleSpecifier(fromFile: string, toFile: string, extensionDir: string): string {
  const fromOutput = replaceExtension(relative(extensionDir, fromFile), ".mjs");
  const toOutput = replaceExtension(relative(extensionDir, toFile), ".mjs");
  let specifier = relative(dirname(fromOutput), toOutput).split("\\").join("/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return specifier;
}

function replaceExtension(filePath: string, extension: string): string {
  return filePath.slice(0, filePath.length - extname(filePath).length) + extension;
}

function contentHash(modules: SourceModule[], extensionDir: string, kind: ExtensionModuleKind): string {
  const hash = createHash("sha256");
  hash.update(`${kind}\0`);
  for (const module of modules) {
    hash.update(relative(extensionDir, module.filePath));
    hash.update("\0");
    hash.update(module.source);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, HASH_LENGTH);
}

function importSpecifierMatches(source: string, options: { includeTypeOnly?: boolean } = {}): Array<{ specifier: string; start: number; end: number }> {
  const matches = [
    ...matchesForPattern(source, STATIC_IMPORT_PATTERN, options),
    ...matchesForPattern(source, SIDE_EFFECT_IMPORT_PATTERN),
  ];
  return matches.sort((left, right) => left.start - right.start);
}

function matchesForPattern(
  source: string,
  pattern: RegExp,
  options: { includeTypeOnly?: boolean } = {},
): Array<{ specifier: string; start: number; end: number }> {
  return [...source.matchAll(pattern)].flatMap((match) => {
    if (!options.includeTypeOnly && isTypeOnlyImport(match[0])) return [];
    const specifier = match[2];
    const start = (match.index ?? 0) + match[1].length;
    return [{ specifier, start, end: start + specifier.length }];
  });
}

function isTypeOnlyImport(statement: string): boolean {
  if (/^\s*(?:import|export)\s+type\b/.test(statement)) return true;
  const namedImport = statement.match(/^\s*(?:import|export)\s*\{([\s\S]*?)\}\s*from\s*["']/);
  if (!namedImport) return false;
  return namedImport[1]
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean)
    .every((specifier) => specifier.startsWith("type "));
}

function applyReplacements(source: string, replacements: Array<{ start: number; end: number; value: string }>): string {
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce((current, replacement) => {
      return `${current.slice(0, replacement.start)}${replacement.value}${current.slice(replacement.end)}`;
    }, source);
}

function assertInsideExtension(extensionDir: string, filePath: string, extensionId: string, message = "Extension path escapes workspace") {
  const relativePath = relative(extensionDir, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${message}: ${formatExtensionPath(extensionId, extensionDir, filePath)}`);
  }
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function formatExtensionPath(extensionId: string, extensionDir: string, filePath: string): string {
  const relativePath = relative(extensionDir, filePath).split("\\").join("/");
  return `${extensionId}/${relativePath}`;
}
