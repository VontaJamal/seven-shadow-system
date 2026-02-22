import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTestQualityReport, parseTestQualityArgs, renderTestQualityMarkdown } from "../src/commands/testQuality";

test("parseTestQualityArgs defaults to markdown", () => {
  const args = parseTestQualityArgs([]);
  assert.equal(args.format, "md");
  assert.equal(args.rootPath, "test");
});

test("buildTestQualityReport flags non-behavioral names", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sss-test-quality-"));

  try {
    const testDir = path.join(tempDir, "test");
    await fs.mkdir(testDir, { recursive: true });

    await fs.writeFile(
      path.join(testDir, "sample.test.ts"),
      [
        "test('it works', () => {});",
        "test('returns error when token missing in guard path', () => {});"
      ].join("\n"),
      "utf8"
    );

    const report = await buildTestQualityReport({
      rootPath: testDir,
      format: "json",
      providerName: "github"
    });

    assert.equal(report.totalTests >= 2, true);
    assert.equal(report.flaggedNames.some((item) => item.name === "it works"), true);
    assert.equal(report.behavioralExamples.some((item) => item.name.includes("returns error")), true);

    const markdown = renderTestQualityMarkdown(report);
    assert.match(markdown, /Test Quality Report/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
