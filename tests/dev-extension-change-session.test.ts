import { lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DevExtensionChangeSession } from "../src/main/dev-extension-change-session";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("DevExtensionChangeSession", () => {
  it("rolls back ignored extension workspace changes to the pre-turn contents", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(join(extensionsDir, "AGENTS.md"), "rules\n");
    await writeFile(join(extensionsDir, "existing.txt"), "before\n");

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));
    await writeFile(join(extensionsDir, "existing.txt"), "after\n");
    await mkdir(join(extensionsDir, "demo"));
    await writeFile(join(extensionsDir, "demo", "widget.tsx"), "export const widget = true;\n");

    const result = await session.rollback();

    expect(result.ok).toBe(true);
    await expect(readFile(join(extensionsDir, "existing.txt"), "utf8")).resolves.toBe("before\n");
    await expect(readFile(join(extensionsDir, "AGENTS.md"), "utf8")).resolves.toBe("rules\n");
    await expect(pathExists(join(extensionsDir, "demo"))).resolves.toBe(false);
  });

  it("restores contents through a symlinked extensions dir without replacing the symlink", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const realDir = join(rootDir, "real-extensions");
    await mkdir(realDir, { recursive: true });
    await writeFile(join(realDir, "existing.txt"), "before\n");
    // The workspace path is a symlink into a separate, portable location (e.g. a
    // dotfiles repo managed by home-manager). Rollback must restore contents
    // through the link, never replace the link with a plain directory.
    const extensionsDir = join(rootDir, "extensions-link");
    await symlink(realDir, extensionsDir);

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));
    await writeFile(join(extensionsDir, "existing.txt"), "after\n");
    await mkdir(join(extensionsDir, "demo"));
    await writeFile(join(extensionsDir, "demo", "widget.tsx"), "export const widget = true;\n");

    const result = await session.rollback();

    expect(result.ok).toBe(true);
    expect((await lstat(extensionsDir)).isSymbolicLink()).toBe(true);
    await expect(readFile(join(extensionsDir, "existing.txt"), "utf8")).resolves.toBe("before\n");
    await expect(pathExists(join(extensionsDir, "demo"))).resolves.toBe(false);
    // The restore reached the real target, so the portable copy stays in sync.
    await expect(readFile(join(realDir, "existing.txt"), "utf8")).resolves.toBe("before\n");
  });

  it("never reverts or deletes a .git directory inside the workspace on rollback", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, ".git"), { recursive: true });
    await writeFile(join(extensionsDir, ".git", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(extensionsDir, "existing.txt"), "before\n");

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));
    // Simulate the user's own VCS moving forward during the turn, alongside a
    // real extension edit the rollback should revert.
    await writeFile(join(extensionsDir, ".git", "HEAD"), "ref: refs/heads/feature\n");
    await writeFile(join(extensionsDir, "existing.txt"), "after\n");

    const result = await session.rollback();

    expect(result.ok).toBe(true);
    await expect(readFile(join(extensionsDir, "existing.txt"), "utf8")).resolves.toBe("before\n");
    await expect(readFile(join(extensionsDir, ".git", "HEAD"), "utf8")).resolves.toBe("ref: refs/heads/feature\n");
  });

  it("ignores .git metadata when detecting changes", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, ".git"), { recursive: true });
    await writeFile(join(extensionsDir, ".git", "HEAD"), "a\n");
    await mkdir(join(extensionsDir, "alpha"), { recursive: true });
    await writeFile(join(extensionsDir, "alpha", "widget.tsx"), "export const widget = 1;\n");

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));
    await writeFile(join(extensionsDir, ".git", "HEAD"), "b\n");

    expect(await session.hasChanges()).toBe(false);
    expect(await session.describeChanges()).toEqual([]);
  });

  it("classifies created, updated, and removed extensions from the snapshot diff", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, "alpha"), { recursive: true });
    await writeFile(join(extensionsDir, "alpha", "widget.tsx"), "export const widget = 1;\n");
    await mkdir(join(extensionsDir, "gamma"), { recursive: true });
    await writeFile(join(extensionsDir, "gamma", "widget.tsx"), "export const widget = 3;\n");
    await mkdir(join(extensionsDir, "recipes"), { recursive: true });
    await writeFile(join(extensionsDir, "AGENTS.md"), "rules\n");

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));

    // Update an existing extension, create a new one, remove another, and touch a
    // non-extension file plus a recipe (neither should be reported).
    await writeFile(join(extensionsDir, "alpha", "widget.tsx"), "export const widget = 2;\n");
    await mkdir(join(extensionsDir, "beta"), { recursive: true });
    await writeFile(join(extensionsDir, "beta", "widget.tsx"), "export const widget = 9;\n");
    await rm(join(extensionsDir, "gamma"), { recursive: true, force: true });
    await writeFile(join(extensionsDir, "AGENTS.md"), "edited rules\n");
    await writeFile(join(extensionsDir, "recipes", "demo.html"), "<h1>Demo</h1>\n");

    const changes = await session.describeChanges();

    expect(changes).toEqual([
      { type: "extension", extensionId: "alpha", kind: "updated" },
      { type: "extension", extensionId: "beta", kind: "created" },
      { type: "extension", extensionId: "gamma", kind: "removed" },
    ]);
  });

  it("classifies a root layout.tsx edit as a layout change, not an extension", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(join(extensionsDir, "layout.tsx"), "export default function L() { return null; }\n");

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));
    await writeFile(join(extensionsDir, "layout.tsx"), "export default function L() { return <div />; }\n");

    expect(await session.describeChanges()).toEqual([{ type: "layout", kind: "updated" }]);
    expect(await session.hasChanges()).toBe(true);
  });

  it("reports no changes when the agent edited nothing", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, "alpha"), { recursive: true });
    await writeFile(join(extensionsDir, "alpha", "widget.tsx"), "export const widget = 1;\n");

    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));

    expect(await session.hasChanges()).toBe(false);
    expect(await session.describeChanges()).toEqual([]);
  });

  it("treats keep as accepting dev extension changes without creating a git commit", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-dev-extension-session-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(extensionsDir, { recursive: true });
    const session = await DevExtensionChangeSession.begin(extensionsDir, join(rootDir, ".cache", "snapshots"));
    await writeFile(join(extensionsDir, "new-widget.tsx"), "export const widget = true;\n");

    const result = await session.save();

    expect(result).toEqual({ ok: true });
    await expect(readFile(join(extensionsDir, "new-widget.tsx"), "utf8")).resolves.toContain("widget");
    expect(session.canRollback).toBe(false);
  });
});
