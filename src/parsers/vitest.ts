import type { LintFinding } from "../commands/types";
import type { LogParser } from "./types";

const FAIL_LINE = /^\s*FAIL\s+(?<file>\S.+)$/;
const TEST_LINE = /^\s*×\s+(?<message>.+)$/;
const STACK_LINE = /(?:at\s+)?(?<file>[^:\s]+):(\d+):(\d+)/;

export const vitestParser: LogParser = {
  name: "vitest",
  parse(lines: string[]): LintFinding[] {
    const findings: LintFinding[] = [];
    let currentMessage = "Vitest failure";

    for (const line of lines) {
      const failMatch = line.match(FAIL_LINE);
      if (failMatch?.groups?.file) {
        currentMessage = `Suite failed: ${failMatch.groups.file.trim()}`;
        continue;
      }

      const testMatch = line.match(TEST_LINE);
      if (testMatch?.groups?.message) {
        currentMessage = testMatch.groups.message.trim();
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
        tool: "vitest",
        file: stack.groups.file.trim(),
        line: lineNumber,
        column,
        severity: "error",
        message: currentMessage
      });
    }

    return findings;
  }
};
