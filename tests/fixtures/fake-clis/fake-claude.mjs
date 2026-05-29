#!/usr/bin/env node
// Minimal fake of `claude -p [--resume <id>] <prompt> --output-format stream-json --verbose`.
// Emits stream-json events mirroring the real flat shape, then exits (the driver
// runs one process per turn). Echoes whether it was resumed so the driver's
// session threading can be asserted. Kept in sync with
// tests/fixtures/protocols/claude/*.jsonl.
// Special SLOW_* prompts are test controls for cancellation and child-process
// termination behavior rather than captured protocol fixtures.
import { existsSync, writeFileSync } from "node:fs";

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const argv = process.argv.slice(2);
const resumeIdx = argv.indexOf("--resume");
const isResume = resumeIdx >= 0;
// The prompt is the final positional arg.
const prompt = argv[argv.length - 1] ?? "";

if (prompt.includes("SLOW_CANCEL")) {
  // Register the SIGTERM handler BEFORE announcing readiness. The parent reads
  // "ready" the instant the bytes hit the pipe and may fire SIGTERM while this
  // process is still mid-script; registering after the emit left a window where
  // SIGTERM hit Node's default action (immediate termination) and the child
  // died early. Once terminated, exit only when the test creates the sentinel
  // release file encoded in the prompt, so the driver's disposal
  // and cancellation promises stay pending until the test releases us - no
  // wall-clock race decides the outcome.
  const [, releaseFile = null, terminatedFile = null] = prompt.match(/SLOW_CANCEL:(\S+):(\S+)/) ?? [];
  let terminating = false;
  process.on("SIGTERM", () => {
    terminating = true;
    if (terminatedFile) writeFileSync(terminatedFile, "");
  });
  emit({ type: "system", subtype: "init", session_id: "fake-session", model: "fake", cwd: process.cwd() });
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ready" }] } });
  setInterval(() => {
    if (terminating && (!releaseFile || existsSync(releaseFile))) process.exit(0);
  }, 5);
  await new Promise(() => {});
}

if (prompt.includes("SLOW_FORCE_KILL")) {
  // Swallow SIGTERM entirely so only the driver's SIGKILL after the termination
  // grace period can stop us. The test proves force-kill happened simply by
  // observing that disposal completes at all. Registered before "ready" for the
  // same reason as SLOW_CANCEL above.
  process.on("SIGTERM", () => {});
  emit({ type: "system", subtype: "init", session_id: "fake-session", model: "fake", cwd: process.cwd() });
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ready" }] } });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

// Real claude emits SessionStart hook noise + an init line carrying session_id.
emit({ type: "system", subtype: "hook_started", hook_name: "SessionStart" });
emit({ type: "system", subtype: "init", session_id: "fake-session", model: "fake", cwd: process.cwd() });

if (prompt.includes("RUN_TOOL")) {
  emit({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_fake", name: "Bash", input: { command: "echo hi" } }] },
  });
  emit({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_fake", is_error: false, content: "hi" }] },
  });
}

const reply = isResume ? `resumed:${prompt}` : `echo:${prompt}`;
emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: reply }] } });
emit({ type: "result", subtype: "success", is_error: false, result: reply, stop_reason: "end_turn", session_id: "fake-session" });
process.exit(0);
