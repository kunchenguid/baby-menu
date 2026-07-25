import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { listPackage } from "@electron/asar";
import { mockAgentArgs } from "acp-mock";

const defaultAppPath = resolve("release/mac-universal/Baby Menu Dev.app");
const appPath = resolve(process.argv[2] ?? defaultAppPath);
const executableName = basename(appPath, ".app");
const executablePath = join(appPath, "Contents", "MacOS", executableName);
const acpMockBinPath = resolve("node_modules/acp-mock/dist/cli.js");
const mockAgentName = "packaged-mock";
const mockAgentSummary = "packaged acpx runtime completed without esbuild";
const timeoutMs = 60_000;
const forbiddenEsbuildPath = /(?:^|[\\/])node_modules[\\/](?:@esbuild|esbuild)(?:[\\/]|$)/;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export async function assertNoPackagedEsbuild(candidateAppPath = appPath) {
  const resourcesPath = join(candidateAppPath, "Contents", "Resources");
  const unpackedPath = join(resourcesPath, "app.asar.unpacked");
  let unpackedEntries = [];
  try {
    unpackedEntries = await readdir(unpackedPath, { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const forbiddenUnpackedEntry = unpackedEntries.find((entry) => forbiddenEsbuildPath.test(entry));
  if (forbiddenUnpackedEntry) {
    throw new Error(
      `Packaged app contains forbidden runtime path: ${join(unpackedPath, forbiddenUnpackedEntry)}`,
    );
  }

  const forbiddenEntry = listPackage(join(resourcesPath, "app.asar"))
    .find((entry) => forbiddenEsbuildPath.test(entry));
  if (forbiddenEntry) {
    throw new Error(`Packaged app archive contains forbidden runtime path: ${forbiddenEntry}`);
  }
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port");
  return address.port;
}

async function stopApp(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited) child.kill("SIGKILL");
}

async function waitForRenderer(child, browserUrl, logPath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const log = await readFile(logPath, "utf8").catch(() => "");
      throw new Error(`Packaged app exited before its renderer became ready\n${log}`);
    }
    const target = await fetch(`${browserUrl}/json/list`)
      .then(async (response) => response.ok ? response.json() : [])
      .then((targets) => targets.find((candidate) =>
        candidate.type === "page" && typeof candidate.webSocketDebuggerUrl === "string"))
      .catch(() => undefined);
    if (target) return target;
    await delay(100);
  }
  const log = await readFile(logPath, "utf8").catch(() => "");
  throw new Error(`Timed out waiting for the packaged app renderer\n${log}`);
}

async function evaluate(socket, requestId, expression, awaitPromise = false) {
  socket.send(JSON.stringify({
    id: requestId,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise, returnByValue: true },
  }));
  const response = await new Promise((resolveMessage, rejectMessage) => {
    const timer = setTimeout(() => rejectMessage(new Error("Timed out probing the packaged renderer")), timeoutMs);
    const onMessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== requestId) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolveMessage(message);
    };
    socket.addEventListener("message", onMessage);
  });
  if (response.error || response.result?.exceptionDetails) {
    throw new Error(`Packaged renderer evaluation failed: ${JSON.stringify(response)}`);
  }
  return response.result?.result?.value;
}

async function verifyRendererAndAgent(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  try {
    const startedAt = Date.now();
    let requestId = 0;
    let rendererReady = false;
    while (Date.now() - startedAt < timeoutMs) {
      requestId += 1;
      rendererReady = await evaluate(
        socket,
        requestId,
        "document.readyState === 'complete' && typeof window.babyMenu === 'object'",
      );
      if (rendererReady) break;
      await delay(100);
    }
    if (!rendererReady) throw new Error("Packaged renderer or preload bridge did not initialize");

    requestId += 1;
    const agentResult = await evaluate(
      socket,
      requestId,
      `window.babyMenu.agent.send(${JSON.stringify("Verify the packaged ACP runtime")})`,
      true,
    );
    if (!agentResult || !String(agentResult.assistantText).includes(mockAgentSummary)) {
      throw new Error(`Packaged agent turn failed: ${JSON.stringify(agentResult)}`);
    }
    return agentResult;
  } finally {
    socket.close();
  }
}

async function readMockEvents(eventLogPath) {
  const text = await readFile(eventLogPath, "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line).event);
}

async function main() {
  if (process.platform !== "darwin") throw new Error("Packaged macOS runtime E2E requires macOS");

  await assertNoPackagedEsbuild();
  const testRoot = await mkdtemp(join(tmpdir(), "baby-menu-packaged-runtime-"));
  const testHome = join(testRoot, "home");
  const testAppDataRoot = join(testHome, ".baby-menu");
  const mockEventLogPath = join(testRoot, "mock-acp.jsonl");
  await mkdir(testAppDataRoot, { recursive: true });
  await writeFile(
    join(testAppDataRoot, "preferences.json"),
    `${JSON.stringify({ openAtLogin: false, agentName: mockAgentName }, null, 2)}\n`,
  );
  const launchCommand = [
    process.execPath,
    acpMockBinPath,
    ...mockAgentArgs({
      eventLogPath: mockEventLogPath,
      agentMessageJson: { summary: mockAgentSummary },
    }),
  ].map(shellQuote).join(" ");
  await writeFile(join(testAppDataRoot, "agents.json"), `${JSON.stringify([{
    name: mockAgentName,
    label: "Packaged Mock Agent",
    command: mockAgentName,
    launchCommand,
  }], null, 2)}\n`);

  const logPath = join(testRoot, "app.log");
  const port = await reserveLoopbackPort();
  const logHandle = await import("node:fs").then(({ openSync }) => openSync(logPath, "w"));
  const child = spawn(executablePath, [], {
    env: {
      ...process.env,
      HOME: testHome,
      BABY_MENU_PACKAGED_TEST_HOME: testHome,
      BABY_MENU_KEEP_POPOVER_OPEN: "1",
      BABY_MENU_OPEN_POPOVER_ON_START: "1",
      BABY_MENU_REMOTE_DEBUGGING_PORT: String(port),
      BABY_MENU_AGENT_TIMEOUT_MS: String(timeoutMs),
      BABY_MENU_TELEMETRY: "0",
    },
    stdio: ["ignore", logHandle, logHandle],
  });

  try {
    const target = await waitForRenderer(child, `http://127.0.0.1:${port}`, logPath);
    const agentResult = await verifyRendererAndAgent(target);
    const mockEvents = await readMockEvents(mockEventLogPath);
    if (!mockEvents.includes("agent:prompt:done")) {
      throw new Error(`Packaged ACP agent did not complete a prompt: ${JSON.stringify(mockEvents)}`);
    }
    process.stdout.write(`${JSON.stringify({
      app: appPath,
      rendererReady: true,
      preloadReady: true,
      agentRuntimeReady: true,
      assistantText: agentResult.assistantText,
    })}\n`);
  } finally {
    await stopApp(child);
    await rm(testRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
