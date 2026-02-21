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

interface BitbucketUser {
  nickname?: string;
  username?: string;
  display_name?: string;
  account_id?: string;
  type?: string;
}

interface BitbucketParticipant {
  approved?: boolean;
  user?: BitbucketUser;
}

interface ApprovalAttemptLog {
  attempt: number;
  category: "timeout" | "status";
  status?: number;
  delayMs?: number;
  retryAfterMs?: number;
}

const BITBUCKET_SUPPORTED_EVENTS = new Set([
  "pullrequest:created",
  "pullrequest:updated",
  "pullrequest:comment_created",
  "pullrequest:comment_updated"
]);
const MAX_ERROR_SNIPPET = 180;

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseRepoFullName(payload: Record<string, unknown>): { owner: string; repo: string } | null {
  const repository = asObject(payload.repository);
  if (!repository || typeof repository.full_name !== "string") {
    return null;
  }

  const fullName = repository.full_name.trim();
  const index = fullName.indexOf("/");
  if (index <= 0 || index >= fullName.length - 1) {
    return null;
  }

  return {
    owner: fullName.slice(0, index),
    repo: fullName.slice(index + 1)
  };
}

function parsePullRequestId(payload: Record<string, unknown>): number | null {
  const pullRequest = asObject(payload.pullrequest);
  if (!pullRequest || typeof pullRequest.id !== "number" || !Number.isInteger(pullRequest.id) || pullRequest.id <= 0) {
    return null;
  }

  return pullRequest.id;
}

function isCommentEvent(eventName: string): boolean {
  return eventName === "pullrequest:comment_created" || eventName === "pullrequest:comment_updated";
}

function getUserLogin(user: unknown): string {
  const record = asObject(user);
  if (!record) {
    return "unknown";
  }

  const candidates = [record.nickname, record.username, record.display_name, record.account_id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return "unknown";
}

function isBotUser(user: unknown): boolean {
  const record = asObject(user);
  if (!record) {
    return false;
  }

  const login = getUserLogin(record).toLowerCase();
  const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
  return login.endsWith("[bot]") || type.includes("app") || type.includes("bot");
}

function getActorInfo(payload: Record<string, unknown>, user: unknown): { login: string; type: "User" | "Bot" | "Unknown" } {
  const resolvedUser = asObject(user) ?? asObject(payload.actor);
  if (!resolvedUser) {
    return {
      login: "unknown",
      type: "Unknown"
    };
  }

  const login = getUserLogin(resolvedUser);
  if (isBotUser(resolvedUser)) {
    return {
      login,
      type: "Bot"
    };
  }

  return {
    login,
    type: "User"
  };
}

function getCommentBody(payload: Record<string, unknown>): string | null {
  const comment = asObject(payload.comment);
  if (!comment) {
    return null;
  }

  const content = asObject(comment.content);
  if (!content || typeof content.raw !== "string") {
    return null;
  }

  return content.raw;
}

function validateEventShape(eventName: string, payload: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  if (!BITBUCKET_SUPPORTED_EVENTS.has(eventName)) {
    return [`unsupported event '${eventName}'`];
  }

  if (!parseRepoFullName(payload)) {
    reasons.push("missing repository.full_name");
  }

  const pullRequest = asObject(payload.pullrequest);
  if (!pullRequest) {
    reasons.push("missing pullrequest object");
    return reasons;
  }

  if (parsePullRequestId(payload) === null) {
    reasons.push("missing pullrequest.id");
  }

  if (isCommentEvent(eventName)) {
    const comment = asObject(payload.comment);
    if (!comment) {
      reasons.push("missing comment object");
      return reasons;
    }

    if (getCommentBody(payload) === null) {
      reasons.push("missing comment.content.raw");
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
  const pullRequest = asObject(payload.pullrequest);
  const pullRequestId = parsePullRequestId(payload);

  if (policy.scanPrBody && !isCommentEvent(eventName) && pullRequest && typeof pullRequest.description === "string") {
    const body = pullRequest.description.trim();
    if (body.length > 0) {
      const actor = getActorInfo(payload, asObject(pullRequest.author)?.user);
      targets.push({
        source: "pr_body",
        referenceId: `pr:${pullRequestId ?? "unknown"}`,
        authorLogin: actor.login,
        authorType: actor.type,
        body
      });
    }
  }

  if (policy.scanCommentBody && isCommentEvent(eventName)) {
    const body = getCommentBody(payload)?.trim() ?? "";
    if (body.length > 0) {
      const comment = asObject(payload.comment);
      const actor = getActorInfo(payload, comment?.user);
      targets.push({
        source: "comment",
        referenceId: `comment:${String(comment?.id ?? "unknown")}`,
        authorLogin: actor.login,
        authorType: actor.type,
        body
      });
    }
  }

  return targets;
}

function extractPullContext(payload: Record<string, unknown>): PullContext | null {
  const repo = parseRepoFullName(payload);
  const pullNumber = parsePullRequestId(payload);
  if (!repo || pullNumber === null) {
    return null;
  }

  return {
    owner: repo.owner,
    repo: repo.repo,
    pullNumber
  };
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

function parseRetryAfterMs(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader || retryAfterHeader.trim().length === 0) {
    return null;
  }

  const seconds = Number.parseInt(retryAfterHeader.trim(), 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const asDate = Date.parse(retryAfterHeader);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
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

function countHumanApprovals(participants: BitbucketParticipant[], allowedAuthors: Set<string>): number {
  const approvedLogins = new Set<string>();

  for (const participant of participants) {
    if (participant.approved !== true) {
      continue;
    }

    const login = normalizeLogin(getUserLogin(participant.user));
    if (!login || login === "unknown") {
      continue;
    }

    if (allowedAuthors.has(login)) {
      continue;
    }

    if (isBotUser(participant.user)) {
      continue;
    }

    approvedLogins.add(login);
  }

  return approvedLogins.size;
}

async function fetchHumanApprovalCount(context: PullContext, options: ProviderApprovalOptions): Promise<number> {
  const token = options.authToken ?? options.githubToken;
  if (!token) {
    throw toProviderApprovalError("fetch_error", "Bitbucket approval fetch token missing", {
      tokenEnvVar: "BITBUCKET_TOKEN"
    });
  }

  const retryPolicy = normalizeRetryPolicy(options.retry);
  const owner = encodeURIComponent(context.owner);
  const repo = encodeURIComponent(context.repo);
  const url = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests/${context.pullNumber}`;
  const attempts: ApprovalAttemptLog[] = [];

  for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, options.fetchTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
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

        throw toProviderApprovalError("timeout", `Timed out while fetching Bitbucket pull request approvals (attempt ${attempt})`, {
          url,
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          fetchTimeoutMs: options.fetchTimeoutMs,
          attempts
        });
      }

      throw toProviderApprovalError("fetch_error", "Bitbucket approval fetch failed", {
        url,
        attempt,
        error: message.slice(0, MAX_ERROR_SNIPPET),
        attempts
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const responseText = (await response.text()).slice(0, MAX_ERROR_SNIPPET);
      const isRateLimited = response.status === 429;
      const isRetryableStatus = retryPolicy.retryableStatusCodes.includes(response.status);

      if ((isRateLimited || isRetryableStatus) && retryPolicy.enabled && attempt < retryPolicy.maxAttempts) {
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

      if (isRateLimited && retryPolicy.enabled && retryPolicy.maxAttempts > 1 && attempt >= retryPolicy.maxAttempts) {
        throw toProviderApprovalError("retry_exhausted", "Approval verification retries exhausted after rate limiting", {
          url,
          attempt,
          status: response.status,
          retryAfterMs,
          maxAttempts: retryPolicy.maxAttempts,
          attempts
        });
      }

      if (isRetryableStatus && retryPolicy.enabled && retryPolicy.maxAttempts > 1 && attempt >= retryPolicy.maxAttempts) {
        throw toProviderApprovalError("retry_exhausted", "Approval verification retries exhausted", {
          url,
          attempt,
          status: response.status,
          maxAttempts: retryPolicy.maxAttempts,
          responseText,
          attempts
        });
      }

      if (isRateLimited) {
        throw toProviderApprovalError("rate_limited", "Bitbucket approval fetch was rate limited", {
          url,
          attempt,
          status: response.status,
          retryAfterMs,
          attempts
        });
      }

      throw toProviderApprovalError("http_error", `Bitbucket pull request API returned status ${response.status}`, {
        url,
        attempt,
        status: response.status,
        responseText,
        attempts
      });
    }

    const payload = (await response.json()) as unknown;
    const record = asObject(payload);
    if (!record) {
      throw toProviderApprovalError("fetch_error", "Bitbucket pull request approval payload is not an object", {
        url
      });
    }

    const participants = Array.isArray(record.participants)
      ? record.participants.filter((item): item is BitbucketParticipant => Boolean(asObject(item)))
      : [];
    return countHumanApprovals(participants, options.allowedAuthors);
  }

  throw toProviderApprovalError("retry_exhausted", "Approval verification retries exhausted before response was received", {
    url,
    maxAttempts: retryPolicy.maxAttempts
  });
}

export const bitbucketProvider: ProviderAdapter = {
  name: "bitbucket",
  approvalTokenEnvVar: "BITBUCKET_TOKEN",
  supportedEvents: BITBUCKET_SUPPORTED_EVENTS,
  extractTargets: (eventName: string, payload: unknown, policy: ProviderPolicyContext): ProviderTargetExtractionResult => {
    const obj = asObject(payload);
    if (!obj) {
      return {
        targets: [],
        malformedReasons: ["event payload is not an object"]
      };
    }

    return {
      targets: extractTargets(eventName, obj, policy),
      malformedReasons: validateEventShape(eventName, obj)
    };
  },
  extractPullContext: (_eventName: string, payload: unknown): PullContext | null => {
    const obj = asObject(payload);
    if (!obj) {
      return null;
    }

    return extractPullContext(obj);
  },
  fetchHumanApprovalCount
};
