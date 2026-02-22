import type { SentinelFailureRun, SentinelUnresolvedComment } from "../providers/types";

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
