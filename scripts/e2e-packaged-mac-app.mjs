import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const defaultAppPath = resolve("release/mac-universal/Baby Menu Dev.app");
const appPath = resolve(process.argv[2] ?? defaultAppPath);
const executableName = basename(appPath, ".app");
const executablePath = join(appPath, "Contents", "MacOS", executableName);
const timeoutMs = 60_000;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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

async function verifyRenderer(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  try {
    const startedAt = Date.now();
    let requestId = 0;
    while (Date.now() - startedAt < timeoutMs) {
      requestId += 1;
      socket.send(JSON.stringify({
        id: requestId,
        method: "Runtime.evaluate",
        params: {
          expression: "document.readyState === 'complete' && typeof window.babyMenu === 'object'",
          returnByValue: true,
        },
      }));
      const response = await new Promise((resolveMessage, rejectMessage) => {
        const timer = setTimeout(() => rejectMessage(new Error("Timed out probing the packaged renderer")), 10_000);
        const onMessage = (event) => {
          const message = JSON.parse(String(event.data));
          if (message.id !== requestId) return;
          clearTimeout(timer);
          socket.removeEventListener("message", onMessage);
          resolveMessage(message);
        };
        socket.addEventListener("message", onMessage);
      });
      if (!response.error && !response.result?.exceptionDetails && response.result?.result?.value === true) return;
      await delay(100);
    }
    throw new Error("Packaged renderer or preload bridge did not initialize");
  } finally {
    socket.close();
  }
}

async function main() {
  if (process.platform !== "darwin") throw new Error("Packaged macOS runtime E2E requires macOS");

  const testRoot = await mkdtemp(join(tmpdir(), "baby-menu-packaged-runtime-"));
  const testHome = join(testRoot, "home");
  const testAppDataRoot = join(testHome, ".baby-menu");
  await mkdir(testAppDataRoot, { recursive: true });
  await writeFile(join(testAppDataRoot, "preferences.json"), `${JSON.stringify({ openAtLogin: false }, null, 2)}\n`);
  const logPath = join(testRoot, "app.log");
  const port = await reserveLoopbackPort();
  const logHandle = await import("node:fs").then(({ openSync }) => openSync(logPath, "w"));
  const child = spawn(executablePath, [], {
    env: {
      ...process.env,
      HOME: testHome,
      BABY_MENU_KEEP_POPOVER_OPEN: "1",
      BABY_MENU_OPEN_POPOVER_ON_START: "1",
      BABY_MENU_REMOTE_DEBUGGING_PORT: String(port),
      BABY_MENU_TELEMETRY: "0",
    },
    stdio: ["ignore", logHandle, logHandle],
  });

  try {
    const target = await waitForRenderer(child, `http://127.0.0.1:${port}`, logPath);
    await verifyRenderer(target);
    process.stdout.write(`${JSON.stringify({ app: appPath, rendererReady: true, preloadReady: true })}\n`);
  } finally {
    await stopApp(child);
    await rm(testRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
