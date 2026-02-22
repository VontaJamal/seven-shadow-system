import { strFromU8, unzipSync } from "fflate";

import type {
  SentinelFailureJob,
  SentinelFailureRun,
  SentinelFailureStep,
  SentinelGetJobLogsRequest,
  SentinelListFailureRunsRequest,
  SentinelListNotificationsRequest,
  SentinelListOpenPullRequestsRequest,
  SentinelListPullRequestFilesRequest,
  SentinelNotification,
  SentinelPullRequestFile,
  SentinelPullRequestSummary,
  SentinelProviderAdapter,
  SentinelRepositoryRef,
  SentinelResolvePullRequestOptions,
  SentinelUnresolvedComment
} from "./types";

interface GitHubGraphqlError {
  message?: unknown;
}

interface GraphqlReviewThreadCommentNode {
  author?: {
    login?: unknown;
  };
  bodyText?: unknown;
  createdAt?: unknown;
  url?: unknown;
}

interface GraphqlReviewThreadNode {
  isResolved?: unknown;
  isOutdated?: unknown;
  path?: unknown;
  line?: unknown;
  startLine?: unknown;
  comments?: {
    nodes?: GraphqlReviewThreadCommentNode[];
  };
}

interface GraphqlReviewThreadPage {
  pageInfo?: {
    hasNextPage?: unknown;
    endCursor?: unknown;
  };
  nodes?: GraphqlReviewThreadNode[];
}

interface GraphqlPullRequest {
  reviewThreads?: GraphqlReviewThreadPage;
}

interface GraphqlRepository {
  pullRequest?: GraphqlPullRequest | null;
}

interface GraphqlReviewThreadsResponse {
  repository?: GraphqlRepository | null;
}

interface GitHubPullSummary {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  draft?: unknown;
  user?: {
    login?: unknown;
  };
  additions?: unknown;
  deletions?: unknown;
  changed_files?: unknown;
  comments?: unknown;
  review_comments?: unknown;
  commits?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  html_url?: unknown;
  head?: {
    ref?: unknown;
    sha?: unknown;
  };
}

interface GitHubPullRequestFileSummary {
  filename?: unknown;
  status?: unknown;
  additions?: unknown;
  deletions?: unknown;
  changes?: unknown;
}

interface GitHubNotificationSubject {
  title?: unknown;
  type?: unknown;
  url?: unknown;
}

interface GitHubNotificationRepository {
  full_name?: unknown;
}

interface GitHubNotificationSummary {
  id?: unknown;
  reason?: unknown;
  unread?: unknown;
  updated_at?: unknown;
  subject?: GitHubNotificationSubject;
  repository?: GitHubNotificationRepository;
  url?: unknown;
}

interface GitHubWorkflowRunSummary {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  run_number?: unknown;
  run_attempt?: unknown;
  head_sha?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs?: GitHubWorkflowRunSummary[];
}

interface GitHubJobStep {
  name?: unknown;
  conclusion?: unknown;
  number?: unknown;
}

interface GitHubJobSummary {
  id?: unknown;
  name?: unknown;
  conclusion?: unknown;
  html_url?: unknown;
  steps?: GitHubJobStep[];
}

interface GitHubJobsResponse {
  jobs?: GitHubJobSummary[];
}

const FAILURE_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "stale"
]);

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value !== "boolean") {
    return null;
  }

  return value;
}

function asIsoTimestamp(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) {
    return null;
  }

  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function parseRepoFullName(fullName: string): SentinelRepositoryRef | null {
  const trimmed = fullName.trim();
  const segments = trimmed.split("/").filter((item) => item.length > 0);
  if (segments.length < 2) {
    return null;
  }

  const owner = segments.slice(0, segments.length - 1).join("/");
  const repo = segments[segments.length - 1] ?? "";
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo
  };
}

function parsePullNumberFromApiUrl(url: string | null): number | null {
  if (!url) {
    return null;
  }

  const match = url.match(/\/pulls\/(\d+)(?:\/|$)/);
  if (!match?.[1]) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function ensureFailureConclusion(value: unknown): string {
  const conclusion = asNonEmptyString(value)?.toLowerCase();
  return conclusion ?? "unknown";
}

function isFailingConclusion(value: unknown): boolean {
  return FAILURE_CONCLUSIONS.has(ensureFailureConclusion(value));
}

function headersForGitHub(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function throwApiError(status: number, url: string, body: string): never {
  const snippet = body.trim().replace(/\s+/g, " ").slice(0, 220);
  throw new Error(`E_SENTINEL_API_ERROR: status=${status} url=${url} body=${snippet}`);
}

async function githubRestJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: headersForGitHub(token)
  });

  if (!response.ok) {
    throwApiError(response.status, url, await response.text());
  }

  return (await response.json()) as T;
}

async function githubRestBinary(url: string, token: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: headersForGitHub(token),
    redirect: "follow"
  });

  if (!response.ok) {
    throwApiError(response.status, url, await response.text());
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

async function githubGraphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const url = "https://api.github.com/graphql";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headersForGitHub(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throwApiError(response.status, url, await response.text());
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: GitHubGraphqlError[];
  };

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const message = payload.errors
      .map((item) => asNonEmptyString(item.message) ?? "unknown GraphQL error")
      .join("; ")
      .slice(0, 220);
    throw new Error(`E_SENTINEL_API_ERROR: graphql=${message}`);
  }

  if (!payload.data) {
    throw new Error("E_SENTINEL_API_ERROR: missing GraphQL data payload");
  }

  return payload.data;
}

function toFailureStep(step: GitHubJobStep): SentinelFailureStep | null {
  const name = asNonEmptyString(step.name);
  const number = asPositiveInt(step.number);
  if (!name || !number) {
    return null;
  }

  return {
    name,
    number,
    conclusion: ensureFailureConclusion(step.conclusion)
  };
}

async function fetchJobsForRun(repo: SentinelRepositoryRef, runId: number, token: string): Promise<SentinelFailureJob[]> {
  const jobsUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs/${runId}/jobs?per_page=100`;
  const response = await githubRestJson<GitHubJobsResponse>(jobsUrl, token);

  const jobs = Array.isArray(response.jobs) ? response.jobs : [];
  const failingJobs: SentinelFailureJob[] = [];

  for (const job of jobs) {
    if (!isFailingConclusion(job.conclusion)) {
      continue;
    }

    const jobId = asPositiveInt(job.id);
    const name = asNonEmptyString(job.name);
    const htmlUrl = asNonEmptyString(job.html_url);
    if (!jobId || !name || !htmlUrl) {
      continue;
    }

    const steps = Array.isArray(job.steps) ? job.steps.map(toFailureStep).filter((item): item is SentinelFailureStep => item !== null) : [];
    const failedStep = steps.find((item) => isFailingConclusion(item.conclusion));

    failingJobs.push({
      jobId,
      name,
      conclusion: ensureFailureConclusion(job.conclusion),
      htmlUrl,
      failedStepName: failedStep?.name ?? null,
      steps
    });
  }

  return failingJobs;
}

async function listFailingRunsFromSha(
  repo: SentinelRepositoryRef,
  headSha: string,
  maxRuns: number,
  token: string
): Promise<SentinelFailureRun[]> {
  const runsUrl = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs`);
  runsUrl.searchParams.set("head_sha", headSha);
  runsUrl.searchParams.set("per_page", "100");

  const runsResponse = await githubRestJson<GitHubWorkflowRunsResponse>(runsUrl.toString(), token);
  const rawRuns = Array.isArray(runsResponse.workflow_runs) ? runsResponse.workflow_runs : [];

  const failingRuns = rawRuns.filter((run) => isFailingConclusion(run.conclusion)).slice(0, maxRuns);
  const results: SentinelFailureRun[] = [];

  for (const run of failingRuns) {
    const runId = asPositiveInt(run.id);
    const workflowName = asNonEmptyString(run.name);
    const runNumber = asPositiveInt(run.run_number);
    const runAttempt = asPositiveInt(run.run_attempt);
    const runHeadSha = asNonEmptyString(run.head_sha);
    const htmlUrl = asNonEmptyString(run.html_url);

    if (!runId || !workflowName || !runNumber || !runAttempt || !runHeadSha || !htmlUrl) {
      continue;
    }

    const jobs = await fetchJobsForRun(repo, runId, token);
    if (jobs.length === 0) {
      continue;
    }

    results.push({
      runId,
      workflowName,
      workflowPath: asNonEmptyString(run.path),
      runNumber,
      runAttempt,
      headSha: runHeadSha,
      conclusion: ensureFailureConclusion(run.conclusion),
      htmlUrl,
      jobs
    });
  }

  return results;
}

async function fetchPullHeadSha(repo: SentinelRepositoryRef, prNumber: number, token: string): Promise<string> {
  const pullUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`;
  const pull = await githubRestJson<GitHubPullSummary>(pullUrl, token);
  const headSha = asNonEmptyString(pull.head?.sha);

  if (!headSha) {
    throw new Error(`E_SENTINEL_API_ERROR: missing pull head SHA for PR ${prNumber}`);
  }

  return headSha;
}

function toPullRequestSummary(raw: GitHubPullSummary): SentinelPullRequestSummary | null {
  const number = asPositiveInt(raw.number);
  const title = asNonEmptyString(raw.title);
  const state = asNonEmptyString(raw.state);
  const draft = asBoolean(raw.draft);
  const author = asNonEmptyString(raw.user?.login) ?? "unknown";
  const createdAt = asIsoTimestamp(raw.created_at);
  const updatedAt = asIsoTimestamp(raw.updated_at);
  const htmlUrl = asNonEmptyString(raw.html_url);
  const headSha = asNonEmptyString(raw.head?.sha);

  const additions = asNonNegativeInt(raw.additions);
  const deletions = asNonNegativeInt(raw.deletions);
  const changedFiles = asNonNegativeInt(raw.changed_files);
  const comments = asNonNegativeInt(raw.comments);
  const reviewComments = asNonNegativeInt(raw.review_comments);
  const commits = asNonNegativeInt(raw.commits);

  if (
    !number ||
    !title ||
    !state ||
    draft === null ||
    additions === null ||
    deletions === null ||
    changedFiles === null ||
    comments === null ||
    reviewComments === null ||
    commits === null ||
    !createdAt ||
    !updatedAt ||
    !htmlUrl ||
    !headSha
  ) {
    return null;
  }

  return {
    number,
    title,
    state,
    draft,
    author,
    additions,
    deletions,
    changedFiles,
    comments,
    reviewComments,
    commits,
    createdAt,
    updatedAt,
    htmlUrl,
    headSha
  };
}

function decodeLogArchive(buffer: Uint8Array): string {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const archive = unzipSync(buffer);
    const names = Object.keys(archive)
      .filter((name) => !name.endsWith("/"))
      .sort((a, b) => a.localeCompare(b));

    const sections: string[] = [];
    for (const name of names) {
      sections.push(`# ${name}`);
      sections.push(strFromU8(archive[name], true));
      sections.push("");
    }

    return sections.join("\n").trimEnd();
  }

  return strFromU8(buffer, true);
}

const REVIEW_THREAD_QUERY = `
query SentinelReviewThreads($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 50, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          isResolved
          isOutdated
          path
          line
          startLine
          comments(last: 1) {
            nodes {
              author {
                login
              }
              bodyText
              createdAt
              url
            }
          }
        }
      }
    }
  }
}
`;

async function listUnresolvedComments(
  repo: SentinelRepositoryRef,
  prNumber: number,
  options: SentinelResolvePullRequestOptions
): Promise<SentinelUnresolvedComment[]> {
  let cursor: string | null = null;
  const comments: SentinelUnresolvedComment[] = [];

  while (true) {
    const data = await githubGraphql<GraphqlReviewThreadsResponse>(
      REVIEW_THREAD_QUERY,
      {
        owner: repo.owner,
        repo: repo.repo,
        pr: prNumber,
        cursor
      },
      options.authToken
    );

    const page = data.repository?.pullRequest?.reviewThreads;
    const nodes = Array.isArray(page?.nodes) ? page.nodes : [];

    for (const thread of nodes) {
      if (thread.isResolved === true || thread.isOutdated === true) {
        continue;
      }

      const file = asNonEmptyString(thread.path);
      const line = asPositiveInt(thread.line) ?? asPositiveInt(thread.startLine) ?? 1;
      const latestComment = Array.isArray(thread.comments?.nodes) ? thread.comments?.nodes[0] : null;
      const author = asNonEmptyString(latestComment?.author?.login) ?? "unknown";
      const body = asNonEmptyString(latestComment?.bodyText) ?? "";
      const createdAt = asNonEmptyString(latestComment?.createdAt) ?? new Date(0).toISOString();
      const url = asNonEmptyString(latestComment?.url) ?? "";

      if (!file || !url) {
        continue;
      }

      comments.push({
        file,
        line,
        author,
        body,
        createdAt,
        url,
        resolved: false,
        outdated: false
      });
    }

    const hasNextPage = page?.pageInfo?.hasNextPage === true;
    const endCursor = asNonEmptyString(page?.pageInfo?.endCursor);
    if (!hasNextPage || !endCursor) {
      break;
    }

    cursor = endCursor;
  }

  return comments;
}

async function resolveOpenPullRequestForBranch(
  repo: SentinelRepositoryRef,
  branch: string,
  options: SentinelResolvePullRequestOptions
): Promise<number | null> {
  const directUrl = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`);
  directUrl.searchParams.set("state", "open");
  directUrl.searchParams.set("head", `${repo.owner}:${branch}`);
  directUrl.searchParams.set("per_page", "10");

  const direct = await githubRestJson<GitHubPullSummary[]>(directUrl.toString(), options.authToken);
  const directNumber = Array.isArray(direct) ? asPositiveInt(direct[0]?.number) : null;
  if (directNumber) {
    return directNumber;
  }

  const fallbackUrl = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`);
  fallbackUrl.searchParams.set("state", "open");
  fallbackUrl.searchParams.set("per_page", "100");
  const pulls = await githubRestJson<GitHubPullSummary[]>(fallbackUrl.toString(), options.authToken);

  for (const pull of pulls) {
    const ref = asNonEmptyString(pull.head?.ref);
    const number = asPositiveInt(pull.number);
    if (ref === branch && number) {
      return number;
    }
  }

  return null;
}

async function listFailureRuns(
  repo: SentinelRepositoryRef,
  request: SentinelListFailureRunsRequest,
  options: SentinelResolvePullRequestOptions
): Promise<SentinelFailureRun[]> {
  if (request.runId) {
    const runUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs/${request.runId}`;
    const run = await githubRestJson<GitHubWorkflowRunSummary>(runUrl, options.authToken);

    const runId = asPositiveInt(run.id);
    const workflowName = asNonEmptyString(run.name);
    const runNumber = asPositiveInt(run.run_number);
    const runAttempt = asPositiveInt(run.run_attempt);
    const headSha = asNonEmptyString(run.head_sha);
    const htmlUrl = asNonEmptyString(run.html_url);

    if (!runId || !workflowName || !runNumber || !runAttempt || !headSha || !htmlUrl) {
      return [];
    }

    const jobs = await fetchJobsForRun(repo, runId, options.authToken);
    if (jobs.length === 0) {
      return [];
    }

    return [
      {
        runId,
        workflowName,
        workflowPath: asNonEmptyString(run.path),
        runNumber,
        runAttempt,
        headSha,
        conclusion: ensureFailureConclusion(run.conclusion),
        htmlUrl,
        jobs
      }
    ];
  }

  if (request.prNumber) {
    const headSha = await fetchPullHeadSha(repo, request.prNumber, options.authToken);
    return listFailingRunsFromSha(repo, headSha, request.maxRuns, options.authToken);
  }

  const runsUrl = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/actions/runs`);
  runsUrl.searchParams.set("per_page", "100");

  const runsResponse = await githubRestJson<GitHubWorkflowRunsResponse>(runsUrl.toString(), options.authToken);
  const rawRuns = Array.isArray(runsResponse.workflow_runs) ? runsResponse.workflow_runs : [];

  const runs: SentinelFailureRun[] = [];
  for (const run of rawRuns) {
    if (!isFailingConclusion(run.conclusion)) {
      continue;
    }

    const runId = asPositiveInt(run.id);
    const workflowName = asNonEmptyString(run.name);
    const runNumber = asPositiveInt(run.run_number);
    const runAttempt = asPositiveInt(run.run_attempt);
    const headSha = asNonEmptyString(run.head_sha);
    const htmlUrl = asNonEmptyString(run.html_url);

    if (!runId || !workflowName || !runNumber || !runAttempt || !headSha || !htmlUrl) {
      continue;
    }

    const jobs = await fetchJobsForRun(repo, runId, options.authToken);
    if (jobs.length === 0) {
      continue;
    }

    runs.push({
      runId,
      workflowName,
      workflowPath: asNonEmptyString(run.path),
      runNumber,
      runAttempt,
      headSha,
      conclusion: ensureFailureConclusion(run.conclusion),
      htmlUrl,
      jobs
    });

    if (runs.length >= request.maxRuns) {
      break;
    }
  }

  return runs;
}

async function listNotifications(
  request: SentinelListNotificationsRequest,
  options: SentinelResolvePullRequestOptions
): Promise<SentinelNotification[]> {
  const maxItems = Math.max(1, request.maxItems);
  const perPage = 50;
  const maxPages = Math.max(1, Math.ceil(maxItems / perPage));
  const notifications: SentinelNotification[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("https://api.github.com/notifications");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("all", request.includeRead ? "true" : "false");
    url.searchParams.set("participating", "false");

    const response = await fetch(url.toString(), {
      headers: headersForGitHub(options.authToken)
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `E_SENTINEL_NOTIFICATIONS_SCOPE_REQUIRED: status=${response.status} ensure token grants notifications read access`
        );
      }
      throwApiError(response.status, url.toString(), body);
    }

    const payload = (await response.json()) as GitHubNotificationSummary[];
    const batch = Array.isArray(payload) ? payload : [];
    if (batch.length === 0) {
      break;
    }

    for (const item of batch) {
      const repoFullName = asNonEmptyString(item.repository?.full_name);
      if (!repoFullName) {
        continue;
      }

      const repository = parseRepoFullName(repoFullName);
      if (!repository) {
        continue;
      }

      if (request.repo && (repository.owner !== request.repo.owner || repository.repo !== request.repo.repo)) {
        continue;
      }

      const id = asNonEmptyString(item.id);
      const reason = asNonEmptyString(item.reason) ?? "unknown";
      const unread = asBoolean(item.unread) ?? false;
      const updatedAt = asIsoTimestamp(item.updated_at) ?? new Date(0).toISOString();
      const subjectType = asNonEmptyString(item.subject?.type) ?? "unknown";
      const title = asNonEmptyString(item.subject?.title) ?? "(untitled)";
      const apiUrl = asNonEmptyString(item.subject?.url);
      const pullNumber = parsePullNumberFromApiUrl(apiUrl);

      if (!id) {
        continue;
      }

      notifications.push({
        id,
        reason,
        unread,
        updatedAt,
        repository,
        subjectType,
        title,
        pullNumber,
        apiUrl,
        webUrl: null
      });

      if (notifications.length >= maxItems) {
        break;
      }
    }

    if (notifications.length >= maxItems) {
      break;
    }
  }

  notifications.sort((left, right) => {
    const updatedCompare = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedCompare !== 0) {
      return updatedCompare;
    }

    const repoCompare = `${left.repository.owner}/${left.repository.repo}`.localeCompare(
      `${right.repository.owner}/${right.repository.repo}`
    );
    if (repoCompare !== 0) {
      return repoCompare;
    }

    return left.id.localeCompare(right.id);
  });

  return notifications;
}

async function listOpenPullRequests(
  repo: SentinelRepositoryRef,
  request: SentinelListOpenPullRequestsRequest,
  options: SentinelResolvePullRequestOptions
): Promise<SentinelPullRequestSummary[]> {
  const maxPullRequests = Math.max(1, request.maxPullRequests);
  const perPage = 100;
  const maxPages = Math.max(1, Math.ceil(maxPullRequests / perPage));
  const results: SentinelPullRequestSummary[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls`);
    url.searchParams.set("state", "open");
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const payload = await githubRestJson<GitHubPullSummary[]>(url.toString(), options.authToken);
    const pulls = Array.isArray(payload) ? payload : [];
    if (pulls.length === 0) {
      break;
    }

    for (const pull of pulls) {
      const normalized = toPullRequestSummary(pull);
      if (!normalized) {
        continue;
      }

      results.push(normalized);
      if (results.length >= maxPullRequests) {
        break;
      }
    }

    if (results.length >= maxPullRequests) {
      break;
    }
  }

  return results;
}

async function getPullRequestSummary(
  repo: SentinelRepositoryRef,
  prNumber: number,
  options: SentinelResolvePullRequestOptions
): Promise<SentinelPullRequestSummary> {
  const pullUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}`;
  const pull = await githubRestJson<GitHubPullSummary>(pullUrl, options.authToken);
  const normalized = toPullRequestSummary(pull);
  if (!normalized) {
    throw new Error(`E_SENTINEL_API_ERROR: missing pull request summary fields for PR ${prNumber}`);
  }

  return normalized;
}

async function listPullRequestFiles(
  repo: SentinelRepositoryRef,
  prNumber: number,
  request: SentinelListPullRequestFilesRequest,
  options: SentinelResolvePullRequestOptions
): Promise<SentinelPullRequestFile[]> {
  const maxFiles = Math.max(1, request.maxFiles);
  const perPage = 100;
  const maxPages = Math.max(1, Math.ceil(maxFiles / perPage));
  const files: SentinelPullRequestFile[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/files`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const payload = await githubRestJson<GitHubPullRequestFileSummary[]>(url.toString(), options.authToken);
    const batch = Array.isArray(payload) ? payload : [];
    if (batch.length === 0) {
      break;
    }

    for (const item of batch) {
      const pathValue = asNonEmptyString(item.filename);
      if (!pathValue) {
        continue;
      }

      const additions = asNonNegativeInt(item.additions);
      const deletions = asNonNegativeInt(item.deletions);
      const changes = asNonNegativeInt(item.changes);
      if (additions === null || deletions === null || changes === null) {
        continue;
      }

      files.push({
        path: pathValue,
        status: asNonEmptyString(item.status) ?? "unknown",
        additions,
        deletions,
        changes
      });

      if (files.length >= maxFiles) {
        break;
      }
    }

    if (files.length >= maxFiles) {
      break;
    }
  }

  files.sort((left, right) => {
    const pathCompare = left.path.localeCompare(right.path);
    if (pathCompare !== 0) {
      return pathCompare;
    }

    return left.status.localeCompare(right.status);
  });

  return files;
}

async function getJobLogs(request: SentinelGetJobLogsRequest): Promise<string> {
  const url = `https://api.github.com/repos/${request.repo.owner}/${request.repo.repo}/actions/jobs/${request.jobId}/logs`;
  const bytes = await githubRestBinary(url, request.authToken);

  if (bytes.byteLength > request.maxLogBytes) {
    throw new Error(
      `E_SENTINEL_LOG_TOO_LARGE: job=${request.jobId} bytes=${bytes.byteLength} maxLogBytes=${request.maxLogBytes}`
    );
  }

  try {
    return decodeLogArchive(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_SENTINEL_LOG_DECODE_FAILED: job=${request.jobId} error=${message.slice(0, 220)}`);
  }
}

export const githubSentinelAdapter: SentinelProviderAdapter = {
  resolveOpenPullRequestForBranch,
  listUnresolvedComments,
  listFailureRuns,
  listNotifications,
  listOpenPullRequests,
  getPullRequestSummary,
  listPullRequestFiles,
  getJobLogs
};
