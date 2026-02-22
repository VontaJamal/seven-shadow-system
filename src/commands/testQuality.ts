import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { TestNameFinding, TestQualityMetrics, TestQualityReport } from "./types";

const execFileAsync = promisify(execFile);

interface TestQualityArgs {
  rootPath: string;
  format: "md" | "json";
  baseRef?: string;
  headRef?: string;
  providerName: string;
  repoArg?: string;
  prNumber?: number;
}

interface ParsedTestCase {
  file: string;
  line: number;
  name: string;
}

interface DiffMetrics {
  testsAdded: number;
  testsRemoved: number;
  testLinesDelta: number;
  codeLinesAdded: number;
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw makeError("E_SENTINEL_ARG_INVALID", `${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseFormat(value: string): "md" | "json" {
  if (value === "md" || value === "json") {
    return value;
  }

  throw makeError("E_SENTINEL_ARG_INVALID", "--format must be md|json");
}

export function parseTestQualityArgs(argv: string[]): TestQualityArgs {
  const args: TestQualityArgs = {
    rootPath: "test",
    format: "md",
    providerName: "github"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: 7s test-quality [--path <dir>] [--format md|json] [--base-ref <ref>] [--head-ref <ref>] [--provider github|gitlab|bitbucket] [--repo <owner/repo>] [--pr <number>]"
      );
    }

    if (token === "--path") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--path");
      }
      args.rootPath = value;
      index += 1;
      continue;
    }

    if (token === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--format");
      }
      args.format = parseFormat(value.trim().toLowerCase());
      index += 1;
      continue;
    }

    if (token === "--base-ref") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--base-ref");
      }
      args.baseRef = value;
      index += 1;
      continue;
    }

    if (token === "--head-ref") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--head-ref");
      }
      args.headRef = value;
      index += 1;
      continue;
    }

    if (token === "--provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--provider");
      }
      args.providerName = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (token === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--repo");
      }
      args.repoArg = value;
      index += 1;
      continue;
    }

    if (token === "--pr") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--pr");
      }
      args.prNumber = parsePositiveInt(value, "--pr");
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SENTINEL_ARG_UNKNOWN", token);
    }
  }

  return args;
}

function isTestFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");

  return (
    /(^|\/)(test|tests|__tests__)\//i.test(normalized) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(normalized) ||
    /_test\.go$/i.test(normalized) ||
    /(^|\/)test_[^/]+\.py$/i.test(normalized) ||
    /(^|\/)[^/]+_test\.py$/i.test(normalized)
  );
}

function toLineNumber(value: string, index: number): number {
  return value.slice(0, index).split(/\r?\n/).length;
}

function extractJsTests(filePath: string, content: string): ParsedTestCase[] {
  const regex = /\b(?:it|test)\s*\(\s*(["'`])(.+?)\1/g;
  const tests: ParsedTestCase[] = [];

  for (let match = regex.exec(content); match; match = regex.exec(content)) {
    const name = (match[2] ?? "").trim();
    if (!name) {
      continue;
    }

    tests.push({
      file: filePath,
      line: toLineNumber(content, match.index),
      name
    });
  }

  return tests;
}

function extractPythonTests(filePath: string, content: string): ParsedTestCase[] {
  const regex = /^\s*def\s+(test_[A-Za-z0-9_]+)\s*\(/gm;
  const tests: ParsedTestCase[] = [];

  for (let match = regex.exec(content); match; match = regex.exec(content)) {
    const rawName = (match[1] ?? "").trim();
    if (!rawName) {
      continue;
    }

    tests.push({
      file: filePath,
      line: toLineNumber(content, match.index),
      name: rawName.replace(/^test_/, "").replace(/_/g, " ")
    });
  }

  return tests;
}

function extractGoTests(filePath: string, content: string): ParsedTestCase[] {
  const regex = /^\s*func\s+(Test[A-Za-z0-9_]+)\s*\(/gm;
  const tests: ParsedTestCase[] = [];

  for (let match = regex.exec(content); match; match = regex.exec(content)) {
    const rawName = (match[1] ?? "").trim();
    if (!rawName) {
      continue;
    }

    const noPrefix = rawName.replace(/^Test/, "");
    const spaced = noPrefix.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    tests.push({
      file: filePath,
      line: toLineNumber(content, match.index),
      name: spaced.trim()
    });
  }

  return tests;
}

function behavioralNameHeuristic(name: string): { behavioral: boolean; reason: string } {
  const normalized = name.trim().toLowerCase();
  const wordCount = normalized
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .length;

  if (
    /^test\d+$/.test(normalized) ||
    /^it\s+works$/.test(normalized) ||
    /^test[_-]?it[_-]?works$/.test(normalized) ||
    /^testpost$/.test(normalized) ||
    /^test[_-]?helper/.test(normalized)
  ) {
    return {
      behavioral: false,
      reason: "name is too generic and does not describe expected behavior"
    };
  }

  const keywords = [
    "should",
    "when",
    "returns",
    "throws",
    "given",
    "rejects",
    "accepts",
    "blocks",
    "allows",
    "includes",
    "excludes",
    "fails",
    "passes"
  ];

  const hasKeyword = keywords.some((keyword) => normalized.includes(keyword));
  if (!hasKeyword && wordCount < 5) {
    return {
      behavioral: false,
      reason: "name is shorter than 5 words without behavioral assertion language"
    };
  }

  if (!hasKeyword && /^[a-z0-9_]+$/i.test(name) && /[A-Z]/.test(name) === false && wordCount <= 4) {
    return {
      behavioral: false,
      reason: "name appears implementation-centric rather than behavior-centric"
    };
  }

  return {
    behavioral: true,
    reason: ""
  };
}

async function collectTestFiles(rootPath: string): Promise<string[]> {
  const absoluteRoot = path.resolve(rootPath);

  const discovered: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const stats = await fs.stat(currentPath).catch(() => null);
    if (!stats) {
      return;
    }

    if (stats.isFile()) {
      if (isTestFilePath(currentPath)) {
        discovered.push(currentPath);
      }
      return;
    }

    if (!stats.isDirectory()) {
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      await walk(path.join(currentPath, entry.name));
    }
  }

  await walk(absoluteRoot);

  return discovered.sort((a, b) => a.localeCompare(b));
}

async function extractTestsFromFiles(files: string[]): Promise<ParsedTestCase[]> {
  const tests: ParsedTestCase[] = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!content) {
      continue;
    }

    tests.push(...extractJsTests(filePath, content));
    tests.push(...extractPythonTests(filePath, content));
    tests.push(...extractGoTests(filePath, content));
  }

  tests.sort((left, right) => {
    const fileCompare = left.file.localeCompare(right.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.name.localeCompare(right.name);
  });

  return tests;
}

async function runGit(args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: process.cwd() });
  return result.stdout;
}

function parseNumstat(output: string): DiffMetrics {
  let testLinesAdded = 0;
  let testLinesRemoved = 0;
  let codeLinesAdded = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [addedRaw, removedRaw, filePath] = line.split("\t");
    if (!filePath || addedRaw === "-" || removedRaw === "-") {
      continue;
    }

    const added = Number.parseInt(addedRaw, 10);
    const removed = Number.parseInt(removedRaw, 10);

    if (!Number.isInteger(added) || !Number.isInteger(removed)) {
      continue;
    }

    if (isTestFilePath(filePath)) {
      testLinesAdded += added;
      testLinesRemoved += removed;
    } else {
      codeLinesAdded += Math.max(0, added);
    }
  }

  return {
    testsAdded: testLinesAdded,
    testsRemoved: testLinesRemoved,
    testLinesDelta: testLinesAdded - testLinesRemoved,
    codeLinesAdded
  };
}

function parseTestDefDelta(diff: string): { added: number; removed: number } {
  const definitionRegex = /\b(?:it|test)\s*\(|^\s*def\s+test_|^\s*func\s+Test/m;

  let added = 0;
  let removed = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+") && definitionRegex.test(line.slice(1))) {
      added += 1;
      continue;
    }

    if (line.startsWith("-") && definitionRegex.test(line.slice(1))) {
      removed += 1;
    }
  }

  return {
    added,
    removed
  };
}

async function getDiffMetrics(baseRef: string, headRef: string): Promise<DiffMetrics> {
  const numstat = await runGit(["diff", "--numstat", `${baseRef}...${headRef}`]);
  const baseMetrics = parseNumstat(numstat);

  const patch = await runGit(["diff", "--unified=0", `${baseRef}...${headRef}`]);
  const testDefDelta = parseTestDefDelta(patch);

  return {
    testsAdded: testDefDelta.added,
    testsRemoved: testDefDelta.removed,
    testLinesDelta: baseMetrics.testLinesDelta,
    codeLinesAdded: baseMetrics.codeLinesAdded
  };
}

function buildMetrics(diff: DiffMetrics | null): TestQualityMetrics {
  if (!diff) {
    return {
      testsAdded: null,
      testsRemoved: null,
      testLinesDelta: null,
      codeLinesAdded: null,
      coverageDeltaPercent: null,
      inflationWarning: false,
      consolidationPraise: false,
      notes: [
        "PR diff metrics unavailable. Provide --base-ref and --head-ref for test/code delta analysis.",
        "Coverage delta unavailable in this execution context."
      ]
    };
  }

  const coverageDeltaPercent: number | null = null;
  const inflationWarning = diff.testsAdded > Math.max(0, diff.codeLinesAdded * 2);
  const consolidationPraise = diff.testsRemoved > 0 && diff.testLinesDelta <= 0;

  const notes: string[] = [];
  if (coverageDeltaPercent === null) {
    notes.push("Coverage delta unavailable; inflation/consolidation checks use test/code ratio heuristics.");
  }

  return {
    testsAdded: diff.testsAdded,
    testsRemoved: diff.testsRemoved,
    testLinesDelta: diff.testLinesDelta,
    codeLinesAdded: diff.codeLinesAdded,
    coverageDeltaPercent,
    inflationWarning,
    consolidationPraise,
    notes
  };
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

export async function buildTestQualityReport(args: TestQualityArgs): Promise<TestQualityReport> {
  const files = await collectTestFiles(args.rootPath);
  const tests = await extractTestsFromFiles(files);

  const flaggedNames: TestNameFinding[] = [];
  const behavioralExamples: TestNameFinding[] = [];

  for (const testCase of tests) {
    const heuristic = behavioralNameHeuristic(testCase.name);
    const finding: TestNameFinding = {
      file: toRelativePath(testCase.file),
      line: testCase.line,
      name: testCase.name,
      reason: heuristic.reason
    };

    if (!heuristic.behavioral) {
      flaggedNames.push(finding);
      continue;
    }

    if (behavioralExamples.length < 8) {
      behavioralExamples.push({
        ...finding,
        reason: "behavioral name"
      });
    }
  }

  let diff: DiffMetrics | null = null;
  if (args.baseRef && args.headRef) {
    try {
      diff = await getDiffMetrics(args.baseRef, args.headRef);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw makeError("E_SENTINEL_DIFF", message.slice(0, 220));
    }
  }

  return {
    scannedPath: path.resolve(args.rootPath),
    totalTests: tests.length,
    flaggedNames,
    behavioralExamples,
    metrics: buildMetrics(diff)
  };
}

export function renderTestQualityMarkdown(report: TestQualityReport): string {
  const lines: string[] = [];

  lines.push("## Test Quality Report");
  lines.push("");
  lines.push(`Scanned path: \`${report.scannedPath}\``);
  lines.push(`Total tests discovered: ${report.totalTests}`);
  lines.push("");

  lines.push(`### Non-Behavioral Test Names (${report.flaggedNames.length} flagged)`);
  if (report.flaggedNames.length === 0) {
    lines.push("No non-behavioral test names were flagged.");
  } else {
    for (const finding of report.flaggedNames.slice(0, 20)) {
      lines.push(`- \`${finding.file}:${finding.line}\` - \`${finding.name}\` - ${finding.reason}`);
    }
  }
  lines.push("");

  lines.push("### Behavioral Tests (Good Examples)");
  if (report.behavioralExamples.length === 0) {
    lines.push("No behavioral examples were detected.");
  } else {
    for (const finding of report.behavioralExamples.slice(0, 10)) {
      lines.push(`- ${finding.name}`);
    }
  }
  lines.push("");

  lines.push("### Coverage vs Test Count");
  const metrics = report.metrics;
  lines.push(`- Tests added in diff: ${metrics.testsAdded === null ? "n/a" : metrics.testsAdded}`);
  lines.push(`- Tests removed in diff: ${metrics.testsRemoved === null ? "n/a" : metrics.testsRemoved}`);
  lines.push(`- Net lines of test code: ${metrics.testLinesDelta === null ? "n/a" : metrics.testLinesDelta}`);
  lines.push(`- Code lines added in diff: ${metrics.codeLinesAdded === null ? "n/a" : metrics.codeLinesAdded}`);
  lines.push(`- Coverage delta: ${metrics.coverageDeltaPercent === null ? "n/a" : `${metrics.coverageDeltaPercent.toFixed(2)}%`}`);

  if (metrics.inflationWarning) {
    lines.push("- Inflation warning: potential test padding detected (tests added exceed 2x code lines added)");
  }

  if (metrics.consolidationPraise) {
    lines.push("- Consolidation signal: tests were reduced while maintaining structural coverage heuristics");
  }

  for (const note of metrics.notes) {
    lines.push(`- Note: ${note}`);
  }

  lines.push("");

  return lines.join("\n");
}

export async function runTestQualityCommand(
  argv: string[] = process.argv.slice(2),
  _env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseTestQualityArgs(argv);
  const report = await buildTestQualityReport(args);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${renderTestQualityMarkdown(report)}\n`);
  return 0;
}
