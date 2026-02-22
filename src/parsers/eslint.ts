import type { LintFinding } from "../commands/types";
import type { LogParser } from "./types";

const ESLINT_LINE = /^(?<file>[^:\s][^:]*):(?<line>\d+):(?<column>\d+):\s*(?<severity>error|warning|warn)\s+(?<message>.+?)(?:\s{2,}(?<rule>[\w-/@]+))?$/i;

function toSeverity(value: string): "error" | "warn" {
  return value.toLowerCase().startsWith("warn") ? "warn" : "error";
}

function parseLine(line: string): LintFinding | null {
  const match = line.match(ESLINT_LINE);
  if (!match?.groups) {
    return null;
  }

  const lineNumber = Number.parseInt(match.groups.line ?? "", 10);
  const column = Number.parseInt(match.groups.column ?? "", 10);
  if (!Number.isInteger(lineNumber) || lineNumber <= 0 || !Number.isInteger(column) || column <= 0) {
    return null;
  }

  return {
    type: "lint",
    tool: "eslint",
    file: match.groups.file ?? "unknown",
    line: lineNumber,
    column,
    severity: toSeverity(match.groups.severity ?? "error"),
    rule: (match.groups.rule ?? "").trim() || undefined,
    message: (match.groups.message ?? "").trim()
  };
}

export const eslintParser: LogParser = {
  name: "eslint",
  parse(lines: string[]): LintFinding[] {
    const findings: LintFinding[] = [];
    for (const line of lines) {
      const finding = parseLine(line);
      if (finding) {
        findings.push(finding);
      }
    }

    return findings;
  }
};
