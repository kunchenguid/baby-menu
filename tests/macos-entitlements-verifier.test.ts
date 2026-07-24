import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const verifier = resolve(import.meta.dirname, "../scripts/verify-macos-entitlements.py");
const jitOnlyCodesignOutput = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>`;

async function verifyEntitlements(
  contents: string | Buffer,
  options: { requireJit?: boolean; codeObject?: string } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "baby-menu-entitlements-"));
  const entitlementsPath = join(directory, "entitlements.plist");
  await writeFile(entitlementsPath, contents);
  try {
    return await execFileAsync("python3", [
      verifier,
      entitlementsPath,
      options.codeObject ?? "/Baby Menu.app/Contents/MacOS/Baby Menu",
      ...(options.requireJit ? ["--require-jit"] : []),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("macOS effective entitlement verifier", () => {
  it("accepts the exact empty output emitted for Electron Framework", async () => {
    await expect(verifyEntitlements(Buffer.alloc(0), {
      codeObject: "/Baby Menu.app/Contents/Frameworks/Electron Framework.framework",
    })).resolves.toBeDefined();
  });

  it("accepts the exact XML output emitted for a JIT-only code object", async () => {
    await expect(verifyEntitlements(jitOnlyCodesignOutput, { requireJit: true })).resolves.toBeDefined();
  });

  it("rejects malformed non-empty codesign output", async () => {
    await expect(verifyEntitlements("not a plist")).rejects.toMatchObject({
      stderr: expect.stringContaining("Malformed entitlements"),
    });
  });

  it("rejects unexpected effective entitlements", async () => {
    const unexpected = jitOnlyCodesignOutput.replace(
      "</dict>",
      "<key>com.apple.security.cs.disable-library-validation</key><true/></dict>",
    );

    await expect(verifyEntitlements(unexpected)).rejects.toMatchObject({
      stderr: expect.stringContaining("Unexpected entitlements"),
    });
  });

  it("rejects the allowed JIT entitlement unless its value is exactly true", async () => {
    const disabledJit = jitOnlyCodesignOutput.replace("<true/>", "<false/>");

    await expect(verifyEntitlements(disabledJit)).rejects.toMatchObject({
      stderr: expect.stringContaining("com.apple.security.cs.allow-jit must be true"),
    });
  });

  it("rejects a no-entitlement object when JIT is required", async () => {
    await expect(verifyEntitlements(Buffer.alloc(0), { requireJit: true })).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing required com.apple.security.cs.allow-jit entitlement"),
    });
  });

  it("rejects unreadable entitlement data", async () => {
    await expect(execFileAsync("python3", [
      verifier,
      "/path/that/does/not/exist",
      "/Baby Menu.app/Contents/MacOS/Baby Menu",
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining("Could not read entitlements"),
    });
  });
});
