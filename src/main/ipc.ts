import { app as electronApp, ipcMain } from "electron";
import { pathToFileURL } from "node:url";
import type {
  AgentActiveTurn,
  AgentChatResult,
  BabyMenuCustomAgentInput,
  BabyMenuSettings,
  GitActionResult,
  GitSessionSnapshot,
  PopoverVisibilityState,
  RecipeMetadata,
  SqlParams,
  UpdateStatus,
} from "../shared/contracts";
import { getExtensionsDir, getRecipesDir } from "../shared/paths";
import { BabyMenuAgentRuntime, type BabyMenuAgentRuntimeSendOptions } from "./agent-runtime";
import { createExtensionDatabase, type ExtensionDatabase } from "./extension-database";
import { loadRecipes } from "./recipe-loader";
import { createServerActionRegistry, type ServerActionRegistry } from "./server-action-registry";
import {
  createLayoutModuleRegistry,
  createWidgetModuleRegistry,
  type LayoutModuleRegistry,
  type WidgetModuleRegistry,
} from "./widget-module-registry";

type AgentRuntimeFacade = Pick<
  BabyMenuAgentRuntime,
  "save" | "rollback" | "currentSessionSnapshot" | "currentTurn"
> & {
  send: (prompt: string, options?: BabyMenuAgentRuntimeSendOptions) => Promise<AgentChatResult>;
};

type PopoverController = {
  setContentHeight: (height: number) => void | Promise<void>;
  setContentSize: (size: { width: number; height: number }) => void | Promise<void>;
  getVisibility: () => PopoverVisibilityState | Promise<PopoverVisibilityState>;
};

type SettingsController = {
  get: () => Promise<BabyMenuSettings> | BabyMenuSettings;
  setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuSettings> | BabyMenuSettings;
  setAgent: (agentName: string) => Promise<BabyMenuSettings> | BabyMenuSettings;
  addAgent: (input: BabyMenuCustomAgentInput) => Promise<BabyMenuSettings> | BabyMenuSettings;
  updateAgent: (name: string, input: { label?: string; command: string }) => Promise<BabyMenuSettings> | BabyMenuSettings;
  removeAgent: (name: string) => Promise<BabyMenuSettings> | BabyMenuSettings;
};

type AppController = {
  quit: () => void | Promise<void>;
  getUpdateStatus?: () => UpdateStatus | Promise<UpdateStatus>;
  openReleasePage?: () => void | Promise<void>;
};

type IpcRuntimeOptions = {
  recipesDir?: string;
  database?: ExtensionDatabase;
  layoutModules?: LayoutModuleRegistry;
};

export function registerIpcHandlers(
  rootDir: string,
  agentRuntime: AgentRuntimeFacade = new BabyMenuAgentRuntime(rootDir),
  serverActions: ServerActionRegistry = createServerActionRegistry({ rootDir, actionRoots: [getExtensionsDir(rootDir)] }),
  widgetModules: WidgetModuleRegistry = createWidgetModuleRegistry(rootDir),
  popover: PopoverController = {
    setContentHeight: () => undefined,
    setContentSize: () => undefined,
    getVisibility: () => ({ visible: false }),
  },
  settings: SettingsController = {
    get: () => ({ openAtLogin: false, agentName: "", agents: [] }),
    setOpenAtLogin: (openAtLogin) => ({ openAtLogin, agentName: "", agents: [] }),
    setAgent: (agentName) => ({ openAtLogin: false, agentName, agents: [] }),
    addAgent: () => ({ openAtLogin: false, agentName: "", agents: [] }),
    updateAgent: () => ({ openAtLogin: false, agentName: "", agents: [] }),
    removeAgent: () => ({ openAtLogin: false, agentName: "", agents: [] }),
  },
  appController: AppController = { quit: () => electronApp.quit() },
  runtimeOptions: IpcRuntimeOptions = {},
) {
  const recipesDir = runtimeOptions.recipesDir ?? getRecipesDir(rootDir);
  const database = runtimeOptions.database ?? createExtensionDatabase(":memory:");
  const layoutModules = runtimeOptions.layoutModules ?? createLayoutModuleRegistry(rootDir);

  ipcMain.handle("baby-menu:recipes:list", async (): Promise<RecipeMetadata[]> => {
    return loadRecipes(pathToFileURL(`${recipesDir}/`));
  });

  ipcMain.handle("baby-menu:agent:send", async (event, prompt: string): Promise<AgentChatResult> => {
    return agentRuntime.send(prompt, {
      onStatus: (status) => event.sender.send("baby-menu:agent:status", status),
    });
  });

  ipcMain.handle("baby-menu:agent:active-turn", async (): Promise<AgentActiveTurn | null> => {
    return agentRuntime.currentTurn();
  });

  ipcMain.handle("baby-menu:git:save", async (_event, message?: string): Promise<GitActionResult> => {
    return agentRuntime.save(message);
  });

  ipcMain.handle("baby-menu:git:rollback", async (): Promise<GitActionResult> => {
    return agentRuntime.rollback();
  });

  ipcMain.handle("baby-menu:git:status", async (): Promise<GitSessionSnapshot | null> => {
    return await agentRuntime.currentSessionSnapshot();
  });

  ipcMain.handle("baby-menu:capabilities:list", async () => {
    return serverActions.list();
  });

  ipcMain.handle("baby-menu:capabilities:invoke", async (_event, extensionId: string, action: string, input?: unknown) => {
    return serverActions.invoke(extensionId, action, input);
  });

  ipcMain.handle("baby-menu:db:query", async (_event, sql: string, params?: SqlParams) => {
    return database.query(sql, params);
  });

  ipcMain.handle("baby-menu:db:get", async (_event, sql: string, params?: SqlParams) => {
    return database.get(sql, params);
  });

  ipcMain.handle("baby-menu:db:run", async (_event, sql: string, params?: SqlParams) => {
    return database.run(sql, params);
  });

  ipcMain.handle("baby-menu:db:exec", async (_event, sql: string) => {
    database.exec(sql);
  });

  ipcMain.handle("baby-menu:widgets:list", async () => {
    return widgetModules.list();
  });

  ipcMain.handle("baby-menu:layout:get", async () => {
    return layoutModules.get();
  });

  ipcMain.handle("baby-menu:popover:set-content-height", async (_event, height: number) => {
    await popover.setContentHeight(height);
    return { ok: true };
  });

  ipcMain.handle("baby-menu:popover:set-content-size", async (_event, size: { width: number; height: number }) => {
    await popover.setContentSize(size);
    return { ok: true };
  });

  ipcMain.handle("baby-menu:popover:get-visibility", async () => {
    return popover.getVisibility();
  });

  ipcMain.handle("baby-menu:settings:get", async () => {
    return settings.get();
  });

  ipcMain.handle("baby-menu:settings:set-open-at-login", async (_event, openAtLogin: boolean) => {
    return settings.setOpenAtLogin(openAtLogin);
  });

  ipcMain.handle("baby-menu:settings:set-agent", async (_event, agentName: string) => {
    return settings.setAgent(agentName);
  });

  ipcMain.handle("baby-menu:settings:add-agent", async (_event, input: BabyMenuCustomAgentInput) => {
    return settings.addAgent(input);
  });

  ipcMain.handle("baby-menu:settings:update-agent", async (_event, name: string, input: { label?: string; command: string }) => {
    return settings.updateAgent(name, input);
  });

  ipcMain.handle("baby-menu:settings:remove-agent", async (_event, name: string) => {
    return settings.removeAgent(name);
  });

  ipcMain.handle("baby-menu:app:quit", async () => {
    await appController.quit();
    return { ok: true };
  });

  ipcMain.handle("baby-menu:app:get-update-status", async (): Promise<UpdateStatus> => {
    return (
      (await appController.getUpdateStatus?.()) ?? {
        currentVersion: electronApp.getVersion(),
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
      }
    );
  });

  ipcMain.handle("baby-menu:app:open-release-page", async () => {
    await appController.openReleasePage?.();
    return { ok: true };
  });
}
