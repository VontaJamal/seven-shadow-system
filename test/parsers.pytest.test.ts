import assert from "node:assert/strict";
import test from "node:test";

import { pytestParser } from "../src/parsers/pytest";

test("pytest parser extracts flake8 and mypy diagnostics", () => {
  const findings = pytestParser.parse(
    [
      "src/module.py:14:8: E231 missing whitespace after ','",
      "src/module.py:18: error: Incompatible return value type",
      "FAILED tests/test_module.py::test_returns_value - AssertionError: expected 1"
    ],
    { source: "unit" }
  );

  assert.equal(findings.length, 3);
  assert.equal(findings[0]?.tool, "flake8");
  assert.equal(findings[1]?.tool, "mypy");
  assert.equal(findings[2]?.tool, "pytest");
});
