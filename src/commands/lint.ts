import { collectFailureExcerpts, parseFailuresArgs, type FailuresArgs } from "./failures";
import type { LintFinding, LintReport } from "./types";
import { eslintParser } from "../parsers/eslint";
import { genericParser } from "../parsers/generic";
import { jestParser } from "../parsers/jest";
import { pytestParser } from "../parsers/pytest";
import { typescriptParser } from "../parsers/typescript";
import { vitestParser } from "../parsers/vitest";
import { toLintFindingKey } from "../parsers/types";

interface LintArgs extends FailuresArgs {
  format: "md" | "json";
}

const PARSERS = [eslintParser, typescriptParser, jestParser, vitestParser, pytestParser, genericParser] as const;

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function normalizeLintArgs(argv: string[]): LintArgs {
  const parsed = parseFailuresArgs(argv);
  const hasFormatFlag = argv.includes("--format");

  if (!hasFormatFlag) {
    parsed.format = "json";
  }

  if (parsed.format !== "md" && parsed.format !== "json") {
    throw makeError("E_SENTINEL_ARG_INVALID", "--format must be md|json");
  }

  return parsed;
}

function runParsers(lines: string[]): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const parser of PARSERS) {
    findings.push(...parser.parse(lines, { source: "ci-log" }));
  }

  return findings;
}

export function dedupeAndSortFindings(findings: LintFinding[]): LintFinding[] {
  const seen = new Set<string>();
  const deduped: LintFinding[] = [];

  for (const finding of findings) {
    const key = toLintFindingKey(finding);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(finding);
  }

  deduped.sort((left, right) => {
    const fileCompare = left.file.localeCompare(right.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return (left.column ?? 0) - (right.column ?? 0);
  });

  return deduped;
}

export function renderLintMarkdown(report: LintReport): string {
  const lines: string[] = [];
  lines.push(`## Lint Findings (${report.findings.length})`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No lint/type/test findings were detected from failing CI logs.");
    lines.push("");
    return lines.join("\n");
  }

  for (const finding of report.findings) {
    const location = `${finding.file}:${finding.line}${finding.column ? `:${finding.column}` : ""}`;
    const ruleSuffix = finding.rule ? ` (${finding.rule})` : "";
    lines.push(`- [${finding.severity.toUpperCase()}] ${location} - ${finding.tool}${ruleSuffix} - ${finding.message}`);
  }

  lines.push("");
  return lines.join("\n");
}

export async function buildLintReport(argv: string[], env: NodeJS.ProcessEnv): Promise<{ args: LintArgs; report: LintReport }> {
  const args = normalizeLintArgs(argv);
  const failures = await collectFailureExcerpts(args, env);

  const findings: LintFinding[] = [];
  for (const excerpt of failures.excerpts) {
    findings.push(...runParsers(excerpt.matchedLines));
  }

  const report: LintReport = {
    repo: failures.repo,
    prNumber: failures.prNumber,
    runId: failures.runId,
    findings: dedupeAndSortFindings(findings)
  };

  return {
    args,
    report
  };
}

export async function runLintCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const { args, report } = await buildLintReport(argv, env);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderLintMarkdown(report));
  return 0;
}
