import { runAdapter } from "../shared/acp-agent.js";
import { CodexDriver } from "./driver.js";
import { readCodexModel } from "./config.js";

// Entry point: acpx spawns `node <this> ...` and speaks ACP over stdio.
// We run codex with --ignore-user-config to stay lean, which also discards the
// user's configured model, so read just that one setting back and pass it as
// --model. Without it, codex defaults to a model unsupported on ChatGPT-account
// logins and every turn dies with a 400.
runAdapter(new CodexDriver({ model: readCodexModel() ?? undefined }), "codex-adapter");
