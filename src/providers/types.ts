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
  githubToken: string;
  allowedAuthors: Set<string>;
  fetchTimeoutMs: number;
  maxPages: number;
  retry: ApprovalRetryPolicy;
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
  supportedEvents: ReadonlySet<string>;
  extractTargets: (
    eventName: string,
    payload: unknown,
    policy: ProviderPolicyContext
  ) => ProviderTargetExtractionResult;
  extractPullContext: (eventName: string, payload: unknown) => PullContext | null;
  fetchHumanApprovalCount: (context: PullContext, options: ProviderApprovalOptions) => Promise<number>;
}
