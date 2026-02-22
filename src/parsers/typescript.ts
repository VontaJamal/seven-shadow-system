import type { LintFinding } from "../commands/types";
import type { LogParser } from "./types";

const TSC_LINE = /^(?<file>.+)\((?<line>\d+),(?<column>\d+)\):\s*(?<severity>error|warning|warn)\s+TS\d+:\s*(?<message>.+)$/i;

function toSeverity(value: string): "error" | "warn" {
  return value.toLowerCase().startsWith("warn") ? "warn" : "error";
}

export const typescriptParser: LogParser = {
  name: "typescript",
  parse(lines: string[]): LintFinding[] {
    const findings: LintFinding[] = [];

    for (const line of lines) {
      const match = line.match(TSC_LINE);
      if (!match?.groups) {
        continue;
      }

      const lineNumber = Number.parseInt(match.groups.line ?? "", 10);
      const column = Number.parseInt(match.groups.column ?? "", 10);
      if (!Number.isInteger(lineNumber) || lineNumber <= 0 || !Number.isInteger(column) || column <= 0) {
        continue;
      }

      findings.push({
        type: "typecheck",
        tool: "tsc",
        file: (match.groups.file ?? "unknown").trim(),
        line: lineNumber,
        column,
        severity: toSeverity(match.groups.severity ?? "error"),
        message: (match.groups.message ?? "").trim()
      });
    }

    return findings;
  }
};
