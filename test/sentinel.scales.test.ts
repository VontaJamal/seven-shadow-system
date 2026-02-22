import assert from "node:assert/strict";
import test from "node:test";

import { extractContextualMatches } from "../src/commands/shared/logArchive";

test("extractContextualMatches enforces max line cap", () => {
  const lines: string[] = [];
  for (let index = 0; index < 400; index += 1) {
    lines.push(index % 2 === 0 ? `ERROR line ${index}` : `context ${index}`);
  }

  const excerpt = extractContextualMatches(lines.join("\n"), {
    contextLines: 1,
    maxLines: 50,
    matchTokens: ["ERROR"]
  });

  assert.equal(excerpt.length, 51);
  assert.equal(excerpt[50], "[... output truncated at 50 lines ...]");
});

test("extractContextualMatches returns empty for no matches", () => {
  const excerpt = extractContextualMatches("all good\nno failures", {
    matchTokens: ["ERROR"]
  });

  assert.deepEqual(excerpt, []);
});
