import type { LintFinding } from "../commands/types";

export interface ParserContext {
  source: string;
}

export interface LogParser {
  readonly name: string;
  parse: (lines: string[], context: ParserContext) => LintFinding[];
}

export function toLintFindingKey(finding: LintFinding): string {
  return [finding.type, finding.file, finding.line, finding.column ?? "", finding.message].join("|");
}
