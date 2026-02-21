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

interface GitLabApprovalUser {
  username?: string;
  bot?: boolean;
}

interface GitLabApprovalEntry {
  user?: GitLabApprovalUser;
}

interface ApprovalAttemptLog {
  attempt: number;
  category: "timeout" | "status";
  status?: number;
  delayMs?: number;
  retryAfterMs?: number;
}

const GITLAB_SUPPORTED_EVENTS = new Set(["Merge Request Hook", "Note Hook"]);
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

function parseProjectPath(payload: Record<string, unknown>): { owner: string; repo: string } | null {
  const project = asObject(payload.project);
  if (!project || typeof project.path_with_namespace !== "string") {
    return null;
  }

  const projectPath = project.path_with_namespace.trim();
  const index = projectPath.lastIndexOf("/");
  if (index <= 0 || index >= projectPath.length - 1) {
    return null;
  }

  return {
    owner: projectPath.slice(0, index),
    repo: projectPath.slice(index + 1)
  };
}

function getActorInfo(user: unknown): { login: string; type: "User" | "Bot" | "Unknown" } {
  if (!user || typeof user !== "object") {
    return { login: "unknown", type: "Unknown" };
  }

  const record = user as Record<string, unknown>;
  const username = typeof record.username === "string" ? record.username : "unknown";
  const isBot = record.bot === true || username.toLowerCase().endsWith("[bot]");

  return {
    login: username,
    type: isBot ? "Bot" : "User"
  };
}

function parseMergeRequestIid(payload: Record<string, unknown>): number | null {
  const attrs = asObject(payload.object_attributes);
  if (attrs && typeof attrs.iid === "number" && Number.isInteger(attrs.iid) && attrs.iid > 0) {
    return attrs.iid;
  }

  return null;
}

function parseNoteMergeRequestIid(payload: Record<string, unknown>): number | null {
  const attrs = asObject(payload.object_attributes);
  if (!attrs) {
    return null;
  }

  if (typeof attrs.noteable_iid === "number" && Number.isInteger(attrs.noteable_iid) && attrs.noteable_iid > 0) {
    return attrs.noteable_iid;
  }

  const mergeRequest = asObject(payload.merge_request);
  if (mergeRequest && typeof mergeRequest.iid === "number" && Number.isInteger(mergeRequest.iid) && mergeRequest.iid > 0) {
    return mergeRequest.iid;
  }

  return null;
}

function validateEventShape(eventName: string, payload: Record<string, unknown>): string[] {
  const reasons: string[] = [];

  if (!parseProjectPath(payload)) {
    reasons.push("missing project.path_with_namespace");
  }

  const attrs = asObject(payload.object_attributes);
  if (!attrs) {
    reasons.push("missing object_attributes object");
    return reasons;
  }

  if (eventName === "Merge Request Hook") {
    if (payload.object_kind !== "merge_request") {
      reasons.push("object_kind must be merge_request");
    }

    if (parseMergeRequestIid(payload) === null) {
      reasons.push("missing object_attributes.iid");
    }

    return reasons;
  }

  if (eventName === "Note Hook") {
    if (payload.object_kind !== "note") {
      reasons.push("object_kind must be note");
    }

    if (attrs.noteable_type !== "MergeRequest") {
      reasons.push("note is not attached to a merge request");
    }

    if (typeof attrs.note !== "string") {
      reasons.push("missing object_attributes.note");
    }

    if (parseNoteMergeRequestIid(payload) === null) {
      reasons.push("missing merge request iid");
    }

    return reasons;
  }

  reasons.push(`unsupported event '${eventName}'`);
  return reasons;
}

function extractTargets(
  eventName: string,
  payload: Record<string, unknown>,
  policy: ProviderPolicyContext
): ProviderReviewTarget[] {
  const targets: ProviderReviewTarget[] = [];
  const attrs = asObject(payload.object_attributes);

  if (eventName === "Merge Request Hook" && policy.scanPrBody && attrs && typeof attrs.description === "string") {
    const body = attrs.description.trim();
    if (body.length > 0) {
      const actor = getActorInfo(payload.user);
      const iid = parseMergeRequestIid(payload);
      targets.push({
        source: "pr_body",
        referenceId: `mr:${iid ?? "unknown"}`,
        authorLogin: actor.login,
        authorType: actor.type,
        body
      });
    }
  }

  if (eventName === "Note Hook" && policy.scanCommentBody && attrs && typeof attrs.note === "string") {
    const body = attrs.note.trim();
    if (body.length > 0) {
      const actor = getActorInfo(payload.user);
      targets.push({
        source: "comment",
        referenceId: `note:${String(attrs.id ?? "unknown")}`,
        authorLogin: actor.login,
        authorType: actor.type,
        body
      });
    }
  }

  return targets;
}

function extractPullContext(eventName: string, payload: Record<string, unknown>): PullContext | null {
  const project = parseProjectPath(payload);
  if (!project) {
    return null;
  }

  if (eventName === "Merge Request Hook") {
    const iid = parseMergeRequestIid(payload);
    if (iid === null) {
      return null;
    }

    return {
      owner: project.owner,
      repo: project.repo,
      pullNumber: iid
    };
  }

  if (eventName === "Note Hook") {
    const attrs = asObject(payload.object_attributes);
    if (!attrs || attrs.noteable_type !== "MergeRequest") {
      return null;
    }

    const iid = parseNoteMergeRequestIid(payload);
    if (iid === null) {
      return null;
    }

    return {
      owner: project.owner,
      repo: project.repo,
      pullNumber: iid
    };
  }

  return null;
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

function parseApprovalEntries(payload: unknown): { entries: GitLabApprovalEntry[]; paginated: boolean } {
  if (Array.isArray(payload)) {
    return {
      entries: payload.filter((item): item is GitLabApprovalEntry => Boolean(asObject(item))),
      paginated: true
    };
  }

  const record = asObject(payload);
  if (!record || !Array.isArray(record.approved_by)) {
    return {
      entries: [],
      paginated: false
    };
  }

  return {
    entries: record.approved_by.filter((item): item is GitLabApprovalEntry => Boolean(asObject(item))),
    paginated: false
  };
}

function isBotUser(user: GitLabApprovalUser): boolean {
  if (user.bot === true) {
    return true;
  }

  return typeof user.username === "string" && user.username.toLowerCase().endsWith("[bot]");
}

async function fetchHumanApprovalCount(context: PullContext, options: ProviderApprovalOptions): Promise<number> {
  const token = options.authToken ?? options.githubToken;
  if (!token) {
    throw toProviderApprovalError("fetch_error", "GitLab approval fetch token missing", {
      tokenEnvVar: "GITLAB_TOKEN"
    });
  }

  const retryPolicy = normalizeRetryPolicy(options.retry);
  const approvalsByLogin = new Set<string>();

  let page = 1;
  while (page <= options.maxPages) {
    const projectPath = encodeURIComponent(`${context.owner}/${context.repo}`);
    const url = `https://gitlab.com/api/v4/projects/${projectPath}/merge_requests/${context.pullNumber}/approvals?per_page=100&page=${page}`;
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
            Accept: "application/json",
            "PRIVATE-TOKEN": token
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

          throw toProviderApprovalError("timeout", `Timed out while fetching GitLab merge request approvals (attempt ${attempt})`, {
            url,
            page,
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            fetchTimeoutMs: options.fetchTimeoutMs,
            attempts
          });
        }

        throw toProviderApprovalError("fetch_error", "GitLab approval fetch failed", {
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
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
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
                attempts
              }
            );
          }

          throw toProviderApprovalError("rate_limited", "GitLab approval fetch was rate limited", {
            url,
            page,
            attempt,
            maxAttempts: retryPolicy.maxAttempts,
            status: response.status,
            retryAfterMs,
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

        throw toProviderApprovalError("http_error", `GitLab approvals API returned status ${response.status}`, {
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

    const payload = (await response.json()) as unknown;
    const parsed = parseApprovalEntries(payload);
    if (parsed.entries.length === 0) {
      break;
    }

    for (const item of parsed.entries) {
      const user = item.user;
      if (!user || typeof user.username !== "string" || user.username.trim().length === 0) {
        continue;
      }

      const login = normalizeLogin(user.username);
      if (options.allowedAuthors.has(login)) {
        continue;
      }

      if (isBotUser(user)) {
        continue;
      }

      approvalsByLogin.add(login);
    }

    if (!parsed.paginated || parsed.entries.length < 100) {
      break;
    }

    page += 1;
  }

  if (page > options.maxPages) {
    throw toProviderApprovalError("fetch_error", `GitLab approval pagination exceeded max pages ${options.maxPages}`, {
      maxPages: options.maxPages
    });
  }

  return approvalsByLogin.size;
}

export const gitlabProvider: ProviderAdapter = {
  name: "gitlab",
  approvalTokenEnvVar: "GITLAB_TOKEN",
  supportedEvents: GITLAB_SUPPORTED_EVENTS,
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
