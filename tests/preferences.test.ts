import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedExtensionWorkspace } from "../src/main/extension-seeder";
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

  it("persists an executable command override across unrelated updates and service recreation", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const executable = join(userDataDir, "github-helper");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);
    const options = {
      userDataDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    };
    const service = createPreferencesService(options);

    await expect(service.setCommandOverride({ command: "gh", executable })).resolves.toEqual({
      openAtLogin: false,
      commandOverrides: { gh: executable },
    });
    await service.setAgent("codex");

    const relaunchedService = createPreferencesService(options);
    await expect(relaunchedService.get()).resolves.toEqual({
      openAtLogin: false,
      agentName: "codex",
      commandOverrides: { gh: executable },
    });
  });

  it("preserves a command override across packaged extension reseeding during an update", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(rootDir);
    const userDataDir = join(rootDir, "app-data");
    const templateDir = join(rootDir, "release-template");
    const extensionsDir = join(userDataDir, "extensions");
    const executable = join(rootDir, "github-helper");
    await mkdir(templateDir, { recursive: true });
    await writeFile(join(templateDir, "AGENTS.md"), "managed update\n");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);
    const options = { userDataDir, app: { setLoginItemSettings: vi.fn() } };
    const service = createPreferencesService(options);
    await service.setCommandOverride({ command: "gh", executable });

    await seedExtensionWorkspace({ extensionsDir, templateDir });

    await expect(createPreferencesService(options).get()).resolves.toMatchObject({
      commandOverrides: { gh: executable },
    });
    await expect(readFile(join(extensionsDir, "AGENTS.md"), "utf8")).resolves.toBe("managed update\n");
  });

  it("removes an override explicitly and returns the command to host resolution", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const executable = join(userDataDir, "github-helper");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o700);
    const service = createPreferencesService({ userDataDir, app: { setLoginItemSettings: vi.fn() } });
    await service.setCommandOverride({ command: "gh", executable });

    await expect(service.removeCommandOverride("gh")).resolves.toEqual({ openAtLogin: true });
    await expect(service.resolveCommandExecutable("gh")).resolves.toBe("gh");
  });

  it("rejects malformed command names and ineligible executable targets", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const service = createPreferencesService({ userDataDir, app: { setLoginItemSettings: vi.fn() } });
    const nonExecutable = join(userDataDir, "not-executable");
    await writeFile(nonExecutable, "plain text\n");

    await expect(service.setCommandOverride(null as never)).rejects.toThrow(
      "Enter a command name and an executable path.",
    );
    await expect(
      service.setCommandOverride({ command: "gh; open /tmp/pwned", executable: nonExecutable } as never),
    ).rejects.toThrow("Command names must contain only letters, numbers, dot, dash, underscore, or plus.");
    await expect(
      service.setCommandOverride({ command: "git", executable: nonExecutable } as never),
    ).rejects.toThrow("Only the GitHub contribution graph helper command is supported.");
    await expect(service.setCommandOverride({ command: "gh", executable: "relative/helper" })).rejects.toThrow(
      "Choose an absolute executable path.",
    );
    await expect(service.setCommandOverride({ command: "gh", executable: join(userDataDir, "missing") })).rejects.toThrow(
      "The executable does not exist.",
    );
    await expect(service.setCommandOverride({ command: "gh", executable: nonExecutable })).rejects.toThrow(
      "The selected file is not executable.",
    );
    await expect(service.get()).resolves.toEqual({ openAtLogin: true });
  });

  it("uses host resolution for migrated preferences but fails closed on a malformed configured override", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const filePath = join(userDataDir, "preferences.json");
    const service = createPreferencesService({ userDataDir, app: { setLoginItemSettings: vi.fn() } });

    await writeFile(filePath, '{"openAtLogin":false}\n');
    await expect(service.resolveCommandExecutable("gh")).resolves.toBe("gh");

    await writeFile(filePath, '{"openAtLogin":false,"commandOverrides":{"gh":"relative/helper"}}\n');
    await expect(service.resolveCommandExecutable("gh")).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_OVERRIDE",
      message: 'The configured executable for "gh" must be an absolute path. Update or remove it in Settings.',
    });
  });
});
