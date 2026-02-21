import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sha256Hex, toReplayComparable } from "../src/policyGovernance";
import { runSevenShadowSystem, type GuardReportV2 } from "../src/sevenShadowSystem";

interface ParsedArgs {
  iterations: number;
  reportPath?: string;
}

interface ReplayCase {
  id: string;
  provider: "github" | "gitlab" | "bitbucket";
  eventName: string;
  eventPath: string;
}

interface CaseBaseline {
  baselineHash: string;
  decision: GuardReportV2["decision"];
  targetsScanned: number;
}

interface RcSoakReportCase {
  id: string;
  provider: string;
  eventName: string;
  baselineHash: string;
  decision: GuardReportV2["decision"];
  targetsScanned: number;
}

interface RcSoakReport {
  schemaVersion: 1;
  generatedAt: string;
  iterations: number;
  cases: RcSoakReportCase[];
  failClosedProviders: string[];
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`E_RC_SOAK_ARG_REQUIRED: ${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    iterations: 72
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";

    if (token === "--iterations") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_RC_SOAK_ARG_REQUIRED: --iterations");
      }

      parsed.iterations = parsePositiveInt(value, "--iterations");
      i += 1;
      continue;
    }

    if (token === "--report") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_RC_SOAK_ARG_REQUIRED: --report");
      }

      parsed.reportPath = value;
      i += 1;
      continue;
    }

    throw new Error(`E_RC_SOAK_ARG_REQUIRED: unsupported option '${token}'`);
  }

  return parsed;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("E_RC_SOAK_POLICY_INVALID: expected policy object");
  }

  return value as Record<string, unknown>;
}

function withMinApprovals(policy: Record<string, unknown>, minHumanApprovals: number): Record<string, unknown> {
  const approvals = (policy.approvals ?? {}) as Record<string, unknown>;
  return {
    ...policy,
    approvals: {
      ...approvals,
      minHumanApprovals
    }
  };
}

async function runCase(options: {
  policyPath: string;
  targetCase: ReplayCase;
  reportPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<GuardReportV2> {
  const originalLog = console.log;
  console.log = () => {};
  try {
    await runSevenShadowSystem(
      [
        "--policy",
        options.policyPath,
        "--provider",
        options.targetCase.provider,
        "--event",
        options.targetCase.eventPath,
        "--event-name",
        options.targetCase.eventName,
        "--report",
        options.reportPath,
        "--redact"
      ],
      options.env
    );
  } finally {
    console.log = originalLog;
  }

  const reportRaw = JSON.parse(await fs.readFile(options.reportPath, "utf8")) as GuardReportV2;
  return reportRaw;
}

function ensureFailClosed(options: {
  provider: ReplayCase["provider"];
  report: GuardReportV2;
  tokenEnvVar: string;
}): void {
  if (options.report.decision !== "block") {
    throw new Error(
      `E_RC_SOAK_FAIL_CLOSED: provider '${options.provider}' expected block decision for missing token, got '${options.report.decision}'`
    );
  }

  const finding = options.report.findings.find((item) => item.code === "GUARD_APPROVALS_UNVERIFIED");
  if (!finding) {
    throw new Error(
      `E_RC_SOAK_FAIL_CLOSED: provider '${options.provider}' missing GUARD_APPROVALS_UNVERIFIED finding under missing token conditions`
    );
  }

  if (!finding.message.includes(options.tokenEnvVar)) {
    throw new Error(
      `E_RC_SOAK_FAIL_CLOSED: provider '${options.provider}' missing token message should reference ${options.tokenEnvVar}`
    );
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-rc-soak-"));

  const replayCases: ReplayCase[] = [
    {
      id: "github-pr-review",
      provider: "github",
      eventName: "pull_request_review",
      eventPath: path.join(process.cwd(), "examples", "pr_review_event.json")
    },
    {
      id: "gitlab-merge-request",
      provider: "gitlab",
      eventName: "Merge Request Hook",
      eventPath: path.join(process.cwd(), "examples", "gitlab", "merge-request-hook.json")
    },
    {
      id: "gitlab-note-hook",
      provider: "gitlab",
      eventName: "Note Hook",
      eventPath: path.join(process.cwd(), "examples", "gitlab", "note-hook.json")
    },
    {
      id: "bitbucket-pullrequest-created",
      provider: "bitbucket",
      eventName: "pullrequest:created",
      eventPath: path.join(process.cwd(), "examples", "bitbucket", "pullrequest-created.json")
    }
  ];

  const failClosedCases: Array<{ targetCase: ReplayCase; tokenEnvVar: string }> = [
    { targetCase: replayCases[0], tokenEnvVar: "GITHUB_TOKEN" },
    { targetCase: replayCases[1], tokenEnvVar: "GITLAB_TOKEN" },
    { targetCase: replayCases[3], tokenEnvVar: "BITBUCKET_TOKEN" }
  ];

  try {
    const basePolicyPath = path.join(process.cwd(), "config", "seven-shadow-system.policy.json");
    const basePolicyRaw = JSON.parse(await fs.readFile(basePolicyPath, "utf8")) as unknown;
    const basePolicy = asRecord(basePolicyRaw);

    const deterministicPolicyPath = path.join(tempDir, "policy.deterministic.json");
    const failClosedPolicyPath = path.join(tempDir, "policy.fail-closed.json");
    await fs.writeFile(deterministicPolicyPath, `${JSON.stringify(withMinApprovals(basePolicy, 0), null, 2)}\n`, "utf8");
    await fs.writeFile(failClosedPolicyPath, `${JSON.stringify(withMinApprovals(basePolicy, 1), null, 2)}\n`, "utf8");

    const baselines = new Map<string, CaseBaseline>();

    for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
      for (const targetCase of replayCases) {
        const reportPath = path.join(tempDir, `${targetCase.id}.iter-${iteration}.json`);
        const report = await runCase({
          policyPath: deterministicPolicyPath,
          targetCase,
          reportPath,
          env: { ...process.env, GITHUB_TOKEN: "", GITLAB_TOKEN: "", BITBUCKET_TOKEN: "" }
        });

        const replayComparable = toReplayComparable(report as unknown as Record<string, unknown>);
        const comparableHash = sha256Hex(replayComparable);
        const baseline = baselines.get(targetCase.id);

        if (!baseline) {
          baselines.set(targetCase.id, {
            baselineHash: comparableHash,
            decision: report.decision,
            targetsScanned: report.targetsScanned
          });
          continue;
        }

        if (baseline.baselineHash !== comparableHash) {
          throw new Error(
            `E_RC_SOAK_REPLAY_DRIFT: case='${targetCase.id}' iteration=${iteration} expected=${baseline.baselineHash} actual=${comparableHash}`
          );
        }
      }
    }

    for (const item of failClosedCases) {
      const reportPath = path.join(tempDir, `${item.targetCase.id}.fail-closed.json`);
      const report = await runCase({
        policyPath: failClosedPolicyPath,
        targetCase: item.targetCase,
        reportPath,
        env: { ...process.env, GITHUB_TOKEN: "", GITLAB_TOKEN: "", BITBUCKET_TOKEN: "" }
      });

      ensureFailClosed({
        provider: item.targetCase.provider,
        report,
        tokenEnvVar: item.tokenEnvVar
      });
    }

    const summary: RcSoakReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      iterations: args.iterations,
      cases: replayCases.map((item) => {
        const baseline = baselines.get(item.id);
        if (!baseline) {
          throw new Error(`E_RC_SOAK_REPLAY_DRIFT: missing baseline for case '${item.id}'`);
        }

        return {
          id: item.id,
          provider: item.provider,
          eventName: item.eventName,
          baselineHash: baseline.baselineHash,
          decision: baseline.decision,
          targetsScanned: baseline.targetsScanned
        };
      }),
      failClosedProviders: failClosedCases.map((item) => item.targetCase.provider)
    };

    if (args.reportPath) {
      await fs.mkdir(path.dirname(args.reportPath), { recursive: true });
      await fs.writeFile(args.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      console.log(`RC soak report written: ${args.reportPath}`);
    }

    console.log(`RC soak passed: ${summary.cases.length} cases x ${summary.iterations} iteration(s)`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`RC soak failed: ${message}`);
  process.exit(1);
});
