import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ACTION_SHA = "32d396ac0f29135daf7fcb9964aba9d5f4e796d6";
const ACTION =
  `kunchenguid/no-mistakes/.github/actions/require-no-mistakes@${ACTION_SHA}`;

interface PullRequestTrigger {
  types: string[];
  branches: string[];
  "paths-ignore": string[];
}

interface Workflow {
  name: string;
  "run-name": string;
  on: { pull_request: PullRequestTrigger };
  permissions: { contents: string };
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<
    string,
    {
      name: string;
      "runs-on": string;
      if: string;
      steps: Array<{ name: string; uses?: string; run?: string; with?: unknown }>;
    }
  >;
}

async function workflow(): Promise<Workflow> {
  const source = await readFile(
    resolve(import.meta.dirname, "../.github/workflows/no-mistakes-required.yml"),
    "utf8",
  );
  return parse(source) as Workflow;
}

describe("no-mistakes-required workflow contract", () => {
  it("preserves the pull request boundary and required-check identity", async () => {
    const config = await workflow();

    expect(config.name).toBe("Require no-mistakes");
    expect(config["run-name"]).toBe(
      "PR #${{ github.event.pull_request.number }} body compliance - ${{ github.event.action }} - event ${{ github.run_number }} (run ${{ github.run_id }})",
    );
    expect(config.on.pull_request).toEqual({
      types: ["opened", "edited", "reopened"],
      branches: ["main"],
      "paths-ignore": [
        ".release-please-manifest.json",
        "CHANGELOG.md",
        "package.json",
      ],
    });
    expect(config.permissions).toEqual({ contents: "read" });
    expect(config.concurrency).toEqual({
      group:
        "no-mistakes-required-${{ github.event.pull_request.number }}-${{ (github.event.action == 'opened' || github.event.action == 'edited') && github.run_id || 'head-change' }}",
      "cancel-in-progress": true,
    });

    const check = config.jobs.check;
    expect(check.name).toBe("PR must be raised via no-mistakes");
    expect(check["runs-on"]).toBe("ubuntu-latest");
    expect(check.if).toBe(
      "github.event.pull_request.user.login != 'github-actions[bot]' && github.event.pull_request.user.login != 'dependabot[bot]' && github.event.pull_request.user.login != 'release-please[bot]'",
    );
  });

  it("delegates the only job step to the immutable shared action without moving exemptions into inputs", async () => {
    const config = await workflow();
    const steps = config.jobs.check.steps;

    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      name: "Verify no-mistakes signature and pipeline attestation in PR body",
      uses: ACTION,
    });
    expect(steps[0].run).toBeUndefined();
    expect(steps[0].with).toBeUndefined();
  });
});
