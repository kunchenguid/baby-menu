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

  it("persists and applies the open-at-login preference", async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), "baby-menu-prefs-"));
    tempDirs.push(userDataDir);
    const appFacade = {
      setLoginItemSettings: vi.fn(),
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    };
    const service = createPreferencesService({ userDataDir, app: appFacade });

    await expect(service.get()).resolves.toEqual({ openAtLogin: false });
    await expect(service.setOpenAtLogin(true)).resolves.toEqual({ openAtLogin: true });

    expect(appFacade.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    await expect(readFile(join(userDataDir, "preferences.json"), "utf8")).resolves.toContain('"openAtLogin": true');
  });
});
