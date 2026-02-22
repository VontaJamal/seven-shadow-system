export interface ProviderPolicyContext {
  scanPrBody: boolean;
  scanReviewBody: boolean;
  scanCommentBody: boolean;
  approvals: {
    fetchTimeoutMs: number;
    maxPages: number;
  };
}

export interface ApprovalRetryPolicy {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  retryableStatusCodes: number[];
}

export interface ProviderReviewTarget {
  source: "pr_body" | "review" | "comment";
  referenceId: string;
  authorLogin: string;
  authorType: "User" | "Bot" | "Unknown";
  body: string;
}

export interface PullContext {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface ProviderTargetExtractionResult {
  targets: ProviderReviewTarget[];
  malformedReasons: string[];
}

export interface ProviderApprovalOptions {
  authToken?: string;
  githubToken: string;
  allowedAuthors: Set<string>;
  fetchTimeoutMs: number;
  maxPages: number;
  retry: ApprovalRetryPolicy;
}

export interface SentinelRepositoryRef {
  owner: string;
  repo: string;
}

export interface SentinelResolvePullRequestOptions {
  authToken: string;
}

export interface SentinelUnresolvedComment {
  file: string;
  line: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  resolved: boolean;
  outdated: boolean;
}

export interface SentinelFailureStep {
  name: string;
  conclusion: string;
  number: number;
}

export interface SentinelFailureJob {
  jobId: number;
  name: string;
  conclusion: string;
  htmlUrl: string;
  failedStepName: string | null;
  steps: SentinelFailureStep[];
}

export interface SentinelFailureRun {
  runId: number;
  workflowName: string;
  workflowPath: string | null;
  runNumber: number;
  runAttempt: number;
  headSha: string;
  conclusion: string;
  htmlUrl: string;
  jobs: SentinelFailureJob[];
}

export interface SentinelListFailureRunsRequest {
  prNumber?: number;
  runId?: number;
  maxRuns: number;
}

export interface SentinelGetJobLogsRequest {
  repo: SentinelRepositoryRef;
  jobId: number;
  authToken: string;
  maxLogBytes: number;
}

export interface SentinelProviderAdapter {
  resolveOpenPullRequestForBranch: (
    repo: SentinelRepositoryRef,
    branch: string,
    options: SentinelResolvePullRequestOptions
  ) => Promise<number | null>;
  listUnresolvedComments: (
    repo: SentinelRepositoryRef,
    prNumber: number,
    options: SentinelResolvePullRequestOptions
  ) => Promise<SentinelUnresolvedComment[]>;
  listFailureRuns: (
    repo: SentinelRepositoryRef,
    request: SentinelListFailureRunsRequest,
    options: SentinelResolvePullRequestOptions
  ) => Promise<SentinelFailureRun[]>;
  getJobLogs: (request: SentinelGetJobLogsRequest) => Promise<string>;
}

export type ProviderApprovalErrorKind =
  | "rate_limited"
  | "timeout"
  | "retry_exhausted"
  | "fetch_error"
  | "http_error";

export class ProviderApprovalError extends Error {
  readonly kind: ProviderApprovalErrorKind;
  readonly details: Record<string, unknown>;

  constructor(kind: ProviderApprovalErrorKind, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ProviderApprovalError";
    this.kind = kind;
    this.details = details;
  }
}

export interface ProviderAdapter {
  name: string;
  approvalTokenEnvVar?: string;
  supportedEvents: ReadonlySet<string>;
  sentinel?: SentinelProviderAdapter;
  extractTargets: (
    eventName: string,
    payload: unknown,
    policy: ProviderPolicyContext
  ) => ProviderTargetExtractionResult;
  extractPullContext: (eventName: string, payload: unknown) => PullContext | null;
  fetchHumanApprovalCount: (context: PullContext, options: ProviderApprovalOptions) => Promise<number>;
}
