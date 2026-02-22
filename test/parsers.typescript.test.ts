import assert from "node:assert/strict";
import test from "node:test";

import { typescriptParser } from "../src/parsers/typescript";

test("typescript parser extracts tsc diagnostics", () => {
  const findings = typescriptParser.parse([
    "src/providers/registry.ts(8,10): error TS2339: Property 'verify' does not exist on type 'Provider'."
  ], {
    source: "unit"
  });

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    type: "typecheck",
    tool: "tsc",
    file: "src/providers/registry.ts",
    line: 8,
    column: 10,
    severity: "error",
    message: "Property 'verify' does not exist on type 'Provider'."
  });
});
