import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { renderCommentsMarkdown } from "../src/commands/render/commentsMarkdown";
import { renderCommentsXml } from "../src/commands/render/commentsXml";
import { renderFailuresMarkdown } from "../src/commands/failures";
import { renderLintMarkdown } from "../src/commands/lint";
import { renderTestQualityMarkdown } from "../src/commands/testQuality";
import type { FailuresReport, LintReport, TestQualityReport } from "../src/commands/types";
import type { SentinelUnresolvedComment } from "../src/providers/types";

interface SentinelOutputSnapshot {
  commentsMarkdown: string;
  commentsXml: string;
  failuresMarkdown: string;
  lintMarkdown: string;
  testQualityMarkdown: string;
}

async function readSnapshot(): Promise<SentinelOutputSnapshot> {
  const snapshotPath = path.join(process.cwd(), "test", "snapshots", "sentinel-outputs.snapshot.json");
  const raw = await fs.readFile(snapshotPath, "utf8");
  return JSON.parse(raw) as SentinelOutputSnapshot;
}

test("sentinel markdown/xml outputs remain stable", async () => {
  const comments: SentinelUnresolvedComment[] = [
    {
      file: "src/providers/github.ts",
      line: 42,
      author: "reviewer",
      body: "Handle missing token fallback.",
      createdAt: "2026-02-20T18:00:00.000Z",
      url: "https://example.com/comment/1",
      resolved: false,
      outdated: false
    }
  ];

  const failures: FailuresReport = {
    repo: "acme/repo",
    prNumber: 12,
    runId: null,
    runs: [],
    excerpts: [
      {
        runId: 99,
        workflowName: "ci.yml",
        workflowPath: ".github/workflows/ci.yml",
        runNumber: 1,
        runAttempt: 1,
        runUrl: "https://example.com/run",
        jobId: 77,
        jobName: "Run tests",
        jobUrl: "https://example.com/job",
        failedStepName: "Run tests",
        matchedLines: ["FAIL test/conformance.test.ts", "Error: expected block"]
      }
    ]
  };

  const lint: LintReport = {
    repo: "acme/repo",
    prNumber: 12,
    runId: null,
    findings: [
      {
        type: "typecheck",
        tool: "tsc",
        file: "src/providers/registry.ts",
        line: 8,
        column: 10,
        severity: "error",
        message: "Property 'verify' does not exist on type 'Provider'."
      }
    ]
  };

  const quality: TestQualityReport = {
    scannedPath: "/repo/test",
    totalTests: 2,
    flaggedNames: [
      {
        file: "test/auth.test.ts",
        line: 45,
        name: "it works",
        reason: "name is too generic and does not describe expected behavior"
      }
    ],
    behavioralExamples: [
      {
        file: "test/runtime.test.ts",
        line: 12,
        name: "returns block when token missing in approval check",
        reason: "behavioral name"
      }
    ],
    metrics: {
      testsAdded: 12,
      testsRemoved: 3,
      testLinesDelta: 9,
      codeLinesAdded: 3,
      coverageDeltaPercent: null,
      inflationWarning: true,
      consolidationPraise: false,
      notes: ["Coverage delta unavailable; inflation/consolidation checks use test/code ratio heuristics."]
    }
  };

  const actual: SentinelOutputSnapshot = {
    commentsMarkdown: renderCommentsMarkdown(comments, new Date("2026-02-21T18:00:00.000Z")),
    commentsXml: renderCommentsXml(comments),
    failuresMarkdown: renderFailuresMarkdown(failures),
    lintMarkdown: renderLintMarkdown(lint),
    testQualityMarkdown: renderTestQualityMarkdown(quality)
  };

  const expected = await readSnapshot();
  assert.deepEqual(actual, expected);
});
