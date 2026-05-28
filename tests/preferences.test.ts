import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreferencesService } from "../src/main/preferences";

describe("preferences service", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("defaults to opening at login until the user opts out", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const appFacade = {
      setLoginItemSettings: vi.fn(),
    };
    const service = createPreferencesService({ userDataDir, app: appFacade });

    await expect(service.get()).resolves.toEqual({ openAtLogin: true });
    await expect(service.apply()).resolves.toEqual({ openAtLogin: true });

    expect(appFacade.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it("can default to not opening at login for source dev mode", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const appFacade = {
      setLoginItemSettings: vi.fn(),
    };
    const service = createPreferencesService({ userDataDir, app: appFacade, defaultOpenAtLogin: false });

    await expect(service.get()).resolves.toEqual({ openAtLogin: false });
    await expect(service.apply()).resolves.toEqual({ openAtLogin: false });

    expect(appFacade.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it("prevents source dev mode from enabling open at login", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const appFacade = {
      setLoginItemSettings: vi.fn(),
    };
    const service = createPreferencesService({
      userDataDir,
      app: appFacade,
      defaultOpenAtLogin: false,
      allowOpenAtLogin: false,
    });

    await expect(service.setOpenAtLogin(true)).resolves.toEqual({ openAtLogin: false });
    await expect(service.get()).resolves.toEqual({ openAtLogin: false });

    expect(appFacade.setLoginItemSettings).not.toHaveBeenCalled();
    await expect(readFile(join(userDataDir, "preferences.json"), "utf8")).resolves.toContain('"openAtLogin": false');
  });

  it("persists and applies an explicit open-at-login opt-out", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const appFacade = {
      setLoginItemSettings: vi.fn(),
    };
    const service = createPreferencesService({ userDataDir, app: appFacade });

    await expect(service.setOpenAtLogin(false)).resolves.toEqual({ openAtLogin: false });
    await expect(service.get()).resolves.toEqual({ openAtLogin: false });

    expect(appFacade.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
    await expect(readFile(join(userDataDir, "preferences.json"), "utf8")).resolves.toContain('"openAtLogin": false');
  });

  it("has no agent preference until the user picks one", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const service = createPreferencesService({ userDataDir, app: { setLoginItemSettings: vi.fn() } });

    await expect(service.get()).resolves.not.toHaveProperty("agentName");
  });

  it("persists the chosen agent without disturbing the login preference", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const service = createPreferencesService({ userDataDir, app: { setLoginItemSettings: vi.fn() }, defaultOpenAtLogin: false });

    await expect(service.setAgent("codex")).resolves.toEqual({ openAtLogin: false, agentName: "codex" });
    await expect(service.get()).resolves.toEqual({ openAtLogin: false, agentName: "codex" });
    await expect(readFile(join(userDataDir, "preferences.json"), "utf8")).resolves.toContain('"agentName": "codex"');
  });
});
