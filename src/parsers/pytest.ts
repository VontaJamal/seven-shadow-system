import type { LintFinding } from "../commands/types";
import type { LogParser } from "./types";

const FLAKE8_LINE = /^(?<file>[^:\s][^:]*\.py):(?<line>\d+):(?<column>\d+):\s*(?<rule>[A-Z]\d+)\s+(?<message>.+)$/;
const MYPY_LINE = /^(?<file>[^:\s][^:]*):(?<line>\d+):\s*(?<severity>error|warning|note):\s*(?<message>.+)$/i;
const PYTEST_FAILED = /^FAILED\s+(?<file>[^:\s][^:]*\.py)::(?<testName>[^\s]+)\s+-\s+(?<message>.+)$/;

function toSeverity(value: string): "error" | "warn" {
  return value.toLowerCase().startsWith("warn") || value.toLowerCase().startsWith("note") ? "warn" : "error";
}

export const pytestParser: LogParser = {
  name: "pytest",
  parse(lines: string[]): LintFinding[] {
    const findings: LintFinding[] = [];

    for (const line of lines) {
      const flake = line.match(FLAKE8_LINE);
      if (flake?.groups) {
        const lineNumber = Number.parseInt(flake.groups.line ?? "", 10);
        const column = Number.parseInt(flake.groups.column ?? "", 10);
        if (Number.isInteger(lineNumber) && lineNumber > 0 && Number.isInteger(column) && column > 0) {
          findings.push({
            type: "lint",
            tool: "flake8",
            file: flake.groups.file,
            line: lineNumber,
            column,
            severity: "error",
            rule: flake.groups.rule,
            message: flake.groups.message.trim()
          });
        }
        continue;
      }

      const mypy = line.match(MYPY_LINE);
      if (mypy?.groups) {
        const lineNumber = Number.parseInt(mypy.groups.line ?? "", 10);
        if (Number.isInteger(lineNumber) && lineNumber > 0) {
          findings.push({
            type: "typecheck",
            tool: "mypy",
            file: mypy.groups.file,
            line: lineNumber,
            severity: toSeverity(mypy.groups.severity ?? "error"),
            message: mypy.groups.message.trim()
          });
        }
        continue;
      }

      const failed = line.match(PYTEST_FAILED);
      if (failed?.groups) {
        findings.push({
          type: "test",
          tool: "pytest",
          file: failed.groups.file,
          line: 1,
          severity: "error",
          message: `${failed.groups.testName}: ${failed.groups.message.trim()}`
        });
      }
    }

    return findings;
  }
};
