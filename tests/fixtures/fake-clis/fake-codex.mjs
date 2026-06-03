#!/usr/bin/env node
// Minimal fake of `codex exec --json [resume <id>] <prompt>`. Emits codex-exec
// JSONL mirroring the real flat shape, then exits (exec is one-shot per turn).
// Captures resume to prove the driver threads the thread id across turns.
// Kept in sync with tests/fixtures/protocols/codex/exec-*.jsonl.
// Special SLOW_* prompts are test controls for cancellation and child-process
// termination behavior rather than captured protocol fixtures.
import { existsSync, writeFileSync } from "node:fs";

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const argv = process.argv.slice(2);
// Optional arg capture so driver tests can assert which flags were passed
// (e.g. --model). Overwritten on every invocation, so the last turn wins.
if (process.env.FAKE_CODEX_ARGS_FILE) {
  writeFileSync(process.env.FAKE_CODEX_ARGS_FILE, JSON.stringify(argv));
}
const isResume = argv[0] === "exec" && argv[1] === "resume";
// The prompt is the final positional arg.
const prompt = argv[argv.length - 1] ?? "";

// Mirror real codex-cli 0.130.0: `--color` is valid on `codex exec` but the
// `resume` subcommand rejects it with a clap usage error (exit code 2). The
// driver must not pass `--color` to resume.
if (isResume && argv.includes("--color")) {
  process.stderr.write("error: unexpected argument '--color' found\n");
  process.exit(2);
}

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
  emit({ type: "thread.started", thread_id: "fake-thread" });
  emit({ type: "turn.started" });
  emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "ready" } });
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
  emit({ type: "thread.started", thread_id: "fake-thread" });
  emit({ type: "turn.started" });
  emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "ready" } });
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (!isResume) {
  emit({ type: "thread.started", thread_id: "fake-thread" });
}
emit({ type: "turn.started" });
emit({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "**Thinking**" } });

if (prompt.includes("RUN_TOOL")) {
  emit({
    type: "item.completed",
    item: { id: "item_x", type: "command_execution", command: "echo hi", status: "completed", exit_code: 0, aggregated_output: "hi\n" },
  });
}

const reply = isResume ? `resumed:${prompt}` : `echo:${prompt}`;
emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: reply } });
emit({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
process.exit(0);
