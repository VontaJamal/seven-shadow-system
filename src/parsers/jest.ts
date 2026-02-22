import type { LintFinding } from "../commands/types";
import type { LogParser } from "./types";

const FAIL_LINE = /^FAIL\s+(?<file>\S.+)$/;
const ASSERTION_LINE = /^\s*●\s+(?<message>.+)$/;
const STACK_LINE = /at\s+(?<file>[^:\s]+):(\d+):(\d+)/;

export const jestParser: LogParser = {
  name: "jest",
  parse(lines: string[]): LintFinding[] {
    const findings: LintFinding[] = [];
    let currentSuiteFile = "unknown";
    let currentMessage = "Jest test failure";

    for (const line of lines) {
      const failMatch = line.match(FAIL_LINE);
      if (failMatch?.groups?.file) {
        currentSuiteFile = failMatch.groups.file.trim();
        currentMessage = `Suite failed: ${currentSuiteFile}`;
        continue;
      }

      const assertion = line.match(ASSERTION_LINE);
      if (assertion?.groups?.message) {
        currentMessage = assertion.groups.message.trim();
        continue;
      }

      const stack = line.match(STACK_LINE);
      if (!stack?.groups?.file) {
        continue;
      }

      const lineNumber = Number.parseInt(stack[2] ?? "", 10);
      const column = Number.parseInt(stack[3] ?? "", 10);
      if (!Number.isInteger(lineNumber) || lineNumber <= 0 || !Number.isInteger(column) || column <= 0) {
        continue;
      }

      findings.push({
        type: "test",
        tool: "jest",
        file: stack.groups.file.trim() || currentSuiteFile,
        line: lineNumber,
        column,
        severity: "error",
        message: currentMessage
      });
    }

    return findings;
  }
};
