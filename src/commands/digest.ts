import { resolveSentinelContext } from "./shared/context";
import { loadSentinelEyeConfig } from "./shared/sentinelEyeConfig";
import { enrichAndScorePullRequests } from "./shared/triageEngine";
import type { SentinelDigestReport } from "./types";
import type { SentinelNotification } from "../providers/types";

interface DigestArgs {
  repoArg?: string;
  providerName: string;
  format: "md" | "json";
  limit: number;
  includeAll: boolean;
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

export function parseDigestArgs(argv: string[]): DigestArgs {
  const args: DigestArgs = {
    providerName: "github",
    format: "md",
    limit: 20,
    includeAll: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: 7s digest [--repo <owner/repo>] [--provider github|gitlab|bitbucket] [--limit <n>] [--all] [--format md|json] [--config <path>]"
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

    if (token === "--all") {
      args.includeAll = true;
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

function isPullRequestNotification(notification: SentinelNotification): boolean {
  if (notification.pullNumber === null) {
    return false;
  }

  const normalized = notification.subjectType.trim().toLowerCase();
  return normalized === "pullrequest" || normalized === "pull_request";
}

function dedupeNotifications(notifications: SentinelNotification[]): SentinelNotification[] {
  const byPull = new Map<number, SentinelNotification>();

  for (const notification of notifications) {
    const prNumber = notification.pullNumber;
    if (prNumber === null) {
      continue;
    }

    const current = byPull.get(prNumber);
    if (!current) {
      byPull.set(prNumber, notification);
      continue;
    }

    const currentUpdated = Date.parse(current.updatedAt);
    const incomingUpdated = Date.parse(notification.updatedAt);
    if (incomingUpdated > currentUpdated) {
      byPull.set(prNumber, notification);
      continue;
    }

    if (incomingUpdated === currentUpdated && notification.unread && !current.unread) {
      byPull.set(prNumber, notification);
    }
  }

  return Array.from(byPull.values()).sort((left, right) => {
    const updatedCompare = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedCompare !== 0) {
      return updatedCompare;
    }

    return (left.pullNumber ?? 0) - (right.pullNumber ?? 0);
  });
}

export function renderDigestMarkdown(report: SentinelDigestReport): string {
  const lines: string[] = [];
  lines.push("## Sentinel Eye Digest");
  lines.push("");
  lines.push(`Repo: \`${report.repo}\``);
  lines.push(`Notifications scanned: ${report.totalNotifications}`);
  lines.push(`PR notifications considered: ${report.notificationsConsidered}`);
  lines.push(`Skipped non-PR notifications: ${report.skippedNonPullRequest}`);
  lines.push("");

  lines.push(`### Top Priorities (${report.topPriorities.length})`);
  if (report.topPriorities.length === 0) {
    lines.push("No priority pull requests were identified.");
  } else {
    for (const item of report.topPriorities) {
      lines.push(
        `- #${item.prNumber} [${item.title}](${item.htmlUrl}) - priority ${item.priorityScore}, trust ${item.trustScore}, failures ${item.failingRuns}, unresolved ${item.unresolvedComments}`
      );
    }
  }
  lines.push("");

  lines.push(`### Top Pattern Clusters (${report.topPatterns.length})`);
  if (report.topPatterns.length === 0) {
    lines.push("No clusters met the configured threshold.");
  } else {
    for (const cluster of report.topPatterns) {
      lines.push(`- [${cluster.type}] ${cluster.key} (${cluster.size})`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export async function buildDigestReport(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ args: DigestArgs; report: SentinelDigestReport }> {
  const args = parseDigestArgs(argv);
  const context = await resolveSentinelContext({
    providerName: args.providerName,
    repoArg: args.repoArg,
    env,
    requirePr: false
  });

  const configResult = await loadSentinelEyeConfig({
    configPath: args.configPath
  });

  const includeRead = args.includeAll || configResult.config.inbox.includeReadByDefault;
  const maxNotifications = Math.min(
    configResult.config.limits.maxNotifications,
    Math.max(args.limit, Math.min(args.limit * 3, configResult.config.limits.maxNotifications))
  );

  let notifications: SentinelNotification[] = [];
  try {
    notifications = await context.sentinel.listNotifications(
      {
        repo: context.repo,
        maxItems: maxNotifications,
        includeRead
      },
      {
        authToken: context.authToken
      }
    );
  } catch (error) {
    if (configResult.config.inbox.requireNotificationsScope) {
      throw error;
    }
  }

  const prNotifications = notifications.filter(isPullRequestNotification);
  const deduped = dedupeNotifications(prNotifications);

  const scored = await enrichAndScorePullRequests({
    sentinel: context.sentinel,
    authToken: context.authToken,
    config: configResult.config,
    pulls: deduped
      .filter((notification) => notification.pullNumber !== null)
      .map((notification) => ({
        repo: context.repo,
        prNumber: notification.pullNumber ?? 0,
        notification
      }))
  });

  const report: SentinelDigestReport = {
    repo: `${context.repo.owner}/${context.repo.repo}`,
    generatedAt: new Date().toISOString(),
    configPath: configResult.configPath,
    totalNotifications: notifications.length,
    notificationsConsidered: deduped.length,
    skippedNonPullRequest: notifications.length - prNotifications.length,
    topPriorities: scored.items.slice(0, args.limit),
    topPatterns: scored.clusters.slice(0, args.limit)
  };

  return {
    args,
    report
  };
}

export async function runDigestCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const { args, report } = await buildDigestReport(argv, env);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${renderDigestMarkdown(report)}\n`);
  return 0;
}
