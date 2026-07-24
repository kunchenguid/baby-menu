import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

const candidates = filesUnder(appPath).sort((left, right) =>
  right.split("/").length - left.split("/").length);

for (const candidate of candidates) {
  const fileType = spawnSync("file", ["-b", candidate], { encoding: "utf8" });
  if (fileType.status !== 0) process.exit(fileType.status ?? 1);
  if (fileType.stdout.includes("Mach-O")) {
    run("codesign", ["--force", "--sign", "-", candidate]);
  }
}

run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
