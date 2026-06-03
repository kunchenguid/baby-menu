import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { CodexDriver } from "../src/adapters/codex/driver";
import type * as schema from "@agentclientprotocol/sdk";

const FAKE = join(__dirname, "fixtures", "fake-clis", "fake-codex.mjs");

function waitForFile(path: string): Promise<void> {
  if (existsSync(path)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = watch(dirname(path), (_event, filename) => {
      if (filename === basename(path) && existsSync(path)) {
        watcher.close();
        resolve();
      }
    });
    watcher.on("error", (error) => {
      watcher.close();
      reject(error);
    });
  });
}

async function slowCancelGate(): Promise<{ prompt: string; terminated: Promise<void>; release: () => Promise<void> }> {
  // The fake CLI reports SIGTERM through one file and waits on the other before
  // exiting, which lets the tests assert ordering without wall-clock races.
  const dir = await mkdtemp(join(tmpdir(), "codex-driver-"));
  const sentinel = join(dir, "release-exit");
  const terminated = join(dir, "observed-sigterm");
  return { prompt: `SLOW_CANCEL:${sentinel}:${terminated}`, terminated: waitForFile(terminated), release: () => writeFile(sentinel, "") };
}

describe("CodexDriver (against a fake codex CLI)", () => {
  let driver: CodexDriver | null = null;
  afterEach(async () => {
    await driver?.dispose();
    driver = null;
  });

  function makeDriver(): CodexDriver {
    driver = new CodexDriver({ command: FAKE });
    return driver;
  }

  it("streams an assistant chunk and resolves end_turn", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const updates: schema.SessionUpdate[] = [];
    const stop = await d.prompt("hello", (u) => updates.push(u), new AbortController().signal);
    expect(stop).toBe("end_turn");
    expect(updates.find((u) => u.sessionUpdate === "agent_message_chunk")).toMatchObject({
      content: { type: "text", text: "echo:hello" },
    });
  });

  it("resumes the session on the second prompt (carries memory)", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const s = new AbortController().signal;
    await d.prompt("first", () => {}, s);
    const updates: schema.SessionUpdate[] = [];
    await d.prompt("second", (u) => updates.push(u), s);
    // The fake replies "resumed:..." only when invoked via `exec resume <id>`,
    // proving the driver captured session.created and threaded it through.
    expect(updates.find((u) => u.sessionUpdate === "agent_message_chunk")).toMatchObject({
      content: { type: "text", text: "resumed:second" },
    });
  });

  it("does not pass --color to `exec resume` (codex rejects it with exit 2)", async () => {
    // Regression: the resume subcommand in codex-cli 0.130.0 does not accept
    // --color, so reusing the first-turn flag list on resume failed every
    // follow-up turn with "codex exec exited with code 2". The fake CLI exits 2
    // if it sees --color on a resume, mirroring real codex.
    const d = makeDriver();
    await d.start(tmpdir());
    const s = new AbortController().signal;
    await d.prompt("first", () => {}, s);
    const updates: schema.SessionUpdate[] = [];
    const stop = await d.prompt("second", (u) => updates.push(u), s);
    expect(stop).toBe("end_turn");
    expect(updates.find((u) => u.sessionUpdate === "agent_message_chunk")).toMatchObject({
      content: { type: "text", text: "resumed:second" },
    });
  });

  it("passes --model on both first and resume turns when a model is configured", async () => {
    // Regression: --ignore-user-config strips ~/.codex/config.toml's `model`
    // line, so codex falls back to a built-in default that is unsupported on
    // ChatGPT-account logins (400 invalid_request_error). The driver must inject
    // the configured model explicitly on every turn so codex talks to a model
    // the account can actually use.
    const dir = await mkdtemp(join(tmpdir(), "codex-args-"));
    const argsFile = join(dir, "args.json");
    process.env.FAKE_CODEX_ARGS_FILE = argsFile;
    try {
      driver = new CodexDriver({ command: FAKE, model: "gpt-5.5" });
      await driver.start(tmpdir());
      const s = new AbortController().signal;
      await driver.prompt("first", () => {}, s);
      const firstArgs = JSON.parse(await readFile(argsFile, "utf8")) as string[];
      expect(firstArgs).toContain("--model");
      expect(firstArgs[firstArgs.indexOf("--model") + 1]).toBe("gpt-5.5");

      await driver.prompt("second", () => {}, s);
      const resumeArgs = JSON.parse(await readFile(argsFile, "utf8")) as string[];
      expect(resumeArgs[0]).toBe("exec");
      expect(resumeArgs[1]).toBe("resume");
      expect(resumeArgs).toContain("--model");
      expect(resumeArgs[resumeArgs.indexOf("--model") + 1]).toBe("gpt-5.5");
    } finally {
      delete process.env.FAKE_CODEX_ARGS_FILE;
    }
  });

  it("omits --model when no model is configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "codex-args-"));
    const argsFile = join(dir, "args.json");
    process.env.FAKE_CODEX_ARGS_FILE = argsFile;
    try {
      const d = makeDriver();
      await d.start(tmpdir());
      await d.prompt("first", () => {}, new AbortController().signal);
      const args = JSON.parse(await readFile(argsFile, "utf8")) as string[];
      expect(args).not.toContain("--model");
    } finally {
      delete process.env.FAKE_CODEX_ARGS_FILE;
    }
  });

  it("surfaces a command tool_call and tool_call_update", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const updates: schema.SessionUpdate[] = [];
    await d.prompt("please RUN_TOOL now", (u) => updates.push(u), new AbortController().signal);
    expect(updates.some((u) => u.sessionUpdate === "tool_call")).toBe(true);
    expect(updates.some((u) => u.sessionUpdate === "tool_call_update")).toBe(true);
  });

  it("resolves cancelled when the signal aborts before spawning", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const ac = new AbortController();
    ac.abort();
    expect(await d.prompt("hi", () => {}, ac.signal)).toBe("cancelled");
  });

  it("waits for the child process to exit before resolving cancellation", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const gate = await slowCancelGate();
    const ac = new AbortController();
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const prompt = d.prompt(
      gate.prompt,
      (u) => {
        if (u.sessionUpdate === "agent_message_chunk") ready();
      },
      ac.signal,
    );
    await readyPromise;
    let released = false;
    let settled = false;
    const settlement = prompt.then((result) => {
      settled = true;
      return { result, released };
    });
    ac.abort();
    await gate.terminated;
    await Promise.resolve();
    expect(settled).toBe(false);

    released = true;
    await gate.release();
    expect(await settlement).toEqual({ result: "cancelled", released: true });
  });

  it("waits for the child process to exit before resolving disposal", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const gate = await slowCancelGate();
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const prompt = d.prompt(
      gate.prompt,
      (u) => {
        if (u.sessionUpdate === "agent_message_chunk") ready();
      },
      new AbortController().signal,
    );
    await readyPromise;

    const disposal = d.dispose();
    let released = false;
    let disposed = false;
    const settlement = disposal.then(() => {
      disposed = true;
      return { released };
    });
    await gate.terminated;
    await Promise.resolve();
    expect(disposed).toBe(false);

    released = true;
    await gate.release();
    expect(await settlement).toEqual({ released: true });
    expect(disposed).toBe(true);
    expect(await prompt).toBe("cancelled");
  });

  it("force-kills a child that outlives the termination grace period", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const prompt = d.prompt(
      "SLOW_FORCE_KILL",
      (u) => {
        if (u.sessionUpdate === "agent_message_chunk") ready();
      },
      new AbortController().signal,
    );
    await readyPromise;

    // The child swallows SIGTERM, so disposal can only resolve once the driver's
    // SIGKILL after TERMINATION_GRACE_MS terminates it. Awaiting disposal is a
    // deterministic proof of force-kill: if it never fired, this would hang and
    // fail via the test timeout instead of flaking on a race window.
    await d.dispose();
    expect(await prompt).toBe("cancelled");
  });
});
