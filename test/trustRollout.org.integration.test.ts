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

interface SeedOptions {
  includeLintScript?: boolean;
}

interface RolloutSummary {
  schemaVersion: number;
  totals: {
    pending: number;
    passing: number;
    blocked: number;
  };
  targets: Array<{
    id: string;
    status: "pending" | "passing" | "blocked";
    errorCode?: string;
    signerCount?: number;
  }>;
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-org-trust-rollout-"));
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env: process.env
    });

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

async function initTargetRepo(root: string, repoName: string): Promise<string> {
  const repoPath = path.join(root, repoName);
  await fs.mkdir(repoPath, { recursive: true });
  const init = await runCommand("git", ["init"], repoPath);
  assert.equal(init.code, 0, init.stderr);
  return repoPath;
}

async function copyFixture(sourceRelativePath: string, destinationPath: string): Promise<void> {
  const sourcePath = path.join(process.cwd(), sourceRelativePath);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function seedSubmoduleSkeleton(targetRepo: string, submodulePath: string, options: SeedOptions = {}): Promise<void> {
  const root = path.join(targetRepo, submodulePath);
  const includeLintScript = options.includeLintScript ?? true;

  await copyFixture("config/seven-shadow-system.policy.json", path.join(root, "config", "seven-shadow-system.policy.json"));
  await copyFixture("config/policy-trust-store.sample.json", path.join(root, "config", "policy-trust-store.sample.json"));
  await copyFixture("config/policy-trust-store.v2.sample.json", path.join(root, "config", "policy-trust-store.v2.sample.json"));
  await copyFixture("config/policy-bundle.v2.template.json", path.join(root, "config", "policy-bundle.v2.template.json"));
  await copyFixture(
    "templates/workflows/seven-shadow-system.yml",
    path.join(root, "templates", "workflows", "seven-shadow-system.yml")
  );
  await copyFixture(
    "templates/submodule/policy-bundle-quickstart.md",
    path.join(root, "templates", "submodule", "policy-bundle-quickstart.md")
  );

  if (!includeLintScript) {
    return;
  }

  const lintScriptPath = path.join(root, "dist", "scripts", "policy-trust-store.js");
  await fs.mkdir(path.dirname(lintScriptPath), { recursive: true });
  await fs.writeFile(
    lintScriptPath,
    `#!/usr/bin/env node
if (process.argv[2] !== "lint") {
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  schemaVersion: 2,
  signerCount: 1,
  signers: [{ id: "maintainer", type: "rsa-key", keyId: "maintainer" }]
}, null, 2) + "\\n");
`,
    "utf8"
  );
}

async function runOrgRollout(args: string[]): Promise<CommandResult> {
  return runCommand("node", ["dist/scripts/org-trust-rollout.js", ...args], process.cwd());
}

test("org-trust-rollout reports passing, pending, and blocked target states", async () => {
  const tempDir = await makeTempDir();

  try {
    const submodulePath = "governance/seven-shadow-system";
    const passingRepo = await initTargetRepo(tempDir, "repo-passing");
    await seedSubmoduleSkeleton(passingRepo, submodulePath);

    const missingRepo = path.join(tempDir, "repo-missing");
    const targetsPath = path.join(tempDir, "targets.json");
    const reportPath = path.join(tempDir, "org-report.json");
    await fs.writeFile(
      targetsPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          targets: [
            {
              id: "passing",
              path: passingRepo
            },
            {
              id: "pending",
              path: path.join(tempDir, "repo-pending"),
              enabled: false
            },
            {
              id: "blocked",
              path: missingRepo
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await runOrgRollout([
      "--targets",
      targetsPath,
      "--submodule-path",
      submodulePath,
      "--trust-store-version",
      "2",
      "--report",
      reportPath,
      "--format",
      "json"
    ]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as RolloutSummary;
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.totals, {
      passing: 1,
      pending: 1,
      blocked: 1
    });

    const byId = new Map(report.targets.map((item) => [item.id, item]));
    assert.equal(byId.get("passing")?.status, "passing");
    assert.equal(byId.get("passing")?.signerCount, 1);
    assert.equal(byId.get("pending")?.status, "pending");
    assert.equal(byId.get("blocked")?.status, "blocked");
    assert.equal(byId.get("blocked")?.errorCode, "E_TRUST_ROLLOUT_TARGET_INVALID");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("org-trust-rollout surfaces deterministic argument errors", async () => {
  const result = await runOrgRollout([]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /E_TRUST_ROLLOUT_ORG_ARG_REQUIRED/);
});

test("org-trust-rollout captures bootstrap failure codes in blocked status", async () => {
  const tempDir = await makeTempDir();

  try {
    const submodulePath = "governance/seven-shadow-system";
    const blockedRepo = await initTargetRepo(tempDir, "repo-blocked");
    await seedSubmoduleSkeleton(blockedRepo, submodulePath, { includeLintScript: false });

    const targetsPath = path.join(tempDir, "targets.json");
    const reportPath = path.join(tempDir, "org-report.json");
    await fs.writeFile(
      targetsPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          targets: [
            {
              id: "blocked",
              path: blockedRepo
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await runOrgRollout([
      "--targets",
      targetsPath,
      "--submodule-path",
      submodulePath,
      "--report",
      reportPath
    ]);

    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as RolloutSummary;
    assert.equal(report.totals.blocked, 1);
    assert.equal(report.targets[0]?.status, "blocked");
    assert.equal(report.targets[0]?.errorCode, "E_TRUST_ROLLOUT_SUBMODULE_INVALID");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
