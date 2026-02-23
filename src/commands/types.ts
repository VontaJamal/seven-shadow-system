import type { SentinelFailureRun, SentinelUnresolvedComment } from "../providers/types";
import type { ShadowGateReportV3 } from "../shadows/types";

export type SentinelProviderName = "github" | "gitlab" | "bitbucket";

export interface CommandResolution {
  providerName: SentinelProviderName;
  repo: {
    owner: string;
    repo: string;
  };
  prNumber: number;
  authToken: string;
  authTokenEnvVar: string;
}

export interface FailureExtractionConfig {
  contextLines: number;
  maxLinesPerRun: number;
  maxRuns: number;
  maxLogBytes: number;
  matchTokens: string[];
}

export interface FailureLogExcerpt {
  runId: number;
  workflowName: string;
  workflowPath: string | null;
  runNumber: number;
  runAttempt: number;
  runUrl: string;
  jobId: number;
  jobName: string;
  jobUrl: string;
  failedStepName: string | null;
  matchedLines: string[];
}

export interface LintFinding {
  type: "lint" | "typecheck" | "test" | "generic";
  tool: string;
  file: string;
  line: number;
  column?: number;
  severity: "error" | "warn";
  rule?: string;
  message: string;
}

export interface TestNameFinding {
  file: string;
  line: number;
  name: string;
  reason: string;
}

export interface TestQualityMetrics {
  testsAdded: number | null;
  testsRemoved: number | null;
  testLinesDelta: number | null;
  codeLinesAdded: number | null;
  coverageDeltaPercent: number | null;
  inflationWarning: boolean;
  consolidationPraise: boolean;
  notes: string[];
}

export interface TestQualityReport {
  scannedPath: string;
  totalTests: number;
  flaggedNames: TestNameFinding[];
  behavioralExamples: TestNameFinding[];
  metrics: TestQualityMetrics;
}

export interface CommentsReport {
  repo: string;
  prNumber: number;
  comments: SentinelUnresolvedComment[];
}

export interface FailuresReport {
  repo: string;
  prNumber: number | null;
  runId: number | null;
  runs: SentinelFailureRun[];
  excerpts: FailureLogExcerpt[];
}

export interface LintReport {
  repo: string;
  prNumber: number | null;
  runId: number | null;
  findings: LintFinding[];
}

export interface SentinelScoreBreakdown {
  failingRuns: number;
  unresolvedComments: number;
  changedFiles: number;
  linesChanged: number;
  duplicatePeers: number;
}

export interface SentinelScoredNotificationMeta {
  id: string;
  reason: string;
  unread: boolean;
  updatedAt: string;
}

export interface SentinelScoredPullRequest {
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
  breakdown: SentinelScoreBreakdown;
  notification: SentinelScoredNotificationMeta | null;
}

export interface SentinelPatternClusterPullRequest {
  repo: string;
  prNumber: number;
  title: string;
  htmlUrl: string;
  priorityScore: number;
}

export interface SentinelPatternCluster {
  type: "path-area" | "title-fingerprint" | "failure-signature";
  key: string;
  size: number;
  pullRequests: SentinelPatternClusterPullRequest[];
}

export interface SentinelScoreReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalPullRequests: number;
  items: SentinelScoredPullRequest[];
}

export interface SentinelPatternsReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalPullRequests: number;
  clusters: SentinelPatternCluster[];
}

export interface SentinelInboxReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalNotifications: number;
  notificationsConsidered: number;
  skippedNonPullRequest: number;
  items: SentinelScoredPullRequest[];
}

export interface SentinelDigestReport {
  repo: string;
  generatedAt: string;
  configPath: string;
  totalNotifications: number;
  notificationsConsidered: number;
  skippedNonPullRequest: number;
  topPriorities: SentinelScoredPullRequest[];
  topPatterns: SentinelPatternCluster[];
}

export type ShadowGateReport = ShadowGateReportV3;
