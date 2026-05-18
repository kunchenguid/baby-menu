import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createAcpRuntime,
  createAgentRegistry,
  createFileSessionStore,
  type AcpRuntimeEvent,
  type AcpRuntimeHandle,
  type AcpRuntimeTurn,
  type AcpxRuntime,
} from "acpx/runtime";
import type { AgentChatResult, GitActionResult, GitSessionSnapshot } from "../shared/contracts";
import type { AgentRuntimeStatus } from "../shared/contracts";
import { getAgentStateDir, getDevExtensionSnapshotDir, getExtensionsDir } from "../shared/paths";
import { AgentTurnLogRecorder } from "./agent-turn-log";
import { DevExtensionChangeSession } from "./dev-extension-change-session";
import { GitChangeSession } from "./git-change-session";

export type BabyMenuAgentRuntimeOptions = {
  agentName?: string;
  registryOverrides?: Record<string, string>;
  requestTimeoutMs?: number;
  paths?: BabyMenuAgentRuntimePaths;
};

export type BabyMenuAgentRuntimePaths = {
  extensionsDir: string;
  agentStateDir: string;
  snapshotDir: string;
  isPackaged?: boolean;
};

export type BabyMenuAgentRuntimeSendOptions = {
  onStatus?: (status: AgentRuntimeStatus) => void | Promise<void>;
};

type ResolveDefaultAgentNameOptions = {
  env?: Partial<Pick<NodeJS.ProcessEnv, "BABY_MENU_AGENT" | "PATH">>;
  commandExists?: (command: string) => boolean;
  allowFallbackWhenMissing?: boolean;
};

const PREFERRED_AGENTS = [
  { name: "claude", command: "claude" },
  { name: "pi", command: "npx" },
  { name: "codex", command: "codex" },
] as const;
const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

type AgentChangeSession = {
  readonly startedClean: boolean;
  readonly canSave: boolean;
  readonly canRollback: boolean;
  snapshot(message?: string): GitSessionSnapshot;
  save(message?: string): Promise<GitActionResult>;
  rollback(): Promise<GitActionResult>;
};

export class AgentTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly phase: string,
  ) {
    super(`Agent request timed out after ${timeoutMs}ms while ${phase}.`);
    this.name = "AgentTimeoutError";
  }
}

function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "sh";
  const lookupArgs = process.platform === "win32" ? [command] : ["-c", "command -v \"$1\"", "sh", command];
  return spawnSync(lookupCommand, lookupArgs, { stdio: "ignore" }).status === 0;
}

export function resolveDefaultAgentName(options: ResolveDefaultAgentNameOptions = {}): string | null {
  const configuredAgent = options.env?.BABY_MENU_AGENT ?? process.env.BABY_MENU_AGENT;
  if (configuredAgent?.trim()) return configuredAgent.trim();

  const hasCommand = options.commandExists ?? commandExists;
  const detected = PREFERRED_AGENTS.find((agent) => hasCommand(agent.command))?.name;
  if (detected) return detected;
  return options.allowFallbackWhenMissing === false ? null : PREFERRED_AGENTS[0].name;
}

export function resolveAgentTimeoutMs(env: Partial<Pick<NodeJS.ProcessEnv, "BABY_MENU_AGENT_TIMEOUT_MS">> = process.env) {
  const parsed = Number(env.BABY_MENU_AGENT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AGENT_TIMEOUT_MS;
}

export function getAgentRuntimeCwd(
  rootDir: string,
  env: Partial<Pick<NodeJS.ProcessEnv, "BABY_MENU_EXTENSIONS_DIR">> = process.env,
  paths?: Pick<BabyMenuAgentRuntimePaths, "extensionsDir">,
): string {
  if (paths) return paths.extensionsDir;
  return getExtensionsDir(rootDir, env);
}

export function selectAgentChangeSessionKind({
  isPackaged,
  rootDir,
  extensionsDir,
}: {
  isPackaged?: boolean;
  rootDir: string;
  extensionsDir: string;
}): "git" | "snapshot" {
  if (isPackaged) return "snapshot";
  return resolve(extensionsDir) === resolve(join(rootDir, "extensions")) ? "git" : "snapshot";
}

export function withAgentTimeout<T>(
  operation: Promise<T>,
  options: { timeoutMs: number; phase: string; onTimeout?: () => void },
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      options.onTimeout?.();
      reject(new AgentTimeoutError(options.timeoutMs, options.phase));
    }, options.timeoutMs);
    timeout.unref?.();
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export function collectAgentTurnOutput(
  turn: AcpRuntimeTurn,
  options: {
    idleTimeoutMs: number;
    onEvent?: (event: AcpRuntimeEvent) => void | Promise<void>;
    onStatus?: (status: AgentRuntimeStatus) => void | Promise<void>;
  },
): Promise<string> {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let rejectIdleTimeout: ((error: AgentTimeoutError) => void) | null = null;
  let assistantOutput = "";
  let publishedStatusText: string | null = null;

  const clearIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const idleTimeout = new Promise<never>((_resolve, reject) => {
    rejectIdleTimeout = reject;
  });

  const refreshIdleTimer = () => {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      void turn.cancel({ reason: "timeout" }).catch(() => undefined);
      void turn.closeStream({ reason: "timeout" }).catch(() => undefined);
      rejectIdleTimeout?.(new AgentTimeoutError(options.idleTimeoutMs, "waiting for agent activity"));
    }, options.idleTimeoutMs);
    idleTimer.unref?.();
  };

  const collectOutput = (async () => {
    let output = "";
    refreshIdleTimer();

    for await (const event of turn.events) {
      refreshIdleTimer();
      await Promise.resolve(options.onEvent?.(event)).catch(() => undefined);
      const outputText = outputTextForEvent(event);
      output += outputText;

      if (outputText) {
        assistantOutput += outputText;
        const statusText = latestCompleteAssistantStatusText(assistantOutput);
        if (statusText && statusText !== publishedStatusText) {
          publishedStatusText = statusText;
          await Promise.resolve(options.onStatus?.({ text: statusText, eventType: "text_delta" })).catch(() => undefined);
        }
      }
    }

    const result = await turn.result;
    if (result.status === "failed") {
      throw new Error(result.error.message || "Agent turn failed");
    }
    if (result.status === "cancelled") {
      throw new Error("Agent turn was cancelled");
    }
    return output;
  })();
  void collectOutput.catch(() => undefined);

  return Promise.race([collectOutput, idleTimeout]).finally(clearIdleTimer);
}

export function agentRuntimeStatusForEvent(event: AcpRuntimeEvent): AgentRuntimeStatus | null {
  if (event.type !== "text_delta" || event.stream !== "output") return null;
  return statusFromText(event.text, event.type);
}

function statusFromText(text: string | undefined, eventType: AgentRuntimeStatus["eventType"]): AgentRuntimeStatus | null {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return {
    text: normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized,
    eventType,
  };
}

export function latestCompleteAssistantStatusText(output: string): string | null {
  const normalized = output.replace(/\r\n/g, "\n");
  const inline = normalized.replace(/\s+/g, " ").trim();
  const completeSentences = [...inline.matchAll(/[^.!?]+[.!?](?=\s|$)/g)].map((match) => match[0].trim());
  const latestSentence = completeSentences.at(-1);
  if (latestSentence) return truncateStatusText(latestSentence);

  const lines = normalized.split("\n");
  if (!normalized.endsWith("\n")) lines.pop();
  const latestLine = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .at(-1);
  return latestLine ? truncateStatusText(latestLine) : null;
}

function truncateStatusText(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function outputTextForEvent(event: AcpRuntimeEvent): string {
  if (event.type === "text_delta" && (event.stream ?? "output") === "output") {
    return event.text ?? "";
  }
  return "";
}

export function buildBabyMenuAgentPrompt(prompt: string): string {
  return `${prompt}

You are editing the baby-menu repository in dev mode.
Prefer small, test-driven changes in your current extension workspace.
Build self-contained extensions under <extension-id>/ inside your current extension workspace so they can be shared as a directory behind the stable window.babyMenu bridge.
For recipe-backed widgets, read the matching self-contained spec from recipes/ before editing.
Do not modify files outside your current extension workspace unless the user explicitly asks.
Renderer widgets should call privileged work with window.babyMenu.capabilities.invoke(extensionId, action, input).
Extension server actions live in server.ts files and export an actions object.
Do not add new preload methods or one-off IPC method names for each widget.
Put privileged filesystem, shell, network, credential, and token work behind an extension-owned server action that is invoked through a stable generic capability bridge.
Run relevant tests when you change behavior.`;
}

export class BabyMenuAgentRuntime {
  private runtime: AcpxRuntime | null = null;
  private handle: AcpRuntimeHandle | null = null;
  private activeSession: AgentChangeSession | null = null;
  private readonly agentName: string;
  private readonly registryOverrides: Record<string, string> | undefined;
  private readonly requestTimeoutMs: number;
  private readonly paths: BabyMenuAgentRuntimePaths | undefined;

  constructor(
    private readonly rootDir: string,
    options: string | BabyMenuAgentRuntimeOptions = {},
  ) {
    this.agentName =
      typeof options === "string"
        ? options
        : options.agentName ?? resolveDefaultAgentName() ?? PREFERRED_AGENTS[0].name;
    this.registryOverrides = typeof options === "string" ? undefined : options.registryOverrides;
    this.requestTimeoutMs = typeof options === "string" ? resolveAgentTimeoutMs() : options.requestTimeoutMs ?? resolveAgentTimeoutMs();
    this.paths = typeof options === "string" ? undefined : options.paths;
  }

  get session(): AgentChangeSession | null {
    return this.activeSession;
  }

  async send(prompt: string, options: BabyMenuAgentRuntimeSendOptions = {}): Promise<AgentChatResult> {
    const agentCwd = await this.ensureAgentRuntimeCwd();
    const changeSession = await this.beginChangeSession(agentCwd);
    this.activeSession = changeSession;

    if (!changeSession.startedClean) {
      return {
        assistantText:
          "I cannot start an editing session because the git working tree is already dirty. Commit or stash those changes first so Save and Rollback can stay safe.",
        session: changeSession.snapshot("Working tree was dirty before the agent started."),
      };
    }

    let runtime: AcpxRuntime | null = null;
    let handle: AcpRuntimeHandle | null = null;
    let turnLog: AgentTurnLogRecorder | null = null;

    try {
      runtime = await this.ensureRuntime(agentCwd);
      handle = await withAgentTimeout(
        runtime.ensureSession({
          sessionKey: "baby-menu-agent-chat",
          agent: this.agentName,
          mode: "persistent",
          cwd: agentCwd,
        }),
        {
          timeoutMs: this.requestTimeoutMs,
          phase: "starting agent session",
          onTimeout: () => {
            this.runtime = null;
          },
        },
      );
      this.handle = handle;

      const requestId = randomUUID();
      turnLog = await AgentTurnLogRecorder.start({
        rootDir: this.rootDir,
        agentName: this.agentName,
        requestId,
        prompt,
      });
      const turn = runtime.startTurn({
        handle,
        text: this.buildPrompt(prompt),
        mode: "prompt",
        requestId,
        timeoutMs: 0,
      });

      const output = await this.collectTurnOutput(turn, turnLog, options);
      await turnLog.finish("completed").catch(() => undefined);

      return {
        assistantText: output.trim() || "Agent finished without a text response.",
        session: changeSession.snapshot("Review the generated repo changes, then Save or Rollback."),
      };
    } catch (error) {
      if (!(error instanceof AgentTimeoutError)) {
        await turnLog?.finish("failed").catch(() => undefined);
        throw error;
      }
      await turnLog?.recordTimeout(error).catch(() => undefined);

      if (runtime && handle) {
        await runtime.close({ handle, reason: "timeout" }).catch(() => undefined);
      }
      this.runtime = null;
      this.handle = null;
      return {
        assistantText: `The ${this.agentName} agent timed out after ${error.timeoutMs}ms while ${error.phase}. It may have made partial repo changes. Review the working tree, then Save or Rollback. You can retry with BABY_MENU_AGENT_TIMEOUT_MS set higher if needed.`,
        session: changeSession.snapshot("Agent timed out. Review any partial repo changes, then Save or Rollback."),
      };
    }
  }

  async save(message?: string) {
    if (!this.activeSession) return { ok: false, reason: "No active agent change session" };
    return this.activeSession.save(message);
  }

  async rollback() {
    if (!this.activeSession) return { ok: false, reason: "No active agent change session" };
    return this.activeSession.rollback();
  }

  async close() {
    if (!this.runtime || !this.handle) return;

    const runtime = this.runtime;
    const handle = this.handle;
    this.runtime = null;
    this.handle = null;
    await runtime.close({ handle, reason: "baby-menu-shutdown" });
  }

  private async ensureAgentRuntimeCwd(): Promise<string> {
    const agentCwd = getAgentRuntimeCwd(this.rootDir, process.env, this.paths);
    await mkdir(agentCwd, { recursive: true });
    return agentCwd;
  }

  private async beginChangeSession(agentCwd: string): Promise<AgentChangeSession> {
    if (selectAgentChangeSessionKind({ isPackaged: this.paths?.isPackaged, rootDir: this.rootDir, extensionsDir: agentCwd }) === "snapshot") {
      return DevExtensionChangeSession.begin(agentCwd, this.paths?.snapshotDir ?? getDevExtensionSnapshotDir(this.rootDir));
    }

    return GitChangeSession.begin(this.rootDir);
  }

  private async ensureRuntime(agentCwd: string): Promise<AcpxRuntime> {
    if (this.runtime) return this.runtime;

    const stateDir = this.paths?.agentStateDir ?? getAgentStateDir(this.rootDir);
    await mkdir(stateDir, { recursive: true });
    this.runtime = createAcpRuntime({
      cwd: agentCwd,
      sessionStore: createFileSessionStore({ stateDir }),
      agentRegistry: createAgentRegistry(
        this.registryOverrides ? { overrides: this.registryOverrides } : undefined,
      ),
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
      timeoutMs: this.requestTimeoutMs,
    });
    return this.runtime;
  }

  private collectTurnOutput(
    turn: AcpRuntimeTurn,
    turnLog: AgentTurnLogRecorder,
    options: BabyMenuAgentRuntimeSendOptions,
  ): Promise<string> {
    return collectAgentTurnOutput(turn, {
      idleTimeoutMs: this.requestTimeoutMs,
      onEvent: async (event) => {
        await turnLog.recordEvent(event);
      },
      onStatus: options.onStatus,
    });
  }

  private buildPrompt(prompt: string): string {
    return buildBabyMenuAgentPrompt(prompt);
  }
}

function isDevExtensionWorkspace(rootDir: string, agentCwd: string): boolean {
  return resolve(agentCwd) !== resolve(join(rootDir, "extensions"));
}
