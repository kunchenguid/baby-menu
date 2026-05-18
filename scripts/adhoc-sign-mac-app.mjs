import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const appPath = process.argv[2];
if (!appPath) {
  console.error("Usage: node scripts/adhoc-sign-mac-app.mjs <app-path>");
  process.exit(1);
}

if (process.platform !== "darwin") {
  console.log("Skipping ad-hoc signing because this host is not macOS.");
  process.exit(0);
}

if (!existsSync(appPath)) {
  console.error(`Cannot sign missing app bundle: ${appPath}`);
  process.exit(1);
}

const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
process.exit(result.status ?? 1);
