import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseDoctrineLintArgs, runDoctrineLintCommand } from "../src/commands/doctrineLint";

test("parseDoctrineLintArgs applies defaults", () => {
  const parsed = parseDoctrineLintArgs([]);
  assert.equal(parsed.format, "md");
});

test("doctrine lint passes on sample doctrine and policy", async () => {
  const code = await runDoctrineLintCommand([
    "--doctrine",
    "config/shadow-doctrine.sample.json",
    "--policy",
    "config/seven-shadow-system.policy.v3.sample.json",
    "--format",
    "json"
  ]);

  assert.equal(code, 0);
});

test("doctrine lint fails when Access doctrine is mislabeled", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "7s-doctrine-lint-"));

  try {
    const sampleDoctrinePath = path.join(process.cwd(), "config", "shadow-doctrine.sample.json");
    const doctrineRaw = await fs.readFile(sampleDoctrinePath, "utf8");
    const doctrine = JSON.parse(doctrineRaw) as Record<string, unknown>;

    const shadows = doctrine.shadows as Record<string, Record<string, unknown>>;
    shadows.Access.belief = "Access means plain readable output.";
    shadows.Access.doctrine = "This is about code clarity and readable output.";
    shadows.Access.checkIntent = ["readable output"];

    const doctrinePath = path.join(tempDir, "doctrine.json");
    await fs.writeFile(doctrinePath, `${JSON.stringify(doctrine, null, 2)}\n`, "utf8");

    const code = await runDoctrineLintCommand([
      "--doctrine",
      doctrinePath,
      "--policy",
      "config/seven-shadow-system.policy.v3.sample.json",
      "--format",
      "json"
    ]);

    assert.equal(code, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
