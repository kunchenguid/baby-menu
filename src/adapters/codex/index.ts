import { runAdapter } from "../shared/acp-agent.js";
import { CodexDriver } from "./driver.js";

// Entry point: acpx spawns `node <this> ...` and speaks ACP over stdio.
runAdapter(new CodexDriver(), "codex-adapter");
