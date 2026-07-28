import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyLinuxAutostart,
  linuxAutostartEntry,
  linuxAutostartExecPath,
  linuxAutostartFilePath,
} from "../src/main/linux-autostart";

describe("linux autostart", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "baby-menu-autostart-"));
    tempDirs.push(dir);
    return dir;
  }

  it("uses the XDG autostart location", () => {
    expect(linuxAutostartFilePath("/home/test-user")).toBe("/home/test-user/.config/autostart/baby-menu.desktop");
  });

  it("prefers $APPIMAGE over the extracted executable path", () => {
    expect(linuxAutostartExecPath({ APPIMAGE: "/home/test-user/Apps/Baby-Menu.AppImage" }, "/tmp/.mount_x/baby-menu")).toBe(
      "/home/test-user/Apps/Baby-Menu.AppImage",
    );
    expect(linuxAutostartExecPath({}, "/usr/bin/baby-menu")).toBe("/usr/bin/baby-menu");
    expect(linuxAutostartExecPath({ APPIMAGE: "   " }, "/usr/bin/baby-menu")).toBe("/usr/bin/baby-menu");
  });

  it("writes a desktop entry the session manager will honor", () => {
    expect(linuxAutostartEntry("/usr/bin/baby-menu")).toBe(
      [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Baby Menu",
        "Exec=/usr/bin/baby-menu",
        "Terminal=false",
        "X-GNOME-Autostart-enabled=true",
        "",
      ].join("\n"),
    );
  });

  it("creates the entry, including the autostart directory", async () => {
    const home = await tempHome();
    const filePath = linuxAutostartFilePath(home);

    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", true);

    await expect(readFile(filePath, "utf8")).resolves.toContain("Exec=/usr/bin/baby-menu");
  });

  it("removes the entry when autostart is disabled", async () => {
    const home = await tempHome();
    const filePath = linuxAutostartFilePath(home);
    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", true);

    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", false);

    await expect(access(filePath)).rejects.toThrow();
  });

  it("is idempotent in both directions", async () => {
    const home = await tempHome();
    const filePath = linuxAutostartFilePath(home);

    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", true);
    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", true);
    await expect(readFile(filePath, "utf8")).resolves.toContain("Exec=/usr/bin/baby-menu");

    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", false);
    await applyLinuxAutostart(filePath, "/usr/bin/baby-menu", false);
    await expect(access(filePath)).rejects.toThrow();
  });
});
