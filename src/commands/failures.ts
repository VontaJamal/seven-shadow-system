import { extractContextualMatches, DEFAULT_FAILURE_MATCH_TOKENS } from "./shared/logArchive";
import { resolveSentinelContext } from "./shared/context";
import type { FailuresReport, FailureLogExcerpt } from "./types";

export interface FailuresArgs {
  prNumber?: number;
  runId?: number;
  repoArg?: string;
  providerName: string;
  format: "md" | "json";
  maxLinesPerRun: number;
  contextLines: number;
  maxRuns: number;
  maxLogBytes: number;
  matchTokens: string[];
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw makeError("E_SENTINEL_ARG_INVALID", `${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseFormat(value: string): "md" | "json" {
  if (value === "md" || value === "json") {
    return value;
  }

  throw makeError("E_SENTINEL_ARG_INVALID", "--format must be md|json");
}

function parseMatchTokens(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function parseFailuresArgs(argv: string[]): FailuresArgs {
  const args: FailuresArgs = {
    providerName: "github",
    format: "md",
    maxLinesPerRun: 200,
    contextLines: 5,
    maxRuns: 10,
    maxLogBytes: 5_000_000,
    matchTokens: [...DEFAULT_FAILURE_MATCH_TOKENS]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: sss failures [--pr <number>] [--run <id>] [--repo <owner/repo>] [--provider github|gitlab|bitbucket] [--format md|json] [--context-lines <n>] [--max-lines-per-run <n>] [--max-runs <n>] [--max-log-bytes <n>] [--match token,token]"
      );
    }

    if (token === "--pr") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--pr");
      }
      args.prNumber = parsePositiveInt(value, "--pr");
      index += 1;
      continue;
    }

    if (token === "--run") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--run");
      }
      args.runId = parsePositiveInt(value, "--run");
      index += 1;
      continue;
    }

    if (token === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--repo");
      }
      args.repoArg = value;
      index += 1;
      continue;
    }

    if (token === "--provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--provider");
      }
      args.providerName = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (token === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--format");
      }
      args.format = parseFormat(value.trim().toLowerCase());
      index += 1;
      continue;
    }

    if (token === "--max-lines-per-run") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--max-lines-per-run");
      }
      args.maxLinesPerRun = parsePositiveInt(value, "--max-lines-per-run");
      index += 1;
      continue;
    }

    if (token === "--context-lines") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--context-lines");
      }
      args.contextLines = parsePositiveInt(value, "--context-lines");
      index += 1;
      continue;
    }

    if (token === "--max-runs") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--max-runs");
      }
      args.maxRuns = parsePositiveInt(value, "--max-runs");
      index += 1;
      continue;
    }

    if (token === "--max-log-bytes") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--max-log-bytes");
      }
      args.maxLogBytes = parsePositiveInt(value, "--max-log-bytes");
      index += 1;
      continue;
    }

    if (token === "--match") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--match");
      }
      const tokens = parseMatchTokens(value);
      if (tokens.length === 0) {
        throw makeError("E_SENTINEL_ARG_INVALID", "--match must provide at least one token");
      }
      args.matchTokens = tokens;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SENTINEL_ARG_UNKNOWN", token);
    }
  }

  return args;
}

export async function collectFailureExcerpts(
  args: FailuresArgs,
  env: NodeJS.ProcessEnv = process.env
): Promise<FailuresReport> {
  const context = await resolveSentinelContext({
    providerName: args.providerName,
    repoArg: args.repoArg,
    prNumber: args.prNumber,
    env,
    requirePr: args.runId === undefined
  });

  const runs = await context.sentinel.listFailureRuns(
    context.repo,
    {
      prNumber: args.runId ? undefined : context.prNumber ?? undefined,
      runId: args.runId,
      maxRuns: args.maxRuns
    },
    { authToken: context.authToken }
  );

  const excerpts: FailureLogExcerpt[] = [];

  for (const run of runs) {
    for (const job of run.jobs) {
      const logText = await context.sentinel.getJobLogs({
        repo: context.repo,
        jobId: job.jobId,
        authToken: context.authToken,
        maxLogBytes: args.maxLogBytes
      });

      const matchedLines = extractContextualMatches(logText, {
        matchTokens: args.matchTokens,
        contextLines: args.contextLines,
        maxLines: args.maxLinesPerRun
      });

      if (matchedLines.length === 0) {
        continue;
      }

      excerpts.push({
        runId: run.runId,
        workflowName: run.workflowName,
        workflowPath: run.workflowPath,
        runNumber: run.runNumber,
        runAttempt: run.runAttempt,
        runUrl: run.htmlUrl,
        jobId: job.jobId,
        jobName: job.name,
        jobUrl: job.htmlUrl,
        failedStepName: job.failedStepName,
        matchedLines
      });
    }
  }

  excerpts.sort((left, right) => {
    const workflowCompare = (left.workflowPath ?? left.workflowName).localeCompare(right.workflowPath ?? right.workflowName);
    if (workflowCompare !== 0) {
      return workflowCompare;
    }

    const stepCompare = (left.failedStepName ?? left.jobName).localeCompare(right.failedStepName ?? right.jobName);
    if (stepCompare !== 0) {
      return stepCompare;
    }

    return left.jobName.localeCompare(right.jobName);
  });

  return {
    repo: `${context.repo.owner}/${context.repo.repo}`,
    prNumber: context.prNumber,
    runId: args.runId ?? null,
    runs,
    excerpts
  };
}

export function renderFailuresMarkdown(report: FailuresReport): string {
  if (report.excerpts.length === 0) {
    return "## Failing Checks (0)\n\nNo failing CI excerpts were found.\n";
  }

  const lines: string[] = [];
  lines.push(`## Failing Checks (${report.excerpts.length})`);
  lines.push("");

  for (const excerpt of report.excerpts) {
    const workflowLabel = excerpt.workflowPath ?? excerpt.workflowName;
    const stepLabel = excerpt.failedStepName ?? excerpt.jobName;

    lines.push(`### ${workflowLabel} — \"${stepLabel}\" (failed)`);
    lines.push("```");
    lines.push(...excerpt.matchedLines);
    lines.push("```");
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function runFailuresCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseFailuresArgs(argv);
  const report = await collectFailureExcerpts(args, env);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(renderFailuresMarkdown(report));
  return 0;
}
