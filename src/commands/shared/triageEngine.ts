import type {
  SentinelFailureRun,
  SentinelNotification,
  SentinelProviderAdapter,
  SentinelPullRequestSummary,
  SentinelRepositoryRef
} from "../../providers/types";
import type {
  SentinelPatternCluster,
  SentinelPatternClusterPullRequest,
  SentinelScoredPullRequest,
  SentinelScoreBreakdown
} from "../types";
import type { SentinelEyeConfig } from "./sentinelEyeConfig";

interface PullRequestWorkItem {
  repo: SentinelRepositoryRef;
  prNumber: number;
  summary?: SentinelPullRequestSummary;
  notification?: SentinelNotification;
}

interface ClusterMembership {
  type: SentinelPatternCluster["type"];
  key: string;
  members: number[];
}

interface BuildScoreOptions {
  sentinel: SentinelProviderAdapter;
  authToken: string;
  config: SentinelEyeConfig;
  pulls: PullRequestWorkItem[];
}

interface ScoreResult {
  items: SentinelScoredPullRequest[];
  clusters: SentinelPatternCluster[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSignal(value: number, cap: number): number {
  if (cap <= 0) {
    return 0;
  }

  return clamp(value, 0, cap) / cap;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTitleFingerprint(title: string, config: SentinelEyeConfig): string {
  const stopWords = new Set(["a", "an", "and", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with"]);
  const tokens = normalizeTitle(title)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= config.patterns.minTitleTokenLength)
    .filter((token) => !stopWords.has(token));

  if (tokens.length === 0) {
    return "";
  }

  const uniqueSorted = Array.from(new Set(tokens)).sort((left, right) => left.localeCompare(right));
  return uniqueSorted.slice(0, config.patterns.maxTitleTokens).join(" ");
}

function buildPathArea(pathValue: string, depth: number): string {
  const segments = pathValue
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return "";
  }

  return segments.slice(0, Math.max(1, depth)).join("/");
}

function extractFailureSignatures(runs: SentinelFailureRun[]): string[] {
  const signatures = new Set<string>();

  for (const run of runs) {
    const workflowLabel = run.workflowPath ?? run.workflowName;
    for (const job of run.jobs) {
      const step = job.failedStepName ?? job.name;
      signatures.add(`${workflowLabel}::${step}`);
    }
  }

  return Array.from(signatures).sort((left, right) => left.localeCompare(right));
}

function sortScoredPullRequests(items: SentinelScoredPullRequest[]): SentinelScoredPullRequest[] {
  return [...items].sort((left, right) => {
    if (left.priorityScore !== right.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }

    if (left.unresolvedComments !== right.unresolvedComments) {
      return right.unresolvedComments - left.unresolvedComments;
    }

    if (left.failingRuns !== right.failingRuns) {
      return right.failingRuns - left.failingRuns;
    }

    const repoCompare = left.repo.localeCompare(right.repo);
    if (repoCompare !== 0) {
      return repoCompare;
    }

    return left.prNumber - right.prNumber;
  });
}

function buildMembership(items: SentinelScoredPullRequest[], config: SentinelEyeConfig): ClusterMembership[] {
  const membershipByKey = new Map<string, ClusterMembership>();

  function push(type: SentinelPatternCluster["type"], key: string, index: number): void {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }

    const composite = `${type}|${normalizedKey}`;
    const current = membershipByKey.get(composite);
    if (!current) {
      membershipByKey.set(composite, {
        type,
        key: normalizedKey,
        members: [index]
      });
      return;
    }

    if (!current.members.includes(index)) {
      current.members.push(index);
    }
  }

  items.forEach((item, index) => {
    for (const pathArea of item.pathAreas) {
      push("path-area", pathArea, index);
    }

    if (item.titleFingerprint) {
      push("title-fingerprint", item.titleFingerprint, index);
    }

    for (const signature of item.failureSignatures) {
      push("failure-signature", signature, index);
    }
  });

  return Array.from(membershipByKey.values())
    .map((entry) => ({
      ...entry,
      members: [...entry.members].sort((left, right) => left - right)
    }))
    .filter((entry) => entry.members.length >= config.patterns.minClusterSize)
    .sort((left, right) => {
      if (left.members.length !== right.members.length) {
        return right.members.length - left.members.length;
      }

      return `${left.type}:${left.key}`.localeCompare(`${right.type}:${right.key}`);
    });
}

function buildDuplicatePeerCounts(items: SentinelScoredPullRequest[], membership: ClusterMembership[]): number[] {
  const peerSets = items.map(() => new Set<number>());

  for (const entry of membership) {
    for (const member of entry.members) {
      for (const peer of entry.members) {
        if (member === peer) {
          continue;
        }

        peerSets[member].add(peer);
      }
    }
  }

  return peerSets.map((set) => set.size);
}

function toBreakdown(
  failingRuns: number,
  unresolvedComments: number,
  changedFiles: number,
  linesChanged: number,
  duplicatePeers: number,
  config: SentinelEyeConfig
): SentinelScoreBreakdown {
  return {
    failingRuns: Number(
      (normalizeSignal(failingRuns, config.scoring.caps.failingRuns) * config.scoring.weights.failingRuns).toFixed(3)
    ),
    unresolvedComments: Number(
      (
        normalizeSignal(unresolvedComments, config.scoring.caps.unresolvedComments) *
        config.scoring.weights.unresolvedComments
      ).toFixed(3)
    ),
    changedFiles: Number(
      (normalizeSignal(changedFiles, config.scoring.caps.changedFiles) * config.scoring.weights.changedFiles).toFixed(3)
    ),
    linesChanged: Number(
      (normalizeSignal(linesChanged, config.scoring.caps.linesChanged) * config.scoring.weights.linesChanged).toFixed(3)
    ),
    duplicatePeers: Number(
      (normalizeSignal(duplicatePeers, config.scoring.caps.duplicatePeers) * config.scoring.weights.duplicatePeers).toFixed(3)
    )
  };
}

function totalRiskPoints(breakdown: SentinelScoreBreakdown): number {
  return breakdown.failingRuns + breakdown.unresolvedComments + breakdown.changedFiles + breakdown.linesChanged + breakdown.duplicatePeers;
}

function toPullRequestClusterRef(item: SentinelScoredPullRequest): SentinelPatternClusterPullRequest {
  return {
    repo: item.repo,
    prNumber: item.prNumber,
    title: item.title,
    htmlUrl: item.htmlUrl,
    priorityScore: item.priorityScore
  };
}

function buildPatternClusters(items: SentinelScoredPullRequest[], config: SentinelEyeConfig): SentinelPatternCluster[] {
  const membership = buildMembership(items, config);
  const clusters: SentinelPatternCluster[] = membership.map((entry) => {
    const refs = entry.members
      .map((index) => items[index])
      .map(toPullRequestClusterRef)
      .sort((left, right) => {
        if (left.priorityScore !== right.priorityScore) {
          return right.priorityScore - left.priorityScore;
        }

        const repoCompare = left.repo.localeCompare(right.repo);
        if (repoCompare !== 0) {
          return repoCompare;
        }

        return left.prNumber - right.prNumber;
      });

    return {
      type: entry.type,
      key: entry.key,
      size: refs.length,
      pullRequests: refs
    };
  });

  return clusters;
}

function dedupePullRequests(items: PullRequestWorkItem[]): PullRequestWorkItem[] {
  const byKey = new Map<string, PullRequestWorkItem>();

  for (const item of items) {
    const key = `${item.repo.owner}/${item.repo.repo}#${item.prNumber}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, item);
      continue;
    }

    const currentTime = current.notification ? Date.parse(current.notification.updatedAt) : 0;
    const nextTime = item.notification ? Date.parse(item.notification.updatedAt) : 0;
    if (nextTime > currentTime) {
      byKey.set(key, item);
      continue;
    }

    if (nextTime === currentTime && item.notification?.unread === true && current.notification?.unread !== true) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values()).sort((left, right) => {
    const repoCompare = `${left.repo.owner}/${left.repo.repo}`.localeCompare(`${right.repo.owner}/${right.repo.repo}`);
    if (repoCompare !== 0) {
      return repoCompare;
    }

    return left.prNumber - right.prNumber;
  });
}

export async function enrichAndScorePullRequests(options: BuildScoreOptions): Promise<ScoreResult> {
  const pulls = dedupePullRequests(options.pulls);
  const baseItems: SentinelScoredPullRequest[] = [];

  for (const pull of pulls) {
    const summary = pull.summary ?? (await options.sentinel.getPullRequestSummary(pull.repo, pull.prNumber, { authToken: options.authToken }));
    const comments = await options.sentinel.listUnresolvedComments(pull.repo, pull.prNumber, {
      authToken: options.authToken
    });
    const failureRuns = await options.sentinel.listFailureRuns(
      pull.repo,
      {
        prNumber: pull.prNumber,
        maxRuns: options.config.limits.maxFailureRunsPerPullRequest
      },
      {
        authToken: options.authToken
      }
    );
    const files = await options.sentinel.listPullRequestFiles(
      pull.repo,
      pull.prNumber,
      {
        maxFiles: options.config.limits.maxFilesPerPullRequest
      },
      {
        authToken: options.authToken
      }
    );

    const pathAreas = Array.from(
      new Set(
        files
          .map((file) => buildPathArea(file.path, options.config.patterns.pathDepth))
          .filter((item) => item.length > 0)
      )
    ).sort((left, right) => left.localeCompare(right));

    const titleFingerprint = buildTitleFingerprint(summary.title, options.config);
    const failureSignatures = extractFailureSignatures(failureRuns);
    const linesChanged = summary.additions + summary.deletions;

    baseItems.push({
      repo: `${pull.repo.owner}/${pull.repo.repo}`,
      prNumber: summary.number,
      title: summary.title,
      htmlUrl: summary.htmlUrl,
      state: summary.state,
      draft: summary.draft,
      author: summary.author,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      changedFiles: summary.changedFiles,
      additions: summary.additions,
      deletions: summary.deletions,
      linesChanged,
      unresolvedComments: comments.length,
      failingRuns: failureRuns.length,
      duplicatePeers: 0,
      pathAreas,
      titleFingerprint,
      failureSignatures,
      riskPoints: 0,
      priorityScore: 0,
      trustScore: 100,
      breakdown: {
        failingRuns: 0,
        unresolvedComments: 0,
        changedFiles: 0,
        linesChanged: 0,
        duplicatePeers: 0
      },
      notification: pull.notification
        ? {
            id: pull.notification.id,
            reason: pull.notification.reason,
            unread: pull.notification.unread,
            updatedAt: pull.notification.updatedAt
          }
        : null
    });
  }

  const membership = buildMembership(baseItems, options.config);
  const peerCounts = buildDuplicatePeerCounts(baseItems, membership);

  const scored = baseItems.map((item, index) => {
    const duplicatePeers = peerCounts[index] ?? 0;
    const breakdown = toBreakdown(
      item.failingRuns,
      item.unresolvedComments,
      item.changedFiles,
      item.linesChanged,
      duplicatePeers,
      options.config
    );
    const riskPoints = Number(totalRiskPoints(breakdown).toFixed(3));
    const priorityScore = clamp(Math.round(riskPoints), 0, 100);

    return {
      ...item,
      duplicatePeers,
      breakdown,
      riskPoints,
      priorityScore,
      trustScore: 100 - priorityScore
    };
  });

  const sortedItems = sortScoredPullRequests(scored);
  const clusters = buildPatternClusters(sortedItems, options.config);

  return {
    items: sortedItems,
    clusters
  };
}
