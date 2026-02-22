export type DashboardMode = "civilian" | "sovereign";

export interface DashboardError {
  code: string;
  message: string;
  remediation?: string;
  details?: Record<string, unknown>;
}

export interface DashboardSection<T> {
  status: "ok" | "error";
  data: T | null;
  error: DashboardError | null;
}

export interface ScoreBreakdown {
  failingRuns: number;
  unresolvedComments: number;
  changedFiles: number;
  linesChanged: number;
  duplicatePeers: number;
}

export interface ScoredNotificationMeta {
  id: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
}

export interface ScoredPullRequest {
  repo: string;
  prNumber: number;
  title: string;
  htmlUrl: string;
  state: string;
  draft: boolean;
  author: string;
  createdAt: string;
  updatedAt: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  linesChanged: number;
  unresolvedComments: number;
  failingRuns: number;
  duplicatePeers: number;
  pathAreas: string[];
  titleFingerprint: string;
  failureSignatures: string[];
  riskPoints: number;
  priorityScore: number;
  trustScore: number;
  breakdown: ScoreBreakdown;
  notification: ScoredNotificationMeta | null;
}

export interface PatternClusterPullRequest {
  repo: string;
  prNumber: number;
  title: string;
  htmlUrl: string;
  priorityScore: number;
}

export interface PatternCluster {
  type: "path-area" | "title-fingerprint" | "failure-signature";
  key: string;
  size: number;
  pullRequests: PatternClusterPullRequest[];
}

export interface ScoreReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalPullRequests: number;
  items: ScoredPullRequest[];
}

export interface PatternsReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalPullRequests: number;
  clusters: PatternCluster[];
}

export interface InboxReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalNotifications: number;
  notificationsConsidered: number;
  skippedNonPullRequest: number;
  items: ScoredPullRequest[];
}

export interface DigestReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalNotifications: number;
  notificationsConsidered: number;
  skippedNonPullRequest: number;
  topPriorities: ScoredPullRequest[];
  topPatterns: PatternCluster[];
}

export interface DashboardSnapshot {
  meta: {
    repo: string;
    provider: "github" | "gitlab" | "bitbucket";
    generatedAt: string;
    stale: boolean;
    backoffSeconds: number;
    nextRefreshAt: string | null;
    refreshIntervalSeconds: number;
  };
  sections: {
    digest: DashboardSection<DigestReport>;
    inbox: DashboardSection<InboxReport>;
    score: DashboardSection<ScoreReport>;
    patterns: DashboardSection<PatternsReport>;
  };
}

export interface DashboardStatus {
  provider: "github" | "gitlab" | "bitbucket";
  repo: string;
  ready: boolean;
  stale: boolean;
  generatedAt: string | null;
  lastSuccessAt: string | null;
  lastError: DashboardError | null;
  backoffSeconds: number;
  nextRefreshAt: string | null;
  refreshIntervalSeconds: number;
}
