import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { GuardPolicySchema, runSevenShadowSystem } from "../src/sevenShadowSystem";

interface AccessibilitySnapshot {
  report: Record<string, unknown>;
  markdown: string;
  sarif: Record<string, unknown>;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

async function readSnapshot(): Promise<AccessibilitySnapshot> {
  const snapshotPath = path.join(process.cwd(), "test", "snapshots", "accessibility-report.snapshot.json");
  const raw = await fs.readFile(snapshotPath, "utf8");
  return JSON.parse(raw) as AccessibilitySnapshot;
}

test("accessibility snapshots remain stable for JSON/Markdown/SARIF reports", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-accessibility-"));

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportBase = path.join(tempDir, "report");

    const policy = GuardPolicySchema.parse({
      version: 2,
      enforcement: "block",
      blockBotAuthors: true,
      blockedAuthors: [],
      allowedAuthors: [],
      scanPrBody: true,
      scanReviewBody: true,
      scanCommentBody: true,
      maxAiScore: 0.75,
      disclosureTag: "[AI-ASSISTED]",
      disclosureRequiredScore: 0.45,
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
        fetchTimeoutMs: 10000,
        maxPages: 10,
        retry: {
          enabled: true,
          maxAttempts: 3,
          baseDelayMs: 250,
          maxDelayMs: 2500,
          jitterRatio: 0,
          retryableStatusCodes: [429, 500, 502, 503, 504]
        }
      },
      rules: [
        {
          name: "generic-template-great-work",
          pattern: "\\bgreat work\\b",
          action: "score",
          weight: 0.3
        },
        {
          name: "explicit-ai-disclaimer",
          pattern: "\\bas an ai language model\\b",
          action: "block"
        }
      ]
    });

    const eventPayload = {
      repository: { full_name: "acme/repo" },
      pull_request: {
        number: 42,
        body: "PR body from human",
        user: { login: "repo-owner", type: "User" }
      },
      review: {
        id: 13,
        body: "Great work on this change [AI-ASSISTED]",
        user: { login: "human-reviewer", type: "User" }
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await fs.writeFile(eventPath, `${JSON.stringify(eventPayload, null, 2)}\n`, "utf8");

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportBase,
        "--report-format",
        "all",
        "--redact"
      ],
      process.env
    );

    assert.equal(code, 0);

    const reportJson = JSON.parse(await fs.readFile(`${reportBase}.json`, "utf8")) as Record<string, unknown>;
    const markdown = normalizeLineEndings(await fs.readFile(`${reportBase}.md`, "utf8"));
    const sarif = JSON.parse(await fs.readFile(`${reportBase}.sarif`, "utf8")) as Record<string, unknown>;
    const expected = await readSnapshot();

    const normalizedReport: Record<string, unknown> = {
      ...reportJson,
      timestamp: "<timestamp>",
      policyPath: "<policy-path>",
      generatedReports: Array.isArray(reportJson.generatedReports)
        ? (reportJson.generatedReports as unknown[]).map((item) => path.basename(String(item))).sort()
        : []
    };

    assert.deepEqual(normalizedReport, expected.report);
    assert.equal(markdown, expected.markdown);
    assert.deepEqual(sarif, expected.sarif);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
