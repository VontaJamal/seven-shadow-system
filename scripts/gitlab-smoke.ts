import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSevenShadowSystem } from "../src/sevenShadowSystem";

interface SmokeReport {
  provider: string;
  decision: "pass" | "warn" | "block";
  findings: Array<{
    code: string;
    message: string;
  }>;
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-gitlab-smoke-"));
}

function withMinApprovals(policy: Record<string, unknown>, minHumanApprovals: number): Record<string, unknown> {
  const approvals = (policy.approvals ?? {}) as Record<string, unknown>;
  return {
    ...policy,
    approvals: {
      ...approvals,
      minHumanApprovals
    }
  };
}

async function runSmokeCase(options: {
  tempDir: string;
  policyPath: string;
  eventPath: string;
  eventName: string;
  reportName: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ code: number; report: SmokeReport }> {
  const reportPath = path.join(options.tempDir, `${options.reportName}.json`);
  const code = await runSevenShadowSystem(
    [
      "--policy",
      options.policyPath,
      "--provider",
      "gitlab",
      "--event",
      options.eventPath,
      "--event-name",
      options.eventName,
      "--report",
      reportPath
    ],
    options.env
  );

  const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as SmokeReport;
  return { code, report };
}

async function run(): Promise<void> {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const basePolicyPath = path.join(process.cwd(), "config", "seven-shadow-system.policy.json");
    const mergeEventPath = path.join(process.cwd(), "examples", "gitlab", "merge-request-hook.json");
    const noteEventPath = path.join(process.cwd(), "examples", "gitlab", "note-hook.json");
    const policyPath = path.join(tempDir, "policy.gitlab-smoke.json");

    const basePolicyRaw = JSON.parse(await fs.readFile(basePolicyPath, "utf8")) as Record<string, unknown>;
    const smokePolicy = withMinApprovals(basePolicyRaw, 1);
    await fs.writeFile(policyPath, `${JSON.stringify(smokePolicy, null, 2)}\n`, "utf8");

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          approved_by: [
            {
              user: {
                username: "release-reviewer",
                bot: false
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );

    const mergeResult = await runSmokeCase({
      tempDir,
      policyPath,
      eventPath: mergeEventPath,
      eventName: "Merge Request Hook",
      reportName: "merge-request",
      env: { ...process.env, GITLAB_TOKEN: "smoke-token", GITHUB_TOKEN: "" }
    });
    assert.equal(mergeResult.code, 0, "Merge Request Hook smoke case should pass");
    assert.equal(mergeResult.report.provider, "gitlab");
    assert.equal(mergeResult.report.findings.some((item) => item.code === "GUARD_APPROVALS_UNVERIFIED"), false);

    const noteResult = await runSmokeCase({
      tempDir,
      policyPath,
      eventPath: noteEventPath,
      eventName: "Note Hook",
      reportName: "note-hook",
      env: { ...process.env, GITLAB_TOKEN: "smoke-token", GITHUB_TOKEN: "" }
    });
    assert.equal(noteResult.code, 0, "Note Hook smoke case should pass");
    assert.equal(noteResult.report.provider, "gitlab");
    assert.equal(noteResult.report.findings.some((item) => item.code === "GUARD_APPROVALS_UNVERIFIED"), false);

    const missingTokenResult = await runSmokeCase({
      tempDir,
      policyPath,
      eventPath: mergeEventPath,
      eventName: "Merge Request Hook",
      reportName: "missing-token",
      env: { ...process.env, GITLAB_TOKEN: "", GITHUB_TOKEN: "" }
    });
    assert.equal(missingTokenResult.code, 1, "Missing token case should fail closed");

    const missingTokenFinding = missingTokenResult.report.findings.find(
      (item) => item.code === "GUARD_APPROVALS_UNVERIFIED"
    );
    assert.ok(missingTokenFinding, "Missing token case should report GUARD_APPROVALS_UNVERIFIED");
    assert.match(missingTokenFinding.message, /GITLAB_TOKEN unavailable/);

    console.log("GitLab smoke checks passed.");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`GitLab smoke failed: ${message}`);
  process.exit(1);
});
