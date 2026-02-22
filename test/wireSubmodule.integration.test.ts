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

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-wire-"));
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

async function seedSubmoduleSkeleton(targetRepo: string, submodulePath: string): Promise<void> {
  const root = path.join(targetRepo, submodulePath);

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
  await copyFixture(
    "templates/submodule/readme-protection-block.md",
    path.join(root, "templates", "submodule", "readme-protection-block.md")
  );
}

async function runWireSubmodule(args: string[]): Promise<CommandResult> {
  return runCommand("bash", ["scripts/wire-submodule.sh", ...args], process.cwd());
}

test("wire-submodule default mode keeps baseline behavior and injects README protection block", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);
    const readmePath = path.join(repoPath, "README.md");
    const initialReadme = "# Target Repo\n\nIntro text.\n";
    await fs.writeFile(readmePath, initialReadme, "utf8");

    const result = await runWireSubmodule([repoPath, submodulePath]);
    assert.equal(result.code, 0, result.stderr);

    await fs.access(path.join(repoPath, ".seven-shadow", "policy.json"));
    await fs.access(path.join(repoPath, ".github", "workflows", "seven-shadow-system.yml"));

    await assert.rejects(() => fs.access(path.join(repoPath, ".seven-shadow", "policy-trust-store.json")));
    await assert.rejects(() => fs.access(path.join(repoPath, ".seven-shadow", "policy.bundle.template.json")));
    await assert.rejects(() => fs.access(path.join(repoPath, ".seven-shadow", "policy-bundle-quickstart.md")));

    const readme = await fs.readFile(readmePath, "utf8");
    assert.match(readme, /Intro text\./);
    assert.match(readme, /Protected by the \[Seven Shadows\]/);
    assert.match(readme, /https:\/\/github\.com\/VontaJamal\/shadow-vault/);

    const secondRun = await runWireSubmodule([repoPath, submodulePath]);
    assert.equal(secondRun.code, 0, secondRun.stderr);
    const secondReadme = await fs.readFile(readmePath, "utf8");
    const marker = "seven-shadow-system:protection-block:start";
    const markerCount = secondReadme.split(marker).length - 1;
    assert.equal(markerCount, 1);
    assert.match(secondReadme, /Intro text\./);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("wire-submodule opt-in bundle trust scaffold is idempotent", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);

    const first = await runWireSubmodule(["--with-bundle-trust", "--trust-store-version", "1", repoPath, submodulePath]);
    assert.equal(first.code, 0, first.stderr);

    const trustStorePath = path.join(repoPath, ".seven-shadow", "policy-trust-store.json");
    const bundleTemplatePath = path.join(repoPath, ".seven-shadow", "policy.bundle.template.json");
    const quickstartPath = path.join(repoPath, ".seven-shadow", "policy-bundle-quickstart.md");

    const trustStore = JSON.parse(await fs.readFile(trustStorePath, "utf8")) as { schemaVersion: number };
    assert.equal(trustStore.schemaVersion, 1);
    await fs.access(bundleTemplatePath);
    await fs.access(quickstartPath);
    await assert.rejects(() => fs.access(path.join(repoPath, ".seven-shadow", "policy.bundle.json")));

    await fs.writeFile(trustStorePath, "{\n  \"custom\": true\n}\n", "utf8");
    const second = await runWireSubmodule(["--with-bundle-trust", "--trust-store-version", "1", repoPath, submodulePath]);
    assert.equal(second.code, 0, second.stderr);
    const customContent = await fs.readFile(trustStorePath, "utf8");
    assert.match(customContent, /"custom": true/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("wire-submodule supports trust store version 2 and validates flag usage", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);

    const v2Result = await runWireSubmodule(["--with-bundle-trust", "--trust-store-version", "2", repoPath, submodulePath]);
    assert.equal(v2Result.code, 0, v2Result.stderr);
    const trustStore = JSON.parse(await fs.readFile(path.join(repoPath, ".seven-shadow", "policy-trust-store.json"), "utf8")) as {
      schemaVersion: number;
    };
    assert.equal(trustStore.schemaVersion, 2);

    const invalidResult = await runWireSubmodule(["--trust-store-version", "1", repoPath, submodulePath]);
    assert.equal(invalidResult.code, 1);
    assert.match(`${invalidResult.stdout}\n${invalidResult.stderr}`, /--trust-store-version is only valid when --with-bundle-trust is set/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("wire-submodule --skip-readme-badge keeps existing README untouched", async () => {
  const tempDir = await makeTempDir();

  try {
    const repoPath = await initTargetRepo(tempDir);
    const submodulePath = "governance/seven-shadow-system";
    await seedSubmoduleSkeleton(repoPath, submodulePath);

    const readmePath = path.join(repoPath, "README.md");
    const initialReadme = "# Target Repo\n\nNo managed footer yet.\n";
    await fs.writeFile(readmePath, initialReadme, "utf8");

    const result = await runWireSubmodule(["--skip-readme-badge", repoPath, submodulePath]);
    assert.equal(result.code, 0, result.stderr);

    const readme = await fs.readFile(readmePath, "utf8");
    assert.equal(readme, initialReadme);
    assert.doesNotMatch(readme, /Protected by the \[Seven Shadows\]/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
