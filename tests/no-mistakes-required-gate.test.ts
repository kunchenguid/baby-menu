import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SIGNATURE =
  "Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)";
const ATTESTATION_PREFIX = "<!-- no-mistakes-pipeline-attestation:v1 ";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const VERSION_FLOOR = "no-mistakes >= 1.46.0";
const ATTESTATION_PR = "https://github.com/kunchenguid/no-mistakes/pull/670";

const COMPLETED_STEPS = [
  { step: "intent", status: "completed" },
  { step: "rebase", status: "completed" },
  { step: "review", status: "completed" },
  { step: "test", status: "completed" },
  { step: "document", status: "completed" },
  { step: "lint", status: "completed" },
  { step: "push", status: "completed" },
  { step: "pr", status: "running" },
  { step: "ci", status: "pending" },
];

async function gateScript(): Promise<string> {
  const workflow = await readFile(
    resolve(import.meta.dirname, "../.github/workflows/no-mistakes-required.yml"),
    "utf8",
  );
  const header = "- name: Verify no-mistakes signature in PR body\n";
  const headerAt = workflow.indexOf(header);
  if (headerAt < 0) {
    throw new Error("Could not find the no-mistakes gate step in the workflow");
  }
  const runMarker = "        run: |\n";
  const runAt = workflow.indexOf(runMarker, headerAt);
  if (runAt < 0) {
    throw new Error("Could not find the no-mistakes gate script in the workflow");
  }
  return workflow
    .slice(runAt + runMarker.length)
    .replace(/^ {10}/gm, "")
    .replace(/\n+$/, "\n");
}

function attestationComment(
  steps: Array<{ step: string; status: string }>,
  headSha = HEAD_SHA,
): string {
  return `${ATTESTATION_PREFIX}${JSON.stringify({ head_sha: headSha, steps })} -->`;
}

function pipelineBody(parts: { signature?: boolean; comment?: string }): string {
  const lines = ["## Pipeline", ""];
  if (parts.signature !== false) lines.push(SIGNATURE);
  if (parts.comment) lines.push(parts.comment);
  return `${lines.join("\n")}\n`;
}

async function runGate(prBody: string): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
  const script = await gateScript();
  return await new Promise((resolvePromise, reject) => {
    execFile(
      "/bin/bash",
      ["-c", script],
      {
        env: {
          ...process.env,
          PR_BODY: prBody,
          PR_AUTHOR: "alice",
          PR_NUMBER: "42",
        },
      },
      (error, stdout, stderr) => {
        if (error && error.code === "ENOENT") {
          reject(error);
          return;
        }
        const status =
          error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolvePromise({ status, stdout, stderr });
      },
    );
  });
}

describe("no-mistakes-required gate", () => {
  it("keeps the required-check job name", async () => {
    const workflow = await readFile(
      resolve(import.meta.dirname, "../.github/workflows/no-mistakes-required.yml"),
      "utf8",
    );
    expect(workflow).toMatch(/^    name: PR must be raised via no-mistakes$/m);
  });

  it("fails unsigned PRs without treating them as an old no-mistakes client", async () => {
    const result = await runGate("Please merge this change.");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("This PR was not raised through no-mistakes.");
    expect(result.stderr).toContain("git push no-mistakes");
    expect(result.stderr).toContain("CONTRIBUTING.md");
    expect(result.stderr).not.toContain(VERSION_FLOOR);
  });

  it("fails signature-only bodies from older no-mistakes clients", async () => {
    const result = await runGate(pipelineBody({}));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(VERSION_FLOOR);
    expect(result.stderr).toContain(ATTESTATION_PR);
    expect(result.stderr).toContain("only writes the signature");
  });

  it("fails when the attestation comment is not parseable JSON", async () => {
    const result = await runGate(
      pipelineBody({
        comment: `${ATTESTATION_PREFIX}{not-json -->`,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(VERSION_FLOOR);
    expect(result.stderr).toContain(ATTESTATION_PR);
  });

  it("fails when attestation JSON is missing head_sha or steps", async () => {
    const result = await runGate(
      pipelineBody({
        comment: `${ATTESTATION_PREFIX}${JSON.stringify({ steps: COMPLETED_STEPS })} -->`,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(VERSION_FLOOR);
  });

  it("accepts a signature plus completed review, test, and document steps", async () => {
    const result = await runGate(
      pipelineBody({ comment: attestationComment(COMPLETED_STEPS) }),
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Found no-mistakes signature in PR #42 body.");
  });

  it.each([
    ["skipped", "review", "skipped"],
    ["failed", "test", "failed"],
    ["pending", "document", "pending"],
    ["running", "review", "running"],
  ] as const)(
    "fails when %s required step is %s",
    async (_label, step, status) => {
      const steps = COMPLETED_STEPS.map((item) =>
        item.step === step ? { ...item, status } : item,
      );
      const result = await runGate(
        pipelineBody({ comment: attestationComment(steps) }),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${step}=${status}`);
      expect(result.stderr).not.toContain(VERSION_FLOOR);
    },
  );

  it("fails when a required step is missing from the attestation", async () => {
    const steps = COMPLETED_STEPS.filter((item) => item.step !== "document");
    const result = await runGate(
      pipelineBody({ comment: attestationComment(steps) }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("document=missing");
  });
});
