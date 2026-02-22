import { resolveSentinelContext } from "./shared/context";
import { enrichAndScorePullRequests } from "./shared/triageEngine";
import { loadSentinelEyeConfig } from "./shared/sentinelEyeConfig";
import type { SentinelPatternsReport } from "./types";

interface PatternsArgs {
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

export function parsePatternsArgs(argv: string[]): PatternsArgs {
  const args: PatternsArgs = {
    providerName: "github",
    format: "md",
    limit: 20
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: 7s patterns [--repo <owner/repo>] [--provider github|gitlab|bitbucket] [--limit <n>] [--format md|json] [--config <path>]"
      );
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

export function renderPatternsMarkdown(report: SentinelPatternsReport): string {
  const lines: string[] = [];
  lines.push(`## Pattern Clusters (${report.clusters.length})`);
  lines.push("");
  lines.push(`Repo: \`${report.repo}\``);
  lines.push(`PRs analyzed: ${report.totalPullRequests}`);
  lines.push("");

  if (report.clusters.length === 0) {
    lines.push("No clusters met the configured threshold.");
    lines.push("");
    return lines.join("\n");
  }

  for (const cluster of report.clusters) {
    lines.push(`### [${cluster.type}] ${cluster.key} (${cluster.size})`);
    for (const pr of cluster.pullRequests) {
      lines.push(`- #${pr.prNumber} [${pr.title}](${pr.htmlUrl}) - priority ${pr.priorityScore}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function buildPatternsReport(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ args: PatternsArgs; report: SentinelPatternsReport }> {
  const args = parsePatternsArgs(argv);
  const context = await resolveSentinelContext({
    providerName: args.providerName,
    repoArg: args.repoArg,
    env,
    requirePr: false
  });

  const configResult = await loadSentinelEyeConfig({
    configPath: args.configPath
  });
  const pullLimit = Math.min(args.limit, configResult.config.limits.maxPullRequests);

  const pulls = await context.sentinel.listOpenPullRequests(
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

  const report: SentinelPatternsReport = {
    repo: `${context.repo.owner}/${context.repo.repo}`,
    generatedAt: new Date().toISOString(),
    configPath: configResult.configPath,
    totalPullRequests: scored.items.length,
    clusters: scored.clusters.slice(0, args.limit)
  };

  return {
    args,
    report
  };
}

export async function runPatternsCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const { args, report } = await buildPatternsReport(argv, env);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${renderPatternsMarkdown(report)}\n`);
  return 0;
}
