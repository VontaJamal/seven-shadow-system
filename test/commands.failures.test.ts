import assert from "node:assert/strict";
import test from "node:test";

import { parseFailuresArgs, renderFailuresMarkdown } from "../src/commands/failures";
import type { FailuresReport } from "../src/commands/types";

test("parseFailuresArgs uses bounded defaults", () => {
  const args = parseFailuresArgs([]);

  assert.equal(args.maxLinesPerRun, 200);
  assert.equal(args.contextLines, 5);
  assert.equal(args.maxRuns, 10);
  assert.equal(args.maxLogBytes, 5_000_000);
});

test("renderFailuresMarkdown groups failed checks", () => {
  const report: FailuresReport = {
    repo: "acme/repo",
    prNumber: 12,
    runId: null,
    runs: [],
    excerpts: [
      {
        runId: 99,
        workflowName: "ci.yml",
        workflowPath: ".github/workflows/ci.yml",
        runNumber: 11,
        runAttempt: 1,
        runUrl: "https://example.com/run",
        jobId: 10,
        jobName: "Run tests",
        jobUrl: "https://example.com/job",
        failedStepName: "Run tests",
        matchedLines: ["FAIL test/sample.test.ts", "Error: expected pass"]
      }
    ]
  };

  const markdown = renderFailuresMarkdown(report);
  assert.match(markdown, /Failing Checks \(1\)/);
  assert.match(markdown, /ci\.yml/);
  assert.match(markdown, /FAIL test\/sample\.test\.ts/);
});
