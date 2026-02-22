import assert from "node:assert/strict";
import test from "node:test";

import { vitestParser } from "../src/parsers/vitest";

test("vitest parser extracts stack location", () => {
  const findings = vitestParser.parse(
    [
      " FAIL  test/example.test.ts",
      " × should compute value",
      "   at src/example.ts:33:11"
    ],
    { source: "unit" }
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.tool, "vitest");
  assert.equal(findings[0]?.file, "src/example.ts");
  assert.equal(findings[0]?.line, 33);
});
