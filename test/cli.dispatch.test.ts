import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli";
import { GuardPolicySchema } from "../src/sevenShadowSystem";

test("runCli supports explicit guard and implicit guard modes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sss-cli-dispatch-"));

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");

    const policy = GuardPolicySchema.parse({
      version: 2,
      enforcement: "block",
      blockBotAuthors: true,
      blockedAuthors: [],
      allowedAuthors: [],
      scanPrBody: true,
      scanReviewBody: true,
      scanCommentBody: true,
      maxAiScore: 0.7,
      disclosureTag: "[AI-ASSISTED]",
      disclosureRequiredScore: 0.5,
      runtime: {
        failOnUnsupportedEvent: true,
        failOnMalformedPayload: true,
        maxBodyChars: 12000,
        maxTargets: 25,
        maxEventBytes: 1000000
      },
      report: {
        includeBodies: false,
        redactionMode: "hash"
      },
      approvals: {
        minHumanApprovals: 0,
        fetchTimeoutMs: 1000,
        maxPages: 2,
        retry: {
          enabled: true,
          maxAttempts: 1,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0,
          retryableStatusCodes: [429]
        }
      },
      rules: [
        {
          name: "template",
          pattern: "great work",
          action: "score",
          weight: 0.2
        }
      ]
    });

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: { number: 1, body: "Body", user: { login: "owner", type: "User" } },
        review: { id: 2, body: "Great work [AI-ASSISTED]", user: { login: "reviewer", type: "User" } }
      })}\n`,
      "utf8"
    );

    const explicitCode = await runCli([
      "guard",
      "--policy",
      policyPath,
      "--event",
      eventPath,
      "--event-name",
      "pull_request_review"
    ]);

    const implicitCode = await runCli([
      "--policy",
      policyPath,
      "--event",
      eventPath,
      "--event-name",
      "pull_request_review"
    ]);

    assert.equal(explicitCode, 0);
    assert.equal(implicitCode, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

 test("runCli throws on unknown command", async () => {
  await assert.rejects(async () => {
    await runCli(["unknown-command"]);
  }, /E_UNKNOWN_COMMAND/);
});
