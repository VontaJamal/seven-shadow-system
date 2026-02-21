import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type OutputFormat = "text" | "json";
type RolloutStatus = "pending" | "passing" | "blocked";

interface ParsedArgs {
  targetsPath: string;
  trustStoreVersion: 1 | 2;
  submodulePath: string;
  force: boolean;
  reportPath: string;
  format: OutputFormat;
}

interface TrustRolloutTarget {
  id: string;
  path: string;
  enabled?: boolean;
  submodulePath?: string;
}

interface TrustRolloutTargetsFile {
  schemaVersion: 1;
  targets: TrustRolloutTarget[];
}

interface TrustRolloutResult {
  id: string;
  path: string;
  status: RolloutStatus;
  message: string;
  submodulePath: string;
  lintSnapshotPath?: string;
  prTemplatePath?: string;
  signerCount?: number;
  errorCode?: string;
}

interface TrustRolloutSummary {
  schemaVersion: 1;
  generatedAt: string;
  trustStoreVersion: 1 | 2;
  totals: {
    pending: number;
    passing: number;
    blocked: number;
  };
  targets: TrustRolloutResult[];
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    targetsPath: "",
    trustStoreVersion: 2,
    submodulePath: "governance/seven-shadow-system",
    force: false,
    reportPath: path.join(process.cwd(), "trust-rollout-org-report.json"),
    format: "text"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";

    if (token === "--force") {
      parsed.force = true;
      continue;
    }

    if (token === "--targets") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: --targets");
      }
      parsed.targetsPath = value;
      i += 1;
      continue;
    }

    if (token === "--trust-store-version") {
      const value = argv[i + 1];
      if (value !== "1" && value !== "2") {
        throw new Error("E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: --trust-store-version must be 1 or 2");
      }
      parsed.trustStoreVersion = value === "1" ? 1 : 2;
      i += 1;
      continue;
    }

    if (token === "--submodule-path") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: --submodule-path");
      }
      parsed.submodulePath = value;
      i += 1;
      continue;
    }

    if (token === "--report") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: --report");
      }
      parsed.reportPath = value;
      i += 1;
      continue;
    }

    if (token === "--format") {
      const value = argv[i + 1];
      if (value !== "text" && value !== "json") {
        throw new Error("E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: --format must be text|json");
      }
      parsed.format = value;
      i += 1;
      continue;
    }

    throw new Error(`E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: unknown option '${token}'`);
  }

  if (!parsed.targetsPath) {
    throw new Error("E_TRUST_ROLLOUT_ORG_ARG_REQUIRED: --targets");
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTargetsFile(raw: unknown): TrustRolloutTargetsFile {
  if (!isRecord(raw)) {
    throw new Error("E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: targets file must be an object");
  }

  if (raw.schemaVersion !== 1) {
    throw new Error(`E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: unsupported schemaVersion '${String(raw.schemaVersion)}'`);
  }

  const targetsRaw = raw.targets;
  if (!Array.isArray(targetsRaw) || targetsRaw.length === 0) {
    throw new Error("E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: targets must be a non-empty array");
  }

  const targets: TrustRolloutTarget[] = targetsRaw.map((item) => {
    if (!isRecord(item)) {
      throw new Error("E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: each target must be an object");
    }

    if (typeof item.id !== "string" || item.id.trim().length === 0) {
      throw new Error("E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: target.id must be a non-empty string");
    }

    if (typeof item.path !== "string" || item.path.trim().length === 0) {
      throw new Error(`E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: target '${item.id}' path must be a non-empty string`);
    }

    if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
      throw new Error(`E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: target '${item.id}' enabled must be boolean`);
    }

    if (item.submodulePath !== undefined && (typeof item.submodulePath !== "string" || item.submodulePath.length === 0)) {
      throw new Error(`E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: target '${item.id}' submodulePath must be string`);
    }

    return {
      id: item.id,
      path: item.path,
      enabled: item.enabled,
      submodulePath: item.submodulePath
    };
  });

  return {
    schemaVersion: 1,
    targets
  };
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: process.cwd(),
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

function extractErrorCode(output: string): string | undefined {
  const match = output.match(/\b(E_[A-Z0-9_]+)\b/);
  return match?.[1];
}

async function readSignerCount(lintSnapshotPath: string): Promise<number | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(lintSnapshotPath, "utf8")) as { signerCount?: unknown };
    if (typeof raw.signerCount === "number" && Number.isInteger(raw.signerCount) && raw.signerCount >= 0) {
      return raw.signerCount;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function summarizeText(summary: TrustRolloutSummary): string {
  const lines: string[] = [];
  lines.push(
    `Trust rollout summary: passing=${summary.totals.passing} pending=${summary.totals.pending} blocked=${summary.totals.blocked}`
  );
  for (const target of summary.targets) {
    const fields = [`id=${target.id}`, `status=${target.status}`];
    if (target.signerCount !== undefined) {
      fields.push(`signerCount=${target.signerCount}`);
    }
    if (target.errorCode) {
      fields.push(`errorCode=${target.errorCode}`);
    }
    fields.push(`path=${target.path}`);
    lines.push(`- ${fields.join(" ")}`);
  }

  return lines.join("\n");
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bootstrapScriptPath = path.join(process.cwd(), "scripts", "bootstrap-trust-rollout.sh");
  const bootstrapScriptStat = await fs.stat(bootstrapScriptPath).catch(() => null);

  if (!bootstrapScriptStat || !bootstrapScriptStat.isFile()) {
    throw new Error(`E_TRUST_ROLLOUT_ORG_TARGETS_INVALID: bootstrap script not found: ${bootstrapScriptPath}`);
  }

  const targetsRaw = JSON.parse(await fs.readFile(args.targetsPath, "utf8")) as unknown;
  const targetsFile = parseTargetsFile(targetsRaw);

  const results: TrustRolloutResult[] = [];

  for (const target of targetsFile.targets) {
    const targetSubmodulePath = target.submodulePath ?? args.submodulePath;

    if (target.enabled === false) {
      results.push({
        id: target.id,
        path: target.path,
        status: "pending",
        message: "target disabled in rollout file",
        submodulePath: targetSubmodulePath
      });
      continue;
    }

    const bootstrapArgs = [bootstrapScriptPath];
    if (args.force) {
      bootstrapArgs.push("--force");
    }
    bootstrapArgs.push(
      "--trust-store-version",
      String(args.trustStoreVersion),
      "--submodule-path",
      targetSubmodulePath,
      target.path
    );

    const result = await runCommand("bash", bootstrapArgs);

    const lintSnapshotPath = path.join(target.path, ".seven-shadow", "trust-rollout", "trust-lint.json");
    const prTemplatePath = path.join(target.path, ".seven-shadow", "trust-rollout", "pr-template.md");

    if (result.code === 0) {
      const signerCount = await readSignerCount(lintSnapshotPath);
      results.push({
        id: target.id,
        path: target.path,
        status: "passing",
        message: "bootstrap completed",
        submodulePath: targetSubmodulePath,
        lintSnapshotPath,
        prTemplatePath,
        signerCount
      });
      continue;
    }

    const mergedOutput = `${result.stderr}\n${result.stdout}`.trim();
    const errorCode = extractErrorCode(mergedOutput);
    const message = mergedOutput.length > 0 ? mergedOutput.split("\n")[0] ?? "bootstrap failed" : "bootstrap failed";
    results.push({
      id: target.id,
      path: target.path,
      status: "blocked",
      message,
      submodulePath: targetSubmodulePath,
      errorCode
    });
  }

  const sortedTargets = [...results].sort((a, b) => a.id.localeCompare(b.id));
  const summary: TrustRolloutSummary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    trustStoreVersion: args.trustStoreVersion,
    totals: {
      passing: sortedTargets.filter((item) => item.status === "passing").length,
      pending: sortedTargets.filter((item) => item.status === "pending").length,
      blocked: sortedTargets.filter((item) => item.status === "blocked").length
    },
    targets: sortedTargets
  };

  await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
  await fs.writeFile(args.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (args.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(summarizeText(summary));
    console.log(`Report written: ${args.reportPath}`);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Org trust rollout failed: ${message}`);
  process.exit(1);
});
