import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LEGACY_TOKEN_PATTERN = new RegExp(["rinshari", "ui"].join("-"), "i");

async function listTrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], {
    cwd: process.cwd()
  });

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("design/rinshari-eye/"));
}

test("tracked parent-repo files do not include legacy doctrine-name references", async () => {
  const files = await listTrackedFiles();
  const violations: string[] = [];

  for (const relativePath of files) {
    const absolutePath = path.join(process.cwd(), relativePath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    let content = "";
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    if (!LEGACY_TOKEN_PATTERN.test(content)) {
      continue;
    }

    violations.push(relativePath);
  }

  assert.deepEqual(violations, []);
});
