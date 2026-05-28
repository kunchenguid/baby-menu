import { ipcMain } from "electron";
import { pathToFileURL } from "node:url";
import type { AgentChatResult, BabyMenuSettings, GitActionResult, RecipeMetadata } from "../shared/contracts";
import { getExtensionsDir, getRecipesDir } from "../shared/paths";
import { BabyMenuAgentRuntime, type BabyMenuAgentRuntimeSendOptions } from "./agent-runtime";
import { loadRecipes } from "./recipe-loader";
import { createServerActionRegistry, type ServerActionRegistry } from "./server-action-registry";
import { createWidgetModuleRegistry, type WidgetModuleRegistry } from "./widget-module-registry";

type AgentRuntimeFacade = Pick<BabyMenuAgentRuntime, "save" | "rollback"> & {
  send: (prompt: string, options?: BabyMenuAgentRuntimeSendOptions) => Promise<AgentChatResult>;
};

type PopoverController = {
  setContentHeight: (height: number) => void | Promise<void>;
};

type SettingsController = {
  get: () => Promise<BabyMenuSettings> | BabyMenuSettings;
  setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuSettings> | BabyMenuSettings;
};

type IpcRuntimeOptions = {
  recipesDir?: string;
};

export function registerIpcHandlers(
  rootDir: string,
  agentRuntime: AgentRuntimeFacade = new BabyMenuAgentRuntime(rootDir),
  serverActions: ServerActionRegistry = createServerActionRegistry({ rootDir, actionRoots: [getExtensionsDir(rootDir)] }),
  widgetModules: WidgetModuleRegistry = createWidgetModuleRegistry(rootDir),
  popover: PopoverController = { setContentHeight: () => undefined },
  settings: SettingsController = {
    get: () => ({ openAtLogin: false }),
    setOpenAtLogin: (openAtLogin) => ({ openAtLogin }),
  },
  runtimeOptions: IpcRuntimeOptions = {},
) {
  const recipesDir = runtimeOptions.recipesDir ?? getRecipesDir(rootDir);

  ipcMain.handle("baby-menu:recipes:list", async (): Promise<RecipeMetadata[]> => {
    return loadRecipes(pathToFileURL(`${recipesDir}/`));
  });

  ipcMain.handle("baby-menu:agent:send", async (event, prompt: string): Promise<AgentChatResult> => {
    return agentRuntime.send(prompt, {
      onStatus: (status) => event.sender.send("baby-menu:agent:status", status),
    });
  });

  ipcMain.handle("baby-menu:git:save", async (_event, message?: string): Promise<GitActionResult> => {
    return agentRuntime.save(message);
  });

  ipcMain.handle("baby-menu:git:rollback", async (): Promise<GitActionResult> => {
    return agentRuntime.rollback();
  });

  ipcMain.handle("baby-menu:capabilities:list", async () => {
    return serverActions.list();
  });

  ipcMain.handle("baby-menu:capabilities:invoke", async (_event, extensionId: string, action: string, input?: unknown) => {
    return serverActions.invoke(extensionId, action, input);
  });

  ipcMain.handle("baby-menu:widgets:list", async () => {
    return widgetModules.list();
  });

  ipcMain.handle("baby-menu:popover:set-content-height", async (_event, height: number) => {
    await popover.setContentHeight(height);
    return { ok: true };
  });

  ipcMain.handle("baby-menu:settings:get", async () => {
    return settings.get();
  });

  ipcMain.handle("baby-menu:settings:set-open-at-login", async (_event, openAtLogin: boolean) => {
    return settings.setOpenAtLogin(openAtLogin);
  });
}
