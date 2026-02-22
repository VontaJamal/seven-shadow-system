import type {
  ApprovalRetryPolicy,
  ProviderAdapter,
  ProviderApprovalOptions,
  ProviderPolicyContext,
  ProviderReviewTarget,
  ProviderTargetExtractionResult,
  PullContext
} from "./types";
import { ProviderApprovalError } from "./types";
import { githubSentinelAdapter } from "./githubSentinel";

interface GitHubReview {
  state?: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface ApprovalAttemptLog {
  attempt: number;
  category: "timeout" | "status";
  status?: number;
  delayMs?: number;
  retryAfterMs?: number;
}

const GITHUB_SUPPORTED_EVENTS = new Set([
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment"
]);
const MAX_ERROR_SNIPPET = 180;

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function getActorInfo(user: unknown): { login: string; type: "User" | "Bot" | "Unknown" } {
  if (!user || typeof user !== "object") {
    return { login: "unknown", type: "Unknown" };
  }

  const login = typeof (user as { login?: unknown }).login === "string"
    ? (user as { login: string }).login
    : "unknown";

  const rawType = typeof (user as { type?: unknown }).type === "string"
    ? (user as { type: string }).type
    : "Unknown";

  if (rawType === "Bot") {
    return { login, type: "Bot" };
  }

  if (rawType === "User") {
    return { login, type: "User" };
  }

  if (login.endsWith("[bot]")) {
    return { login, type: "Bot" };
  }

  return { login, type: "Unknown" };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseRepoFullName(payload: Record<string, unknown>): { owner: string; repo: string } | null {
  const repository = asObject(payload.repository);
  if (!repository || typeof repository.full_name !== "string") {
    return null;
  }

  const [owner, repo] = repository.full_name.split("/");
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function validateEventShape(eventName: string, payload: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  const repository = asObject(payload.repository);
  if (!repository || typeof repository.full_name !== "string") {
    reasons.push("missing repository.full_name");
  }

  if (eventName === "pull_request" || eventName === "pull_request_review" || eventName === "pull_request_review_comment") {
    const pullRequest = asObject(payload.pull_request);
    if (!pullRequest) {
      reasons.push("missing pull_request object");
    }
  }

  if (eventName === "pull_request_review") {
    const review = asObject(payload.review);
    if (!review) {
      reasons.push("missing review object");
    }
  }

  if (eventName === "pull_request_review_comment") {
    const comment = asObject(payload.comment);
    if (!comment) {
      reasons.push("missing comment object");
    }
  }

  if (eventName === "issue_comment") {
    const issue = asObject(payload.issue);
    const comment = asObject(payload.comment);

    if (!issue) {
      reasons.push("missing issue object");
    } else {
      const pullRequest = asObject(issue.pull_request);
      if (!pullRequest) {
        reasons.push("issue_comment is not attached to a pull request");
      }
    }

    if (!comment) {
      reasons.push("missing comment object");
    }
  }

  return reasons;
}

function extractTargets(
  eventName: string,
  payload: Record<string, unknown>,
  policy: ProviderPolicyContext
): ProviderReviewTarget[] {
  const targets: ProviderReviewTarget[] = [];

  const pullRequest = asObject(payload.pull_request);
  if (policy.scanPrBody && pullRequest && typeof pullRequest.body === "string" && pullRequest.body.trim().length > 0) {
    const actor = getActorInfo(pullRequest.user);
    targets.push({
      source: "pr_body",
      referenceId: `pr:${String(pullRequest.number ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: pullRequest.body
    });
  }

  const review = asObject(payload.review);
  if (policy.scanReviewBody && review && typeof review.body === "string" && review.body.trim().length > 0) {
    const actor = getActorInfo(review.user);
    targets.push({
      source: "review",
      referenceId: `review:${String(review.id ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: review.body
    });
  }

  const comment = asObject(payload.comment);
  if (policy.scanCommentBody && comment && typeof comment.body === "string" && comment.body.trim().length > 0) {
    const actor = getActorInfo(comment.user);
    targets.push({
      source: "comment",
      referenceId: `comment:${String(comment.id ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: comment.body
    });
  }

  if (targets.length === 0 && eventName === "pull_request" && pullRequest && typeof pullRequest.body === "string") {
    const actor = getActorInfo(pullRequest.user);
    targets.push({
      source: "pr_body",
      referenceId: `pr:${String(pullRequest.number ?? "unknown")}`,
      authorLogin: actor.login,
      authorType: actor.type,
      body: pullRequest.body
    });
  }

  return targets;
}

function normalizeRetryPolicy(policy: ApprovalRetryPolicy): ApprovalRetryPolicy {
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
  const baseDelayMs = Math.max(1, Math.floor(policy.baseDelayMs));
  const maxDelayMs = Math.max(baseDelayMs, Math.floor(policy.maxDelayMs));
  const jitterRatio = Math.min(1, Math.max(0, policy.jitterRatio));
  const retryableStatusCodes = Array.from(
    new Set(
      policy.retryableStatusCodes
        .filter((status) => Number.isInteger(status) && status >= 100 && status <= 599)
        .map((status) => Math.floor(status))
    )
  );

  return {
    enabled: policy.enabled,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    jitterRatio,
    retryableStatusCodes
  };
}

function parseRetryAfterMs(retryAfterHeader: string | null, rateLimitResetHeader: string | null): number | null {
  if (retryAfterHeader && retryAfterHeader.trim().length > 0) {
    const seconds = Number.parseInt(retryAfterHeader.trim(), 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1_000;
    }

    const asDate = Date.parse(retryAfterHeader);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, asDate - Date.now());
    }
  }

  if (rateLimitResetHeader && rateLimitResetHeader.trim().length > 0) {
    const resetEpochSeconds = Number.parseInt(rateLimitResetHeader.trim(), 10);
    if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds >= 0) {
      const resetMs = resetEpochSeconds * 1_000;
      return Math.max(0, resetMs - Date.now());
    }
  }

  return null;
}

function computeRetryDelayMs(attempt: number, retryPolicy: ApprovalRetryPolicy, retryAfterMs?: number | null): number {
  const exponent = Math.max(0, attempt - 1);
  const exponentialDelay = Math.min(retryPolicy.maxDelayMs, retryPolicy.baseDelayMs * 2 ** exponent);

  const jitterWindow = Math.round(exponentialDelay * retryPolicy.jitterRatio);
  const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
  const withJitter = Math.min(retryPolicy.maxDelayMs, exponentialDelay + jitter);

  if (retryAfterMs === undefined || retryAfterMs === null) {
    return withJitter;
  }

  return Math.min(retryPolicy.maxDelayMs, Math.max(withJitter, Math.max(0, Math.floor(retryAfterMs))));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function pushAttemptLog(log: ApprovalAttemptLog[], item: ApprovalAttemptLog): void {
  log.push(item);
  if (log.length > 20) {
    log.splice(0, log.length - 20);
  }
}

function toProviderApprovalError(
  kind: ProviderApprovalError["kind"],
  message: string,
  details: Record<string, unknown>
): ProviderApprovalError {
  return new ProviderApprovalError(kind, message, details);
}

async function fetchHumanApprovalCount(
  context: PullContext,
  options: ProviderApprovalOptions
): Promise<number> {
  const token = options.authToken ?? options.githubToken;
  const retryPolicy = normalizeRetryPolicy(options.retry);
  const latestStateByLogin = new Map<string, { state: string; type: string }>();

  let page = 1;
  while (page <= options.maxPages) {
    const url = `https://api.github.com/repos/${context.owner}/${context.repo}/pulls/${context.pullNumber}/reviews?per_page=100&page=${page}`;
    const attempts: ApprovalAttemptLog[] = [];
    let response: Response | null = null;

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, options.fetchTimeoutMs);

      try {
        response = await fetch(url, {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28"
          },
          signal: controller.signal
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = error instanceof Error && error.name === "AbortError";

        if (isTimeout) {
          const canRetry = retryPolicy.enabled && attempt < retryPolicy.maxAttempts;
          if (canRetry) {
            const delayMs = computeRetryDelayMs(attempt, retryPolicy);
            pushAttemptLog(attempts, {
              attempt,
              category: "timeout",
              delayMs
            });
            await sleep(delayMs);
            continue;
          }

          throw toProviderApprovalError(
            "timeout",
            `Timed out while fetching GitHub pull request reviews (attempt ${attempt})`,
            {
              url,
              page,
              attempt,
              maxAttempts: retryPolicy.maxAttempts,
              fetchTimeoutMs: options.fetchTimeoutMs,
              attempts
            }
          );
        }

        throw toProviderApprovalError("fetch_error", "GitHub approval fetch failed", {
          url,
          page,
          attempt,
          error: message.slice(0, MAX_ERROR_SNIPPET),
          attempts
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMs(
          response.headers.get("retry-after"),
          response.headers.get("x-ratelimit-reset")
        );
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        const responseText = (await response.text()).slice(0, MAX_ERROR_SNIPPET);
        const isRateLimited = response.status === 429;
        const isRetryableStatus = retryPolicy.retryableStatusCodes.includes(response.status);

        if (isRateLimited) {
          const canRetry = retryPolicy.enabled && attempt < retryPolicy.maxAttempts;
          if (canRetry) {
            const delayMs = computeRetryDelayMs(attempt, retryPolicy, retryAfterMs);
            pushAttemptLog(attempts, {
              attempt,
              category: "status",
              status: response.status,
              delayMs,
              retryAfterMs: retryAfterMs ?? undefined
            });
            await sleep(delayMs);
            continue;
          }

          if (retryPolicy.enabled && retryPolicy.maxAttempts > 1 && attempt >= retryPolicy.maxAttempts) {
            throw toProviderApprovalError(
              "retry_exhausted",
              `Approval verification retries exhausted after rate limiting (${attempt} attempts)`,
              {
                url,
                page,
                attempt,
                maxAttempts: retryPolicy.maxAttempts,
                status: response.status,
                retryAfterMs,
                rateLimitRemaining,
                attempts
              }
            );
          }

          throw toProviderApprovalError("rate_limited", "GitHub approval fetch was rate limited", {
            url,
            page,
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            status: response.status,
            retryAfterMs,
            rateLimitRemaining,
            attempts
          });
        }

        if (isRetryableStatus && retryPolicy.enabled && attempt < retryPolicy.maxAttempts) {
          const delayMs = computeRetryDelayMs(attempt, retryPolicy);
          pushAttemptLog(attempts, {
            attempt,
            category: "status",
            status: response.status,
            delayMs
          });
          await sleep(delayMs);
          continue;
        }

        if (isRetryableStatus && retryPolicy.enabled && retryPolicy.maxAttempts > 1 && attempt >= retryPolicy.maxAttempts) {
          throw toProviderApprovalError("retry_exhausted", "Approval verification retries exhausted", {
            url,
            page,
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            status: response.status,
            responseText,
            attempts
          });
        }

        throw toProviderApprovalError("http_error", `GitHub reviews API returned status ${response.status}`, {
          url,
          page,
          attempt,
          status: response.status,
          responseText,
          attempts
        });
      }

      break;
    }

    if (!response) {
      throw toProviderApprovalError("retry_exhausted", "Approval verification retries exhausted before response was received", {
        url,
        page,
        maxAttempts: retryPolicy.maxAttempts
      });
    }

    const reviews = (await response.json()) as GitHubReview[];
    if (!Array.isArray(reviews) || reviews.length === 0) {
      break;
    }

    for (const review of reviews) {
      const login = typeof review.user?.login === "string" ? normalizeLogin(review.user.login) : "";
      if (!login) {
        continue;
      }

      latestStateByLogin.set(login, {
        state: String(review.state ?? ""),
        type: String(review.user?.type ?? "Unknown")
      });
    }

    if (reviews.length < 100) {
      break;
    }

    page += 1;
  }

  if (page > options.maxPages) {
    throw toProviderApprovalError("fetch_error", `GitHub review pagination exceeded max pages ${options.maxPages}`, {
      maxPages: options.maxPages
    });
  }

  let approvals = 0;
  for (const [login, latest] of latestStateByLogin.entries()) {
    if (options.allowedAuthors.has(login)) {
      continue;
    }

    if (latest.type === "Bot") {
      continue;
    }

    if (latest.state === "APPROVED") {
      approvals += 1;
    }
  }

  return approvals;
}

function extractPullContext(eventName: string, payload: Record<string, unknown>): PullContext | null {
  const repo = parseRepoFullName(payload);
  if (!repo) {
    return null;
  }

  const pullRequest = asObject(payload.pull_request);
  if (pullRequest && typeof pullRequest.number === "number") {
    return {
      owner: repo.owner,
      repo: repo.repo,
      pullNumber: pullRequest.number
    };
  }

  if (eventName === "issue_comment") {
    const issue = asObject(payload.issue);
    const isPrComment = issue && asObject(issue.pull_request);
    if (issue && isPrComment && typeof issue.number === "number") {
      return {
        owner: repo.owner,
        repo: repo.repo,
        pullNumber: issue.number
      };
    }
  }

  return null;
}

export const githubProvider: ProviderAdapter = {
  name: "github",
  approvalTokenEnvVar: "GITHUB_TOKEN",
  sentinel: githubSentinelAdapter,
  supportedEvents: GITHUB_SUPPORTED_EVENTS,
  extractTargets: (eventName: string, payload: unknown, policy: ProviderPolicyContext): ProviderTargetExtractionResult => {
    const obj = asObject(payload);
    if (!obj) {
      return {
        targets: [],
        malformedReasons: ["event payload is not an object"]
      };
    }

    const malformedReasons = validateEventShape(eventName, obj);
    const targets = extractTargets(eventName, obj, policy);

    return {
      targets,
      malformedReasons
    };
  },
  extractPullContext: (eventName: string, payload: unknown): PullContext | null => {
    const obj = asObject(payload);
    if (!obj) {
      return null;
    }

    return extractPullContext(eventName, obj);
  },
  fetchHumanApprovalCount
};
