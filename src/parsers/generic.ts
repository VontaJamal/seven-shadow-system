import type { LintFinding } from "../commands/types";
import type { LogParser } from "./types";

const FILE_LINE_PATTERN = /(?<file>[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+):(?<line>\d+)(?::(?<column>\d+))?/;
const SEVERITY_PATTERN = /\b(error|warn|warning|fail|failed)\b/i;

export const genericParser: LogParser = {
  name: "generic",
  parse(lines: string[]): LintFinding[] {
    const findings: LintFinding[] = [];

    for (const line of lines) {
      if (!SEVERITY_PATTERN.test(line)) {
        continue;
      }

      const match = line.match(FILE_LINE_PATTERN);
      if (!match?.groups) {
        continue;
      }

      const lineNumber = Number.parseInt(match.groups.line ?? "", 10);
      const column = match.groups.column ? Number.parseInt(match.groups.column, 10) : undefined;
      if (!Number.isInteger(lineNumber) || lineNumber <= 0) {
        continue;
      }

      findings.push({
        type: "generic",
        tool: "generic",
        file: match.groups.file,
        line: lineNumber,
        column: Number.isInteger(column) && (column ?? 0) > 0 ? column : undefined,
        severity: /warn/i.test(line) ? "warn" : "error",
        message: line.trim()
      });
    }

    return findings;
  }
};
