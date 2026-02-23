import assert from "node:assert/strict";
import test from "node:test";

import { parseDoctrineArgs } from "../src/commands/doctrine";

test("parseDoctrineArgs applies defaults", () => {
  const parsed = parseDoctrineArgs([]);
  assert.equal(parsed.quickstart, false);
  assert.equal(parsed.format, "md");
});

test("parseDoctrineArgs reads quickstart and format", () => {
  const parsed = parseDoctrineArgs(["--quickstart", "--format", "json", "--doctrine", "config/shadow-doctrine.sample.json"]);
  assert.equal(parsed.quickstart, true);
  assert.equal(parsed.format, "json");
  assert.equal(parsed.doctrinePath, "config/shadow-doctrine.sample.json");
});

test("parseDoctrineArgs rejects unknown flags", () => {
  assert.throws(() => {
    parseDoctrineArgs(["--mystery"]);
  }, /E_SHADOW_ARG_UNKNOWN/);
});
