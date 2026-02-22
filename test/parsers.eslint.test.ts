import assert from "node:assert/strict";
import test from "node:test";

import { eslintParser } from "../src/parsers/eslint";

test("eslint parser extracts lint finding", () => {
  const findings = eslintParser.parse([
    "src/index.ts:23:5: error  'oldConfig' is defined but never used.  no-unused-vars"
  ], {
    source: "unit"
  });

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    type: "lint",
    tool: "eslint",
    file: "src/index.ts",
    line: 23,
    column: 5,
    severity: "error",
    rule: "no-unused-vars",
    message: "'oldConfig' is defined but never used."
  });
});

test("eslint parser ignores non-eslint lines", () => {
  const findings = eslintParser.parse(["random output"], {
    source: "unit"
  });

  assert.equal(findings.length, 0);
});
