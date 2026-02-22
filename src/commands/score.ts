import { resolveSentinelContext } from "./shared/context";
import { loadSentinelEyeConfig } from "./shared/sentinelEyeConfig";
import { enrichAndScorePullRequests } from "./shared/triageEngine";
import type { SentinelScoreReport } from "./types";

interface ScoreArgs {
  prNumber?: number;
  repoArg?: string;
  providerName: string;
  format: "md" | "json";
  limit: number;
  configPath?: string;
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

export function parseScoreArgs(argv: string[]): ScoreArgs {
  const args: ScoreArgs = {
    providerName: "github",
    format: "md",
    limit: 20
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: 7s score [--pr <number>] [--repo <owner/repo>] [--provider github|gitlab|bitbucket] [--limit <n>] [--format md|json] [--config <path>]"
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

    if (token === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--limit");
      }
      args.limit = parsePositiveInt(value, "--limit");
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

    if (token === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--config");
      }
      args.configPath = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SENTINEL_ARG_UNKNOWN", token);
    }
  }

  return args;
}

export function renderScoreMarkdown(report: SentinelScoreReport): string {
  const lines: string[] = [];
  lines.push(`## PR Trust Scores (${report.items.length})`);
  lines.push("");
  lines.push(`Repo: \`${report.repo}\``);
  lines.push(`PRs analyzed: ${report.totalPullRequests}`);
  lines.push("");

  if (report.items.length === 0) {
    lines.push("No pull requests were scored.");
    lines.push("");
    return lines.join("\n");
  }

  for (const item of report.items) {
    lines.push(`### #${item.prNumber} ${item.title}`);
    lines.push(`- Priority: ${item.priorityScore}`);
    lines.push(`- Trust: ${item.trustScore}`);
    lines.push(`- Signals: failures=${item.failingRuns}, unresolved-comments=${item.unresolvedComments}, changed-files=${item.changedFiles}, duplicate-peers=${item.duplicatePeers}`);
    lines.push(`- URL: ${item.htmlUrl}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function buildScoreReport(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ args: ScoreArgs; report: SentinelScoreReport }> {
  const args = parseScoreArgs(argv);
  const context = await resolveSentinelContext({
    providerName: args.providerName,
    repoArg: args.repoArg,
    prNumber: args.prNumber,
    env,
    requirePr: false
  });

  const configResult = await loadSentinelEyeConfig({
    configPath: args.configPath
  });

  const pullLimit = Math.min(args.limit, configResult.config.limits.maxPullRequests);
  const pulls = args.prNumber
    ? [await context.sentinel.getPullRequestSummary(context.repo, args.prNumber, { authToken: context.authToken })]
    : await context.sentinel.listOpenPullRequests(
        context.repo,
        {
          maxPullRequests: pullLimit
        },
        {
          authToken: context.authToken
        }
      );

  const scored = await enrichAndScorePullRequests({
    sentinel: context.sentinel,
    authToken: context.authToken,
    config: configResult.config,
    pulls: pulls.map((summary) => ({
      repo: context.repo,
      prNumber: summary.number,
      summary
    }))
  });

  const report: SentinelScoreReport = {
    repo: `${context.repo.owner}/${context.repo.repo}`,
    generatedAt: new Date().toISOString(),
    configPath: configResult.configPath,
    totalPullRequests: scored.items.length,
    items: scored.items.slice(0, args.limit)
  };

  return {
    args,
    report
  };
}

export async function runScoreCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const { args, report } = await buildScoreReport(argv, env);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${renderScoreMarkdown(report)}\n`);
  return 0;
}
