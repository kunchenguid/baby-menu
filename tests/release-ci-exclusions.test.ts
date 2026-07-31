import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = join(root, ".github", "workflows");

/**
 * Derive the exact release-please output set from config + workflow inputs.
 * Keep this aligned with the fleet audit rule in firstmate's release-please CI
 * report: node -> package.json (+ package-lock.json if present), changelog,
 * extra-files, and the manifest path.
 */
function expectedReleaseOutputs(): string[] {
  const config = JSON.parse(
    readFileSync(join(root, "release-please-config.json"), "utf8"),
  ) as {
    "release-type"?: string;
    "changelog-path"?: string;
    "version-file"?: string;
    "extra-files"?: Array<string | { path?: string }>;
    packages?: Record<
      string,
      {
        "release-type"?: string;
        "changelog-path"?: string;
        "version-file"?: string;
        "extra-files"?: Array<string | { path?: string }>;
      }
    >;
  };
  const pkg = config.packages?.["."] ?? {};
  const releaseType = pkg["release-type"] ?? config["release-type"] ?? "node";
  const changelog =
    pkg["changelog-path"] ?? config["changelog-path"] ?? "CHANGELOG.md";

  const expected: string[] = [changelog];
  switch (releaseType) {
    case "simple":
      expected.push(
        pkg["version-file"] ?? config["version-file"] ?? "version.txt",
      );
      break;
    case "node":
      expected.push("package.json");
      if (existsSync(join(root, "package-lock.json"))) {
        expected.push("package-lock.json");
      }
      break;
    case "go":
      break;
    default:
      throw new Error(
        `unsupported release-please release-type for ignore derivation: ${releaseType}`,
      );
  }

  const extra = pkg["extra-files"] ?? config["extra-files"] ?? [];
  for (const entry of extra) {
    const path = typeof entry === "string" ? entry : entry?.path;
    if (path) expected.push(path);
  }

  let manifest = ".release-please-manifest.json";
  const releaseWorkflow = readFileSync(
    join(workflowsDir, "release-please.yml"),
    "utf8",
  );
  const manifestMatch = releaseWorkflow.match(/manifest-file:\s*(\S+)/);
  if (manifestMatch) manifest = manifestMatch[1];
  expected.push(manifest);

  return [...new Set(expected)];
}

type PullRequestFilter =
  | { kind: "missing" }
  | { kind: "unfiltered" }
  | { kind: "paths-ignore"; paths: string[] }
  | { kind: "paths"; paths: string[] };

/**
 * Extract the pull_request filter from a workflow without a YAML dependency.
 * Supports the shapes used in this repository: branches, types, paths-ignore,
 * and paths (including later !negations).
 */
function pullRequestFilterCoverage(source: string): PullRequestFilter {
  const lines = source.split("\n");
  let prIndent: number | null = null;
  const body: string[] = [];

  for (const line of lines) {
    if (prIndent === null) {
      const header = line.match(/^([ \t]*)pull_request:\s*(.*)$/);
      if (!header) continue;
      // Bare `pull_request:` (no inline mapping) starts a block we collect next.
      if (header[2].trim() !== "" && header[2].trim() !== "|") {
        // Flow-style mapping on one line - treat as unfiltered for our shapes.
        return { kind: "unfiltered" };
      }
      prIndent = header[1].length;
      continue;
    }

    if (line.trim() === "") {
      body.push(line);
      continue;
    }

    const indent = line.match(/^([ \t]*)/)?.[1].length ?? 0;
    if (indent <= prIndent) break;
    body.push(line);
  }

  if (prIndent === null) return { kind: "missing" };
  if (body.every((line) => line.trim() === "")) return { kind: "unfiltered" };

  const listUnder = (key: string): string[] | null => {
    const paths: string[] = [];
    let collecting = false;
    let keyIndent = -1;
    for (const line of body) {
      if (!collecting) {
        const keyMatch = line.match(new RegExp(`^([ \\t]+)${key}:\\s*$`));
        if (!keyMatch) continue;
        collecting = true;
        keyIndent = keyMatch[1].length;
        continue;
      }
      if (line.trim() === "") continue;
      const indent = line.match(/^([ \\t]*)/)?.[1].length ?? 0;
      if (indent <= keyIndent) break;
      const item = line.match(/^[ \t]+-[ \t]*(.+?)\s*$/)?.[1];
      if (!item) break;
      paths.push(item.replace(/^['"]|['"]$/g, ""));
    }
    return collecting ? paths : null;
  };

  const pathsIgnore = listUnder("paths-ignore");
  if (pathsIgnore) {
    return { kind: "paths-ignore", paths: pathsIgnore };
  }

  const paths = listUnder("paths");
  if (paths) {
    return { kind: "paths", paths };
  }

  return { kind: "unfiltered" };
}

function globMatch(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE::/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function isCovered(filter: PullRequestFilter, releasePath: string): boolean {
  if (filter.kind === "missing" || filter.kind === "unfiltered") return false;

  if (filter.kind === "paths-ignore") {
    return filter.paths.some(
      (pattern) => pattern === releasePath || globMatch(pattern, releasePath),
    );
  }

  let matched = false;
  for (const pattern of filter.paths) {
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1);
      if (
        matched &&
        (negated === releasePath || globMatch(negated, releasePath))
      ) {
        matched = false;
      }
      continue;
    }
    if (pattern === releasePath || globMatch(pattern, releasePath)) {
      matched = true;
    }
  }
  return !matched;
}

/** Offline GitHub paths-ignore simulation: true when every path is ignored. */
function allPathsIgnored(ignorePatterns: string[], paths: string[]): boolean {
  return paths.every((path) =>
    ignorePatterns.some(
      (pattern) => pattern === path || globMatch(pattern, path),
    ),
  );
}

describe("release-please CI exclusions", () => {
  const expected = expectedReleaseOutputs();

  it("derives the node release-output set for this repository", () => {
    expect(expected).toEqual([
      "CHANGELOG.md",
      "package.json",
      ".release-please-manifest.json",
    ]);
  });

  it("every pull_request workflow ignores the full release-output set", () => {
    const files = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );
    const prWorkflows: { name: string; filter: PullRequestFilter }[] = [];

    for (const name of files) {
      const source = readFileSync(join(workflowsDir, name), "utf8");
      const filter = pullRequestFilterCoverage(source);
      if (filter.kind === "missing") continue;
      prWorkflows.push({ name, filter });
    }

    expect(prWorkflows.map((workflow) => workflow.name).sort()).toEqual([
      "ci.yml",
      "guard-generated-files.yml",
      "no-mistakes-required.yml",
    ]);

    const failures: string[] = [];
    for (const { name, filter } of prWorkflows) {
      const missing = expected.filter((path) => !isCovered(filter, path));
      if (missing.length > 0) {
        failures.push(`${name} missing coverage for: ${missing.join(", ")}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("does not attach path filters to non-pull_request triggers on ci.yml", () => {
    const source = readFileSync(join(workflowsDir, "ci.yml"), "utf8");
    expect(source).toContain("push:\n    branches: [main]");
    expect(source).not.toContain("workflow_dispatch:");
    expect(source).not.toMatch(/^ {2}release:/m);

    const filter = pullRequestFilterCoverage(source);
    expect(filter).toEqual({
      kind: "paths-ignore",
      paths: [
        ".release-please-manifest.json",
        "CHANGELOG.md",
        "package.json",
      ],
    });
  });

  it("keeps bot author exemptions on guard and no-mistakes jobs", () => {
    const guard = readFileSync(
      join(workflowsDir, "guard-generated-files.yml"),
      "utf8",
    );
    const nmr = readFileSync(
      join(workflowsDir, "no-mistakes-required.yml"),
      "utf8",
    );
    expect(guard).toContain("github-actions[bot]");
    expect(guard).toContain("release-please[bot]");
    expect(nmr).toContain("github-actions[bot]");
    expect(nmr).toContain("dependabot[bot]");
    expect(nmr).toContain("release-please[bot]");
  });

  it("offline path filter matches the latest release PR and still runs for human PRs", () => {
    const ignore = [
      ".release-please-manifest.json",
      "CHANGELOG.md",
      "package.json",
    ];

    // Latest real release PR (#97) file set.
    expect(
      allPathsIgnored(ignore, [
        ".release-please-manifest.json",
        "CHANGELOG.md",
        "package.json",
      ]),
    ).toBe(true);

    // Representative human PRs always include at least one non-release path.
    expect(
      allPathsIgnored(ignore, [
        ".github/workflows/release-please.yml",
        "tests/release-config.test.ts",
        "CONTRIBUTING.md",
      ]),
    ).toBe(false);
    expect(
      allPathsIgnored(ignore, [
        "electron-builder.yml",
        "package.json",
        "pnpm-lock.yaml",
        "src/main/app-paths.ts",
      ]),
    ).toBe(false);
    expect(
      allPathsIgnored(ignore, [
        "AGENTS.md",
        "README.md",
        "extensions/babymenu-env.d.ts",
      ]),
    ).toBe(false);
  });
});
