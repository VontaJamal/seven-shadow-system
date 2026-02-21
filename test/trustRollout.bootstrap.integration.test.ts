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

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-trust-rollout-"));
}

async function runCommand(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env
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

async function initTargetRepo(root: string): Promise<string> {
  const repoPath = path.join(root, "target-repo");
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
const args = process.argv.slice(2);
if (process.env.FAIL_TRUST_LINT === "1") {
  console.error("forced lint failure");
  process.exit(1);
}
if (args[0] !== "lint") {
  console.error("unexpected command");
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

async function runBootstrap(args: string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> {
  return runCommand("bash", ["scripts/bootstrap-trust-rollout.sh", ...args], process.cwd(), env);
}

test("bootstrap-trust-rollout scaffolds trust artifacts and keeps reruns idempotent without --force", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);

    const first = await runBootstrap(["--trust-store-version", "1", "--submodule-path", submodulePath, repoPath]);
    assert.equal(first.code, 0, first.stderr);

    const trustStorePath = path.join(repoPath, ".seven-shadow", "policy-trust-store.json");
    const lintSnapshotPath = path.join(repoPath, ".seven-shadow", "trust-rollout", "trust-lint.json");
    const templatePath = path.join(repoPath, ".seven-shadow", "trust-rollout", "pr-template.md");
    const lkgTrustStorePath = path.join(
      repoPath,
      ".seven-shadow",
      "trust-rollout",
      "last-known-good",
      "policy-trust-store.json"
    );
    const lkgLintSnapshotPath = path.join(repoPath, ".seven-shadow", "trust-rollout", "last-known-good", "trust-lint.json");

    const trustStore = JSON.parse(await fs.readFile(trustStorePath, "utf8")) as { schemaVersion: number };
    const lintSnapshot = JSON.parse(await fs.readFile(lintSnapshotPath, "utf8")) as { signerCount: number };
    const template = await fs.readFile(templatePath, "utf8");
    const lkgTrustStore = JSON.parse(await fs.readFile(lkgTrustStorePath, "utf8")) as { schemaVersion: number };
    const lkgLintSnapshot = JSON.parse(await fs.readFile(lkgLintSnapshotPath, "utf8")) as { signerCount: number };

    assert.equal(trustStore.schemaVersion, 1);
    assert.equal(lintSnapshot.signerCount, 1);
    assert.match(template, /Trust store schema version: `1`/);
    assert.match(template, /Target repository:/);
    assert.equal(lkgTrustStore.schemaVersion, 1);
    assert.equal(lkgLintSnapshot.signerCount, 1);

    await fs.writeFile(lintSnapshotPath, "{\n  \"custom\": true\n}\n", "utf8");
    await fs.writeFile(templatePath, "custom-template\n", "utf8");
    await fs.writeFile(lkgTrustStorePath, "{\n  \"custom\": \"lkg\"\n}\n", "utf8");
    await fs.writeFile(lkgLintSnapshotPath, "{\n  \"custom\": \"lkg-lint\"\n}\n", "utf8");

    const second = await runBootstrap(["--trust-store-version", "1", "--submodule-path", submodulePath, repoPath]);
    assert.equal(second.code, 0, second.stderr);

    const lintAfter = await fs.readFile(lintSnapshotPath, "utf8");
    const templateAfter = await fs.readFile(templatePath, "utf8");
    const lkgTrustStoreAfter = await fs.readFile(lkgTrustStorePath, "utf8");
    const lkgLintSnapshotAfter = await fs.readFile(lkgLintSnapshotPath, "utf8");
    assert.match(lintAfter, /"custom": true/);
    assert.equal(templateAfter.trim(), "custom-template");
    assert.match(lkgTrustStoreAfter, /"custom": "lkg"/);
    assert.match(lkgLintSnapshotAfter, /"custom": "lkg-lint"/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("bootstrap-trust-rollout supports trust-store version 2 and force overwrites rollout files", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);

    const first = await runBootstrap(["--trust-store-version", "2", "--submodule-path", submodulePath, repoPath]);
    assert.equal(first.code, 0, first.stderr);

    const trustStorePath = path.join(repoPath, ".seven-shadow", "policy-trust-store.json");
    const lintSnapshotPath = path.join(repoPath, ".seven-shadow", "trust-rollout", "trust-lint.json");
    const templatePath = path.join(repoPath, ".seven-shadow", "trust-rollout", "pr-template.md");
    const lkgTrustStorePath = path.join(
      repoPath,
      ".seven-shadow",
      "trust-rollout",
      "last-known-good",
      "policy-trust-store.json"
    );
    const lkgLintSnapshotPath = path.join(repoPath, ".seven-shadow", "trust-rollout", "last-known-good", "trust-lint.json");

    const trustStore = JSON.parse(await fs.readFile(trustStorePath, "utf8")) as { schemaVersion: number };
    assert.equal(trustStore.schemaVersion, 2);

    await fs.writeFile(lintSnapshotPath, "{\n  \"custom\": true\n}\n", "utf8");
    await fs.writeFile(templatePath, "custom-template\n", "utf8");
    await fs.writeFile(lkgTrustStorePath, "{\n  \"custom\": \"lkg\"\n}\n", "utf8");
    await fs.writeFile(lkgLintSnapshotPath, "{\n  \"custom\": \"lkg-lint\"\n}\n", "utf8");

    const second = await runBootstrap(["--force", "--trust-store-version", "2", "--submodule-path", submodulePath, repoPath]);
    assert.equal(second.code, 0, second.stderr);

    const lintAfter = JSON.parse(await fs.readFile(lintSnapshotPath, "utf8")) as { signerCount: number };
    const templateAfter = await fs.readFile(templatePath, "utf8");
    const lkgTrustStoreAfter = JSON.parse(await fs.readFile(lkgTrustStorePath, "utf8")) as { schemaVersion: number };
    const lkgLintSnapshotAfter = JSON.parse(await fs.readFile(lkgLintSnapshotPath, "utf8")) as { signerCount: number };
    assert.equal(lintAfter.signerCount, 1);
    assert.match(templateAfter, /Trust Rollout Bootstrap PR/);
    assert.doesNotMatch(templateAfter, /custom-template/);
    assert.equal(lkgTrustStoreAfter.schemaVersion, 2);
    assert.equal(lkgLintSnapshotAfter.signerCount, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("bootstrap-trust-rollout surfaces deterministic lint failure code", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);

    const result = await runBootstrap(["--submodule-path", submodulePath, repoPath], {
      ...process.env,
      FAIL_TRUST_LINT: "1"
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /E_TRUST_ROLLOUT_LINT_FAILED/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("bootstrap-trust-rollout validates required args and submodule prerequisites", async () => {
  const tempDir = await makeTempDir();

  try {
    const noArgs = await runBootstrap([]);
    assert.equal(noArgs.code, 1);
    assert.match(noArgs.stderr, /E_TRUST_ROLLOUT_ARG_REQUIRED/);

    const invalidTarget = await runBootstrap([path.join(tempDir, "missing-repo")]);
    assert.equal(invalidTarget.code, 1);
    assert.match(invalidTarget.stderr, /E_TRUST_ROLLOUT_TARGET_INVALID/);

    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath, { includeLintScript: false });

    const missingSubmoduleLint = await runBootstrap(["--submodule-path", submodulePath, repoPath]);
    assert.equal(missingSubmoduleLint.code, 1);
    assert.match(missingSubmoduleLint.stderr, /E_TRUST_ROLLOUT_SUBMODULE_INVALID/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
