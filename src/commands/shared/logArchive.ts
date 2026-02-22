export const DEFAULT_FAILURE_MATCH_TOKENS = ["FAIL", "ERROR", "error:", "Error:", "WARN"];

export interface ExtractContextualMatchesOptions {
  matchTokens?: string[];
  contextLines?: number;
  maxLines?: number;
}

function normalizeTokens(tokens: string[]): string[] {
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase());
}

function isMatch(line: string, normalizedTokens: string[]): boolean {
  const lower = line.toLowerCase();
  return normalizedTokens.some((token) => lower.includes(token));
}

export function extractContextualMatches(logText: string, options: ExtractContextualMatchesOptions = {}): string[] {
  const lines = logText.split(/\r?\n/);
  const contextLines = Math.max(0, options.contextLines ?? 5);
  const maxLines = Math.max(1, options.maxLines ?? 200);
  const normalizedTokens = normalizeTokens(options.matchTokens ?? DEFAULT_FAILURE_MATCH_TOKENS);

  const indexes = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    if (!isMatch(lines[index] ?? "", normalizedTokens)) {
      continue;
    }

    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);

    for (let cursor = start; cursor <= end; cursor += 1) {
      indexes.add(cursor);
    }
  }

  const sortedIndexes = Array.from(indexes).sort((a, b) => a - b);
  if (sortedIndexes.length === 0) {
    return [];
  }

  const result: string[] = [];
  for (const lineIndex of sortedIndexes) {
    if (result.length >= maxLines) {
      result.push(`[... output truncated at ${maxLines} lines ...]`);
      break;
    }

    result.push(lines[lineIndex] ?? "");
  }

  return result;
}
