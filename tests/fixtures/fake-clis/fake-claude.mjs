#!/usr/bin/env node
// Minimal fake of `claude -p [--resume <id>] <prompt> --output-format stream-json --verbose`.
// Emits stream-json events mirroring the real flat shape, then exits (the driver
// runs one process per turn). Echoes whether it was resumed so the driver's
// session threading can be asserted. Kept in sync with
// tests/fixtures/protocols/claude/*.jsonl.
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const argv = process.argv.slice(2);
const resumeIdx = argv.indexOf("--resume");
const isResume = resumeIdx >= 0;
// The prompt is the final positional arg.
const prompt = argv[argv.length - 1] ?? "";

if (prompt.includes("SLOW_CANCEL")) {
  emit({ type: "system", subtype: "init", session_id: "fake-session", model: "fake", cwd: process.cwd() });
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ready" }] } });
  process.on("SIGTERM", () => setTimeout(() => process.exit(0), 100));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (prompt.includes("SLOW_FORCE_KILL")) {
  emit({ type: "system", subtype: "init", session_id: "fake-session", model: "fake", cwd: process.cwd() });
  emit({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ready" }] } });
  process.on("SIGTERM", () => setTimeout(() => process.exit(0), 2000));
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
