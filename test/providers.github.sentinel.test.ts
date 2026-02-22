import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { githubSentinelAdapter } from "../src/providers/githubSentinel";

const repo = {
  owner: "acme",
  repo: "platform"
};

test("github sentinel resolves open pull request from branch", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/pulls?")) {
        return new Response(JSON.stringify([{ number: 42 }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const prNumber = await githubSentinelAdapter.resolveOpenPullRequestForBranch(repo, "feature/test", {
      authToken: "token"
    });

    assert.equal(prNumber, 42);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("github sentinel returns unresolved comments with file and line", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/graphql")) {
        return new Response(
          JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: null
                    },
                    nodes: [
                      {
                        isResolved: false,
                        isOutdated: false,
                        path: "src/index.ts",
                        line: 12,
                        comments: {
                          nodes: [
                            {
                              author: { login: "reviewer" },
                              bodyText: "Please handle missing token fallback.",
                              createdAt: "2026-02-21T10:00:00.000Z",
                              url: "https://github.com/acme/platform/pull/1#discussion_r1"
                            }
                          ]
                        }
                      },
                      {
                        isResolved: true,
                        isOutdated: false,
                        path: "src/skip.ts",
                        line: 1,
                        comments: {
                          nodes: [
                            {
                              author: { login: "skip" },
                              bodyText: "skip",
                              createdAt: "2026-02-21T10:00:00.000Z",
                              url: "https://example.com"
                            }
                          ]
                        }
                      }
                    ]
                  }
                }
              }
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const comments = await githubSentinelAdapter.listUnresolvedComments(repo, 1, {
      authToken: "token"
    });

    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.file, "src/index.ts");
    assert.equal(comments[0]?.line, 12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("github sentinel lists failing runs and jobs", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/actions/runs/900")) {
        return new Response(
          JSON.stringify({
            id: 900,
            name: "CI",
            path: ".github/workflows/ci.yml",
            run_number: 10,
            run_attempt: 1,
            head_sha: "abc123",
            conclusion: "failure",
            html_url: "https://github.com/acme/platform/actions/runs/900"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      if (url.endsWith("/actions/runs/900/jobs?per_page=100")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 500,
                name: "Run tests",
                conclusion: "failure",
                html_url: "https://github.com/acme/platform/actions/runs/900/job/500",
                steps: [
                  { number: 1, name: "Setup", conclusion: "success" },
                  { number: 2, name: "Test", conclusion: "failure" }
                ]
              },
              {
                id: 501,
                name: "Lint",
                conclusion: "success",
                html_url: "https://github.com/acme/platform/actions/runs/900/job/501",
                steps: []
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const runs = await githubSentinelAdapter.listFailureRuns(
      repo,
      {
        runId: 900,
        maxRuns: 10
      },
      {
        authToken: "token"
      }
    );

    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.jobs.length, 1);
    assert.equal(runs[0]?.jobs[0]?.failedStepName, "Test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("github sentinel decodes zipped job logs", async () => {
  const originalFetch = globalThis.fetch;

  try {
    const zipped = zipSync({
      "1_Run tests.txt": strToU8("FAIL test/example.test.ts\nError: expected pass")
    });

    globalThis.fetch = async () =>
      new Response(Buffer.from(zipped), {
        status: 200,
        headers: {
          "content-type": "application/zip"
        }
      });

    const logText = await githubSentinelAdapter.getJobLogs({
      repo,
      jobId: 500,
      authToken: "token",
      maxLogBytes: 500_000
    });

    assert.match(logText, /FAIL test\/example\.test\.ts/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("github sentinel lists notifications with pull request extraction", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/notifications")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              reason: "review_requested",
              unread: true,
              updated_at: "2026-02-21T12:00:00.000Z",
              repository: { full_name: "acme/platform" },
              subject: {
                type: "PullRequest",
                title: "Fix runtime guard",
                url: "https://api.github.com/repos/acme/platform/pulls/42"
              }
            },
            {
              id: "2",
              reason: "subscribed",
              unread: false,
              updated_at: "2026-02-21T11:00:00.000Z",
              repository: { full_name: "acme/platform" },
              subject: {
                type: "Issue",
                title: "Issue update",
                url: "https://api.github.com/repos/acme/platform/issues/11"
              }
            }
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const notifications = await githubSentinelAdapter.listNotifications(
      {
        repo,
        maxItems: 20,
        includeRead: false
      },
      {
        authToken: "token"
      }
    );

    assert.equal(notifications.length, 2);
    assert.equal(notifications[0]?.pullNumber, 42);
    assert.equal(notifications[0]?.subjectType, "PullRequest");
    assert.equal(notifications[1]?.pullNumber, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("github sentinel lists open pull requests, summary, and files", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/pulls?")) {
        return new Response(
          JSON.stringify([
            {
              number: 42,
              title: "Fix runtime guard",
              state: "open",
              draft: false,
              user: { login: "maintainer" },
              additions: 12,
              deletions: 3,
              changed_files: 2,
              comments: 1,
              review_comments: 2,
              commits: 1,
              created_at: "2026-02-21T10:00:00.000Z",
              updated_at: "2026-02-21T12:00:00.000Z",
              html_url: "https://github.com/acme/platform/pull/42",
              head: { sha: "abc123" }
            }
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      if (url.endsWith("/pulls/42")) {
        return new Response(
          JSON.stringify({
            number: 42,
            title: "Fix runtime guard",
            state: "open",
            draft: false,
            user: { login: "maintainer" },
            additions: 12,
            deletions: 3,
            changed_files: 2,
            comments: 1,
            review_comments: 2,
            commits: 1,
            created_at: "2026-02-21T10:00:00.000Z",
            updated_at: "2026-02-21T12:00:00.000Z",
            html_url: "https://github.com/acme/platform/pull/42",
            head: { sha: "abc123" }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      if (url.includes("/pulls/42/files?")) {
        return new Response(
          JSON.stringify([
            {
              filename: "src/commands/score.ts",
              status: "modified",
              additions: 20,
              deletions: 5,
              changes: 25
            },
            {
              filename: "src/commands/patterns.ts",
              status: "added",
              additions: 40,
              deletions: 0,
              changes: 40
            }
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const pulls = await githubSentinelAdapter.listOpenPullRequests(
      repo,
      {
        maxPullRequests: 10
      },
      {
        authToken: "token"
      }
    );
    assert.equal(pulls.length, 1);
    assert.equal(pulls[0]?.number, 42);

    const summary = await githubSentinelAdapter.getPullRequestSummary(repo, 42, {
      authToken: "token"
    });
    assert.equal(summary.title, "Fix runtime guard");

    const files = await githubSentinelAdapter.listPullRequestFiles(
      repo,
      42,
      {
        maxFiles: 10
      },
      {
        authToken: "token"
      }
    );

    assert.equal(files.length, 2);
    assert.equal(files[0]?.path, "src/commands/patterns.ts");
    assert.equal(files[1]?.path, "src/commands/score.ts");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
