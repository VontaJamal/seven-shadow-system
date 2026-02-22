import assert from "node:assert/strict";
import test from "node:test";

import { dedupeAndSortFindings, renderLintMarkdown } from "../src/commands/lint";
import type { LintFinding, LintReport } from "../src/commands/types";

test("dedupeAndSortFindings removes duplicates and sorts", () => {
  const findings: LintFinding[] = [
    {
      type: "lint",
      tool: "eslint",
      file: "src/b.ts",
      line: 2,
      severity: "error",
      message: "B"
    },
    {
      type: "lint",
      tool: "eslint",
      file: "src/a.ts",
      line: 1,
      severity: "error",
      message: "A"
    },
    {
      type: "lint",
      tool: "eslint",
      file: "src/a.ts",
      line: 1,
      severity: "error",
      message: "A"
    }
  ];

  const result = dedupeAndSortFindings(findings);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.file, "src/a.ts");
  assert.equal(result[1]?.file, "src/b.ts");
});

test("renderLintMarkdown includes findings list", () => {
  const report: LintReport = {
    repo: "acme/repo",
    prNumber: 1,
    runId: null,
    findings: [
      {
        type: "typecheck",
        tool: "tsc",
        file: "src/index.ts",
        line: 8,
        column: 10,
        severity: "error",
        message: "Property does not exist"
      }
    ]
  };

  const markdown = renderLintMarkdown(report);
  assert.match(markdown, /Lint Findings \(1\)/);
  assert.match(markdown, /src\/index\.ts:8:10/);
});
