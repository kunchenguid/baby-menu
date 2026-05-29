import { runAdapter } from "../shared/acp-agent.js";
import { ClaudeDriver } from "./driver.js";

// Entry point: acpx spawns `node <this> ...` and speaks ACP over stdio.
runAdapter(new ClaudeDriver(), "claude-adapter");
