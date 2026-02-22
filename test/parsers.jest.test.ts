import assert from "node:assert/strict";
import test from "node:test";

import { jestParser } from "../src/parsers/jest";

test("jest parser extracts failing stack location", () => {
  const findings = jestParser.parse(
    [
      "FAIL test/conformance.test.ts",
      "  ● conformance suite > should block on unverified approval",
      "    at test/conformance.test.ts:47:5"
    ],
    { source: "unit" }
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.tool, "jest");
  assert.equal(findings[0]?.file, "test/conformance.test.ts");
  assert.equal(findings[0]?.line, 47);
  assert.equal(findings[0]?.column, 5);
});
