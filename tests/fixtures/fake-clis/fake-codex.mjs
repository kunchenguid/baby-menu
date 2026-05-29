#!/usr/bin/env node
// Minimal fake of `codex exec --json [resume <id>] <prompt>`. Emits codex-exec
// JSONL mirroring the real flat shape, then exits (exec is one-shot per turn).
// Captures resume to prove the driver threads the thread id across turns.
// Kept in sync with tests/fixtures/protocols/codex/exec-*.jsonl.
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

const argv = process.argv.slice(2);
const isResume = argv[0] === "exec" && argv[1] === "resume";
// The prompt is the final positional arg.
const prompt = argv[argv.length - 1] ?? "";

if (prompt.includes("SLOW_CANCEL")) {
  emit({ type: "thread.started", thread_id: "fake-thread" });
  emit({ type: "turn.started" });
  emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "ready" } });
  process.on("SIGTERM", () => setTimeout(() => process.exit(0), 100));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (prompt.includes("SLOW_FORCE_KILL")) {
  emit({ type: "thread.started", thread_id: "fake-thread" });
  emit({ type: "turn.started" });
  emit({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "ready" } });
  process.on("SIGTERM", () => setTimeout(() => process.exit(0), 2000));
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
