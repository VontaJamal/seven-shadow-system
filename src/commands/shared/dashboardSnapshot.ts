import {
  type ResolvedSentinelContext,
  resolveSentinelContext
} from "./context";
import {
  type SentinelEyeConfig,
  loadSentinelEyeConfig
} from "./sentinelEyeConfig";
import { enrichAndScorePullRequests } from "./triageEngine";
import type {
  SentinelDigestReport,
  SentinelInboxReport,
  SentinelPatternsReport,
  SentinelProviderName,
  SentinelScoreReport
} from "../types";
import type { SentinelNotification } from "../../providers/types";
import type {
  SentinelDashboardError,
  SentinelDashboardSection,
  SentinelDashboardSnapshot
} from "../../dashboard/types";

export interface BuildDashboardSnapshotOptions {
  providerName: SentinelProviderName;
  repoArg?: string;
  limit: number;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  stale: boolean;
  backoffSeconds: number;
  nextRefreshAt: string | null;
  refreshIntervalSeconds: number;
}

function fallbackRepoLabel(repoArg?: string): string {
  if (!repoArg) {
    return "unknown/unknown";
  }

  const trimmed = repoArg.trim();
  if (!trimmed.includes("/")) {
    return "unknown/unknown";
  }

  return trimmed;
}

function toDashboardError(error: unknown): SentinelDashboardError {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.trim();
  const match = message.match(/^([A-Z0-9_]+):\s*(.*)$/);

  if (!match) {
    return {
      code: "E_DASHBOARD_UNKNOWN",
      message: message.slice(0, 220)
    };
  }

  return {
    code: match[1] ?? "E_DASHBOARD_UNKNOWN",
    message: (match[2] ?? "unknown error").slice(0, 220)
  };
}

function okSection<T>(data: T): SentinelDashboardSection<T> {
  return {
    status: "ok",
    data,
    error: null
  };
}

function errorSection<T>(error: unknown): SentinelDashboardSection<T> {
  return {
    status: "error",
    data: null,
    error: toDashboardError(error)
  };
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

async function resolveBaseInputs(
  options: BuildDashboardSnapshotOptions
): Promise<{
  context: ResolvedSentinelContext;
  config: SentinelEyeConfig;
  configPath: string;
}> {
  const context = await resolveSentinelContext({
    providerName: options.providerName,
    repoArg: options.repoArg,
    env: options.env,
    requirePr: false
  });

  const configResult = await loadSentinelEyeConfig({
    configPath: options.configPath
  });

  return {
    context,
    config: configResult.config,
    configPath: configResult.configPath
  };
}

function emptyMeta(options: BuildDashboardSnapshotOptions): SentinelDashboardSnapshot {
  const now = new Date().toISOString();

  return {
    meta: {
      repo: fallbackRepoLabel(options.repoArg),
      provider: options.providerName,
      generatedAt: now,
      stale: options.stale,
      backoffSeconds: options.backoffSeconds,
      nextRefreshAt: options.nextRefreshAt,
      refreshIntervalSeconds: options.refreshIntervalSeconds
    },
    sections: {
      digest: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard snapshot not ready"
        }
      },
      inbox: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard snapshot not ready"
        }
      },
      score: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard snapshot not ready"
        }
      },
      patterns: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard snapshot not ready"
        }
      }
    }
  };
}

export async function buildDashboardSnapshot(options: BuildDashboardSnapshotOptions): Promise<SentinelDashboardSnapshot> {
  const generatedAt = new Date().toISOString();
  const fallbackSnapshot = emptyMeta(options);

  let context: ResolvedSentinelContext;
  let config: SentinelEyeConfig;
  let configPath: string;

  try {
    const resolved = await resolveBaseInputs(options);
    context = resolved.context;
    config = resolved.config;
    configPath = resolved.configPath;
  } catch (error) {
    const sectionError = errorSection<SentinelDigestReport>(error).error;
    return {
      meta: {
        ...fallbackSnapshot.meta,
        generatedAt
      },
      sections: {
        digest: {
          status: "error",
          data: null,
          error: sectionError
        },
        inbox: {
          status: "error",
          data: null,
          error: sectionError
        },
        score: {
          status: "error",
          data: null,
          error: sectionError
        },
        patterns: {
          status: "error",
          data: null,
          error: sectionError
        }
      }
    };
  }

  const repoLabel = `${context.repo.owner}/${context.repo.repo}`;

  let scoreSection: SentinelDashboardSection<SentinelScoreReport>;
  let patternsSection: SentinelDashboardSection<SentinelPatternsReport>;

  try {
    const pullLimit = Math.min(options.limit, config.limits.maxPullRequests);
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
      config,
      pulls: pulls.map((summary) => ({
        repo: context.repo,
        prNumber: summary.number,
        summary
      }))
    });

    const scoreReport: SentinelScoreReport = {
      repo: repoLabel,
      generatedAt,
      configPath,
      totalPullRequests: scored.items.length,
      items: scored.items.slice(0, options.limit)
    };

    const patternsReport: SentinelPatternsReport = {
      repo: repoLabel,
      generatedAt,
      configPath,
      totalPullRequests: scored.items.length,
      clusters: scored.clusters.slice(0, options.limit)
    };

    scoreSection = okSection(scoreReport);
    patternsSection = okSection(patternsReport);
  } catch (error) {
    scoreSection = errorSection(error);
    patternsSection = errorSection(error);
  }

  let inboxSection: SentinelDashboardSection<SentinelInboxReport>;
  let digestSection: SentinelDashboardSection<SentinelDigestReport>;

  try {
    const includeRead = config.inbox.includeReadByDefault;
    const maxNotifications = Math.min(
      config.limits.maxNotifications,
      Math.max(options.limit, Math.min(options.limit * 3, config.limits.maxNotifications))
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
      if (config.inbox.requireNotificationsScope) {
        throw error;
      }
    }

    const prNotifications = notifications.filter(isPullRequestNotification);
    const deduped = dedupeNotifications(prNotifications);

    const scored = await enrichAndScorePullRequests({
      sentinel: context.sentinel,
      authToken: context.authToken,
      config,
      pulls: deduped
        .filter((notification) => notification.pullNumber !== null)
        .map((notification) => ({
          repo: context.repo,
          prNumber: notification.pullNumber ?? 0,
          notification
        }))
    });

    const inboxReport: SentinelInboxReport = {
      repo: repoLabel,
      generatedAt,
      configPath,
      totalNotifications: notifications.length,
      notificationsConsidered: deduped.length,
      skippedNonPullRequest: notifications.length - prNotifications.length,
      items: scored.items.slice(0, options.limit)
    };

    const digestReport: SentinelDigestReport = {
      repo: repoLabel,
      generatedAt,
      configPath,
      totalNotifications: notifications.length,
      notificationsConsidered: deduped.length,
      skippedNonPullRequest: notifications.length - prNotifications.length,
      topPriorities: scored.items.slice(0, options.limit),
      topPatterns: scored.clusters.slice(0, options.limit)
    };

    inboxSection = okSection(inboxReport);
    digestSection = okSection(digestReport);
  } catch (error) {
    inboxSection = errorSection(error);
    digestSection = errorSection(error);
  }

  return {
    meta: {
      repo: repoLabel,
      provider: options.providerName,
      generatedAt,
      stale: options.stale,
      backoffSeconds: options.backoffSeconds,
      nextRefreshAt: options.nextRefreshAt,
      refreshIntervalSeconds: options.refreshIntervalSeconds
    },
    sections: {
      digest: digestSection,
      inbox: inboxSection,
      score: scoreSection,
      patterns: patternsSection
    }
  };
}
