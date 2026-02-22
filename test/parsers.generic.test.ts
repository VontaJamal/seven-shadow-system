import assert from "node:assert/strict";
import test from "node:test";

import { genericParser } from "../src/parsers/generic";

test("generic parser extracts fallback finding", () => {
  const findings = genericParser.parse([
    "src/index.ts:12:2 error: unexpected token",
    "normal line"
  ], {
    source: "unit"
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.tool, "generic");
  assert.equal(findings[0]?.file, "src/index.ts");
  assert.equal(findings[0]?.line, 12);
  assert.equal(findings[0]?.column, 2);
});
