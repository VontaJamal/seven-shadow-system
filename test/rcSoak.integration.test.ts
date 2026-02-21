import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RcSoakSummary {
  schemaVersion: number;
  iterations: number;
  cases: Array<{
    id: string;
    provider: string;
    baselineHash: string;
  }>;
  failClosedProviders: string[];
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-rc-soak-test-"));
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd });
    return {
      code: 0,
      stdout,
      stderr
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? ""
    };
  }
}

test("rc-soak script emits deterministic summary report", async () => {
  const tempDir = await makeTempDir();

  try {
    const reportPath = path.join(tempDir, "rc-soak-report.json");
    const result = await runCommand(
      "node",
      ["dist/scripts/rc-soak.js", "--iterations", "2", "--report", reportPath],
      process.cwd()
    );

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as RcSoakSummary;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.iterations, 2);
    assert.equal(report.cases.length, 4);
    assert.deepEqual(new Set(report.failClosedProviders), new Set(["github", "gitlab", "bitbucket"]));
    for (const item of report.cases) {
      assert.match(item.baselineHash, /^[a-f0-9]{64}$/);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("rc-soak script validates argument contracts", async () => {
  const result = await runCommand("node", ["dist/scripts/rc-soak.js", "--iterations", "0"], process.cwd());
  assert.equal(result.code, 1);
  assert.match(result.stderr, /E_RC_SOAK_ARG_REQUIRED/);
});
