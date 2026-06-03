import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
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
import type { AgentActiveTurn, AgentChatResult, GitActionResult, GitSessionSnapshot, WorkspaceChange } from "../shared/contracts";
import type { AgentRuntimeStatus } from "../shared/contracts";
import { BUILT_IN_AGENT_NAMES, type AgentDefinition, resolveAgentCatalog } from "./agent-catalog";
import { getAgentStateDir, getDevExtensionSnapshotDir, getExtensionsDir } from "../shared/paths";
import { AgentTurnLogRecorder } from "./agent-turn-log";
import { DevExtensionChangeSession } from "./dev-extension-change-session";
import { GitChangeSession } from "./git-change-session";
import type { TelemetryClient } from "./telemetry";

export type BabyMenuAgentRuntimeOptions = {
  agentName?: string;
  registryOverrides?: Record<string, string>;
  requestTimeoutMs?: number;
  paths?: BabyMenuAgentRuntimePaths;
  telemetry?: TelemetryClient;
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
  catalog?: readonly AgentDefinition[];
};

const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

// One persistent conversation per app, keyed for the file session store. The
// persisted record outlives the app process, so a fresh launch tries to resume
// it - see SESSION_KEY use below and the resume-recovery path in runSend.
const SESSION_KEY = "baby-menu-agent-chat";

// acpx flags a failed turn with this detailCode when a persisted session cannot
// be resumed because the agent reports loadSession:false. The bundled adapters
// mint a fresh session per process and never support session/load, so every
// launch with a leftover persisted record hits this until we drop the record.
const SESSION_RESUME_REQUIRED_DETAIL_CODE = "SESSION_RESUME_REQUIRED";

function telemetryAgentName(agentName: string): string {
  return BUILT_IN_AGENT_NAMES.has(agentName) ? agentName : "custom";
}

type AgentChangeSession = {
  readonly startedClean: boolean;
  readonly canSave: boolean;
  readonly canRollback: boolean;
  snapshot(message?: string): GitSessionSnapshot;
  describeChanges(): Promise<WorkspaceChange[]>;
  hasChanges(): Promise<boolean>;
  save(message?: string): Promise<GitActionResult>;
  rollback(): Promise<GitActionResult>;
};

// Builds the renderer-facing snapshot and attaches the diff-derived change
// classification plus dirty flag, so the Keep/Rollback bar can label what
// actually changed instead of guessing from the agent's prose. Inspection
// failures degrade to an unannotated snapshot rather than breaking the turn.
async function enrichSnapshot(session: AgentChangeSession, message: string): Promise<GitSessionSnapshot> {
  const snapshot = session.snapshot(message);
  try {
    const [changes, dirty] = await Promise.all([session.describeChanges(), session.hasChanges()]);
    snapshot.changes = changes;
    snapshot.dirty = dirty;
  } catch {
    // Leave changes/dirty undefined; the renderer falls back to a generic label.
  }
  return snapshot;
}

export class AgentTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly phase: string,
  ) {
    super(`Agent request timed out after ${timeoutMs}ms while ${phase}.`);
    this.name = "AgentTimeoutError";
  }
}

// Carries the acpx turn-result error so callers can branch on the structured
// detailCode (for example to recover from SESSION_RESUME_REQUIRED) instead of
// string-matching a flattened message.
export class AgentTurnFailedError extends Error {
  readonly code?: string;
  readonly detailCode?: string;
  readonly retryable?: boolean;

  constructor(error: { message?: string; code?: string; detailCode?: string; retryable?: boolean }) {
    super(error.message || "Agent turn failed");
    this.name = "AgentTurnFailedError";
    this.code = error.code;
    this.detailCode = error.detailCode;
    this.retryable = error.retryable;
  }
}

function isSessionResumeRequiredError(error: unknown): boolean {
  return error instanceof AgentTurnFailedError && error.detailCode === SESSION_RESUME_REQUIRED_DETAIL_CODE;
}

function turnFailureDetail(error: unknown): { message: string; code?: string; detailCode?: string } {
  if (error instanceof AgentTurnFailedError) {
    return { message: error.message, code: error.code, detailCode: error.detailCode };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

export function commandExists(command: string): boolean {
  const lookupCommand = process.platform === "win32" ? "where" : "sh";
  const lookupArgs = process.platform === "win32" ? [command] : ["-c", "command -v \"$1\"", "sh", command];
  return spawnSync(lookupCommand, lookupArgs, { stdio: "ignore" }).status === 0;
}

export function resolveDefaultAgentName(options: ResolveDefaultAgentNameOptions = {}): string | null {
  const configuredAgent = options.env?.BABY_MENU_AGENT ?? process.env.BABY_MENU_AGENT;
  if (configuredAgent?.trim()) return configuredAgent.trim();

  const catalog = options.catalog ?? resolveAgentCatalog();
  if (catalog.length === 0) return null;
  const hasCommand = options.commandExists ?? commandExists;
  const detected = catalog.find((agent) => (agent.launchCommand ? true : hasCommand(agent.command)))?.name;
  if (detected) return detected;
  return options.allowFallbackWhenMissing === false ? null : catalog[0].name;
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
      throw new AgentTurnFailedError(result.error);
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
Prefer small, focused changes in your current extension workspace.
Build self-contained extensions under <extension-id>/ inside your current extension workspace so they can be shared as a directory behind the stable window.babyMenu bridge.
For recipe-backed widgets, read the matching self-contained spec from recipes/ before editing.
Do not modify files outside your current extension workspace unless the user explicitly asks.
Renderer widgets should call privileged work with window.babyMenu.capabilities.invoke(extensionId, action, input).
Extension server actions live in server.ts files and export an actions object.
Do not add new preload methods or one-off IPC method names for each widget.
Put privileged filesystem, shell, network, credential, and token work behind an extension-owned server action that is invoked through a stable generic capability bridge.
Do not write test files, and do not write README or other documentation files for extensions.
Verify extension work by reasoning through widget render output and server action return shapes.`;
}

export class BabyMenuAgentRuntime {
  private runtime: AcpxRuntime | null = null;
  private handle: AcpRuntimeHandle | null = null;
  private activeSession: AgentChangeSession | null = null;
  private activeTurn = false;
  private activeTurnInfo: AgentActiveTurn | null = null;
  private agentName: string;
  private registryOverrides: Record<string, string> | undefined;
  private registryOverridesStale = false;
  private readonly requestTimeoutMs: number;
  private readonly paths: BabyMenuAgentRuntimePaths | undefined;
  private readonly telemetry: TelemetryClient | undefined;

  constructor(
    private readonly rootDir: string,
    options: string | BabyMenuAgentRuntimeOptions = {},
  ) {
    this.agentName =
      typeof options === "string"
        ? options
        : options.agentName ?? resolveDefaultAgentName() ?? resolveAgentCatalog()[0].name;
    this.registryOverrides = typeof options === "string" ? undefined : options.registryOverrides;
    this.requestTimeoutMs = typeof options === "string" ? resolveAgentTimeoutMs() : options.requestTimeoutMs ?? resolveAgentTimeoutMs();
    this.paths = typeof options === "string" ? undefined : options.paths;
    this.telemetry = typeof options === "string" ? undefined : options.telemetry;
  }

  get session(): AgentChangeSession | null {
    return this.activeSession;
  }

  /**
   * Snapshot of the outstanding change session for the renderer to re-hydrate a
   * pending Keep/Rollback prompt after a reload. Returns null when no session is
   * open OR a turn is still running. The change session is created at the start of
   * a turn (so it is "saveable" the whole time the build runs); returning null
   * mid-turn keeps the renderer from showing a Keep/Rollback prompt before the
   * build has actually finished. Use currentTurn() to restore the run strip then.
   */
  async currentSessionSnapshot(): Promise<GitSessionSnapshot | null> {
    if (this.activeTurn) return null;
    if (!this.activeSession) return null;
    if (!this.activeSession.canSave && !this.activeSession.canRollback) return null;
    return this.enrichActiveSessionSnapshot(this.activeSession, "Review the generated changes, then Save or Rollback.");
  }

  /**
   * The turn currently running in the main process, or null. Lets the renderer
   * restore the in-progress run strip after the popover view is remounted (e.g.
   * returning from Settings) instead of losing it or surfacing a premature prompt.
   */
  currentTurn(): AgentActiveTurn | null {
    return this.activeTurnInfo;
  }

  get currentAgent(): string {
    return this.agentName;
  }

  /**
   * Replaces the acpx registry overrides used to launch agents.
   */
  async setRegistryOverrides(overrides: Record<string, string> | undefined): Promise<void> {
    this.registryOverrides = overrides && Object.keys(overrides).length > 0 ? overrides : undefined;
    if (this.agentSwitchDisabledReason) {
      this.registryOverridesStale = true;
      return;
    }
    await this.closeRuntime("registry-overrides-change", undefined, true);
  }

  get agentSwitchDisabledReason(): string | undefined {
    if (this.activeTurn) return "Agent is running. Wait for it to finish before switching agents.";
    if (this.activeSession?.canSave || this.activeSession?.canRollback) {
      return "Save or Rollback the current agent changes before switching agents.";
    }
    return undefined;
  }

  /**
   * Switches the embedded agent and resets the live conversation. Closing the
   * runtime with discardPersistentState drops the persisted "baby-menu-agent-chat"
   * session so the next send() starts the new agent with a fresh conversation.
   */
  async setAgent(name: string): Promise<void> {
    const next = name.trim();
    if (!next || next === this.agentName) return;

    const disabledReason = this.agentSwitchDisabledReason;
    if (disabledReason) throw new Error(disabledReason);

    await this.closeRuntime("agent-switch", true, true);
    this.activeSession = null;
    this.agentName = next;
    this.telemetry?.track("agent_switch", { agent: telemetryAgentName(next) });
  }

  async send(prompt: string, options: BabyMenuAgentRuntimeSendOptions = {}): Promise<AgentChatResult> {
    if (this.activeTurn) {
      return {
        assistantText: "An agent turn is already running. Wait for it to finish before asking again.",
      };
    }

    this.activeTurn = true;
    this.activeTurnInfo = { title: prompt.trim(), startedAt: Date.now() };

    try {
      return await this.runSend(prompt, options);
    } finally {
      this.activeTurn = false;
      this.activeTurnInfo = null;
    }
  }

  private async runSend(prompt: string, options: BabyMenuAgentRuntimeSendOptions = {}): Promise<AgentChatResult> {
    const agentCwd = await this.ensureAgentRuntimeCwd();
    const changeSession = await this.beginChangeSession(agentCwd);
    this.activeSession = changeSession;
    const telemetryAgent = telemetryAgentName(this.agentName);

    if (!changeSession.startedClean) {
      this.telemetry?.track("agent_turn", { agent: telemetryAgent, status: "blocked_dirty" });
      return {
        assistantText:
          "I cannot start an editing session because the git working tree is already dirty. Commit or stash those changes first so Save and Rollback can stay safe.",
        session: changeSession.snapshot("Working tree was dirty before the agent started."),
      };
    }

    try {
      return await this.runTurnAttempt(prompt, options, agentCwd, changeSession, telemetryAgent);
    } catch (error) {
      // A persisted session that the bundled (loadSession:false) adapter cannot
      // resume after a restart fails the FIRST turn with SESSION_RESUME_REQUIRED.
      // Drop the stale record and start a fresh session once so the agent does
      // not look permanently "unavailable" until the cache is cleared by hand.
      if (isSessionResumeRequiredError(error)) {
        await this.discardPersistedSession("session-resume-required");
        try {
          return await this.runTurnAttempt(prompt, options, agentCwd, changeSession, telemetryAgent);
        } catch (retryError) {
          throw this.reportTurnError(retryError, telemetryAgent);
        }
      }
      throw this.reportTurnError(error, telemetryAgent);
    }
  }

  // Runs exactly one agent turn. Timeouts are terminal and resolved here into a
  // user-facing result; any other failure throws (carrying the structured
  // AgentTurnFailedError) so runSend can decide whether to recover and retry.
  private async runTurnAttempt(
    prompt: string,
    options: BabyMenuAgentRuntimeSendOptions,
    agentCwd: string,
    changeSession: AgentChangeSession,
    telemetryAgent: string,
  ): Promise<AgentChatResult> {
    let runtime: AcpxRuntime | null = null;
    let handle: AcpRuntimeHandle | null = null;
    let turnLog: AgentTurnLogRecorder | null = null;

    try {
      runtime = await this.ensureRuntime(agentCwd);
      handle = await withAgentTimeout(
        runtime.ensureSession({
          sessionKey: SESSION_KEY,
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

      this.telemetry?.track("agent_turn", { agent: telemetryAgent, status: "success" });
      return {
        assistantText: output.trim() || "Agent finished without a text response.",
        session: await this.enrichActiveSessionSnapshot(
          changeSession,
          "Review the generated repo changes, then Save or Rollback.",
        ),
      };
    } catch (error) {
      if (!(error instanceof AgentTimeoutError)) {
        await turnLog?.finishFailed(turnFailureDetail(error)).catch(() => undefined);
        throw error;
      }
      await turnLog?.recordTimeout(error).catch(() => undefined);
      this.telemetry?.track("agent_turn", { agent: telemetryAgent, status: "timeout" });

      if (runtime && handle) {
        await runtime.close({ handle, reason: "timeout" }).catch(() => undefined);
      }
      this.runtime = null;
      this.handle = null;
      return {
        assistantText: `The ${this.agentName} agent timed out after ${error.timeoutMs}ms while ${error.phase}. It may have made partial repo changes. Review the working tree, then Save or Rollback. You can retry with BABY_MENU_AGENT_TIMEOUT_MS set higher if needed.`,
        session: await this.enrichActiveSessionSnapshot(
          changeSession,
          "Agent timed out. Review any partial repo changes, then Save or Rollback.",
        ),
      };
    }
  }

  private async enrichActiveSessionSnapshot(session: AgentChangeSession, message: string): Promise<GitSessionSnapshot> {
    const snapshot = await enrichSnapshot(session, message);
    if (snapshot.dirty === false && this.activeSession === session) {
      await session.save().catch(() => undefined);
      this.activeSession = null;
      await this.refreshRuntimeAfterRegistryChange();
    }
    return snapshot;
  }

  private reportTurnError(error: unknown, telemetryAgent: string): unknown {
    this.telemetry?.track("agent_turn", { agent: telemetryAgent, status: "error" });
    return error;
  }

  /**
   * Drops the persisted ACP session so the next turn starts a fresh one. The
   * acpx file session store exposes no delete, and runtime.close's
   * discardPersistentState does NOT remove the on-disk record, so we close the
   * live runtime and delete the persisted session file ourselves.
   */
  private async discardPersistedSession(reason: string): Promise<void> {
    await this.closeRuntime(reason, true, true);
    await rm(this.persistedSessionFilePath(), { force: true }).catch(() => undefined);
  }

  private persistedSessionFilePath(): string {
    const stateDir = this.paths?.agentStateDir ?? getAgentStateDir(this.rootDir);
    return join(stateDir, "sessions", `${SESSION_KEY}.json`);
  }

  async save(message?: string) {
    if (!this.activeSession) return { ok: false, reason: "No active agent change session" };
    const result = await this.activeSession.save(message);
    if (result.ok) {
      this.activeSession = null;
      await this.refreshRuntimeAfterRegistryChange();
    }
    return result;
  }

  async rollback() {
    if (!this.activeSession) return { ok: false, reason: "No active agent change session" };
    const result = await this.activeSession.rollback();
    if (result.ok) {
      this.activeSession = null;
      await this.refreshRuntimeAfterRegistryChange();
    }
    return result;
  }

  async close() {
    await this.closeRuntime("baby-menu-shutdown");
  }

  private async closeRuntime(reason: string, discardPersistentState?: boolean, ignoreCloseError = false): Promise<void> {
    if (!this.runtime || !this.handle) {
      this.runtime = null;
      this.handle = null;
      this.registryOverridesStale = false;
      return;
    }

    const runtime = this.runtime;
    const handle = this.handle;
    this.runtime = null;
    this.handle = null;
    this.registryOverridesStale = false;
    const close = runtime.close({ handle, reason, discardPersistentState });
    if (ignoreCloseError) {
      await close.catch(() => undefined);
      return;
    }
    await close;
  }

  private async refreshRuntimeAfterRegistryChange(): Promise<void> {
    if (!this.registryOverridesStale) return;
    await this.closeRuntime("registry-overrides-change", undefined, true);
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

    return GitChangeSession.begin(this.rootDir, agentCwd);
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
