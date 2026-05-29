import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension layout", () => {
  it("keeps the hello world widget in the repo-level extensions directory", async () => {
    const dir = resolve(import.meta.dirname, "../extensions/hello-world");
    const widget = await readFile(resolve(dir, "widget.tsx"), "utf8");
    // The widget entry exports the descriptor and renders the view from
    // components.tsx (split so UI edits hot reload while preserving state).
    const components = await readFile(resolve(dir, "components.tsx"), "utf8");

    expect(widget).toContain("helloWorldWidget");
    expect(widget).toContain("RefreshableBabyMenuWidget");
    expect(widget).toContain("HelloWorldView");
    expect(widget).toContain("./components");
    // The descriptor module exports only the descriptor - the React components
    // live in components.tsx so the entry stays Fast-Refresh-neutral.
    expect(widget).not.toContain("function HelloWorldView");

    // The starter components exemplify the design system via token utilities.
    expect(components).toContain("export function HelloWorldView");
    expect(components).toContain("hello world");
    expect(components).toContain("tell baby menu what you would like it to become");
    expect(components).toContain("text-3xl");
    expect(components).toContain("text-signal-live");
    expect(components).toContain("examples");
    expect(components).toContain("add a widget tracking my weekly claude code quota");
    expect(components).not.toContain("quick asks");
    expect(components).not.toContain("className=\"src\"");
    // Migrated off legacy inline token styles.
    expect(components).not.toContain("var(--fs-");
  });

  it("documents extension authoring separately from core development", async () => {
    const instructions = await readFile(resolve(import.meta.dirname, "../extensions/AGENTS.md"), "utf8");

    expect(instructions).toContain("self-contained baby-menu extensions");
    expect(instructions).toContain("widget.tsx");
    expect(instructions).toContain("server.ts");
    expect(instructions).toContain("window.babyMenu.capabilities.invoke");
    expect(instructions).toContain("Do not modify files outside this directory");
    expect(instructions).toContain("recipes/*.html");
    expect(instructions).toContain("Read the matching recipe before implementing");
    expect(instructions).toContain("rootDir` is Baby Menu's app-data root");
    expect(instructions).not.toContain("rootDir` is the active extension workspace root");
  });

  it("steers extension agents to real data and to verify dependencies via web search", async () => {
    const instructions = await readFile(resolve(import.meta.dirname, "../extensions/AGENTS.md"), "utf8");

    // Real data only - no silent mock fallback (mirrors the quota recipes).
    expect(instructions).toContain("do not fabricate or silently fall back to mock data");
    // Encourage confirming current dependency / API details rather than guessing.
    expect(instructions).toContain("use web search to confirm the latest information");
  });

  it("tells extension agents not to write tests or documentation", async () => {
    const instructions = await readFile(resolve(import.meta.dirname, "../extensions/AGENTS.md"), "utf8");

    // Extensions are verified live in the popover; tests/docs slow iteration
    // without enough payoff in this workflow.
    expect(instructions).toContain("Do not write tests or documentation");
    expect(instructions).toContain("verified live through the Baby Menu UI");
    expect(instructions).toContain("Do not create `*.test.ts`");
    expect(instructions).toContain("Do not create `README.md`");
    // The old guidance told agents to colocate tests; that policy is gone.
    expect(instructions).not.toContain("Colocate tests inside your extension directory");
    expect(instructions).not.toContain("Use TDD for behavior changes");
  });

  it("exposes runtime widget design guidance to extension agents", async () => {
    const instructions = await readFile(resolve(import.meta.dirname, "../extensions/AGENTS.md"), "utf8");

    expect(instructions).toContain("Monochrome Lab");
    expect(instructions).toContain("Design for a 504px macOS tray popover");
    // The design system is delivered as components, not a wall of CSS classes.
    expect(instructions).toContain("@babymenu/ui");
    expect(instructions).toContain("DataTable");
    expect(instructions).toContain("StatusDot");
    expect(instructions).toContain("Progress");
    expect(instructions).toContain("Field");
    // Tailwind guidance prefers tokens while allowing rare arbitrary-color exceptions.
    expect(instructions).toContain("bg-red-500");
    expect(instructions).toContain("Prefer Baby Menu token utilities for color");
    expect(instructions).toContain("Use arbitrary color values only when a widget genuinely needs them");
    expect(instructions).toContain("text-signal-live");
    expect(instructions).toContain("font-mono");
    expect(instructions).toContain("Readable hierarchy");
    expect(instructions).toContain("Onboarding widgets are not data widgets");
    expect(instructions).toContain("Example prompts should be complete pasteable user asks");
    expect(instructions).toContain("Do not add gradients, emoji");
    expect(instructions).toContain("The host hides `hello-world` automatically once real widgets are discovered");
    expect(instructions).not.toContain("Remove the `hello-world` starter widget");
    // The old CSS-class catalogue is gone in favor of components + tokens.
    expect(instructions).not.toContain("Public widget classes available to widgets");
    expect(instructions).not.toContain("off-brand colors literally do not exist");
  });

  it("keeps the dev extension workspace out of git", async () => {
    const gitignore = await readFile(resolve(import.meta.dirname, "../.gitignore"), "utf8");

    expect(gitignore).toContain("extensions-dev/");
  });
});
