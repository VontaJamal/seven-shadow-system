import assert from "node:assert/strict";
import test from "node:test";

import { bitbucketProvider } from "../src/providers/bitbucket";
import type { ProviderPolicyContext } from "../src/providers/types";

const defaultPolicy: ProviderPolicyContext = {
  scanPrBody: true,
  scanReviewBody: true,
  scanCommentBody: true,
  approvals: {
    fetchTimeoutMs: 5_000,
    maxPages: 10
  }
};

test("bitbucket provider declares expected supported events", () => {
  assert.deepEqual(Array.from(bitbucketProvider.supportedEvents).sort(), [
    "pullrequest:comment_created",
    "pullrequest:comment_updated",
    "pullrequest:created",
    "pullrequest:updated"
  ]);
});

test("bitbucket provider extracts pull request and comment targets", () => {
  const prTargets = bitbucketProvider.extractTargets(
    "pullrequest:created",
    {
      repository: {
        full_name: "acme-workspace/repo"
      },
      pullrequest: {
        id: 7,
        description: "Please validate deterministic trust behavior.",
        author: {
          user: {
            nickname: "maintainer",
            type: "user"
          }
        }
      }
    },
    defaultPolicy
  );

  assert.deepEqual(prTargets.targets.map((item) => item.source), ["pr_body"]);
  assert.deepEqual(prTargets.malformedReasons, []);

  const commentTargets = bitbucketProvider.extractTargets(
    "pullrequest:comment_created",
    {
      repository: {
        full_name: "acme-workspace/repo"
      },
      pullrequest: {
        id: 7
      },
      comment: {
        id: 99,
        content: {
          raw: "Could we add one more regression test?"
        },
        user: {
          nickname: "reviewer",
          type: "user"
        }
      }
    },
    defaultPolicy
  );

  assert.deepEqual(commentTargets.targets.map((item) => item.source), ["comment"]);
  assert.deepEqual(commentTargets.malformedReasons, []);
});

test("bitbucket provider reports deterministic malformed reasons", () => {
  const malformed = bitbucketProvider.extractTargets(
    "pullrequest:comment_updated",
    {
      repository: {
        full_name: "acme-workspace/repo"
      },
      pullrequest: {},
      comment: {
        id: 42
      }
    },
    defaultPolicy
  );

  assert.deepEqual(malformed.targets, []);
  assert.deepEqual(malformed.malformedReasons, ["missing pullrequest.id", "missing comment.content.raw"]);
});

test("bitbucket provider rejects unsupported event names deterministically", () => {
  const unsupported = bitbucketProvider.extractTargets(
    "pullrequest:approved",
    {
      repository: {
        full_name: "acme-workspace/repo"
      }
    },
    defaultPolicy
  );

  assert.deepEqual(unsupported.targets, []);
  assert.deepEqual(unsupported.malformedReasons, ["unsupported event 'pullrequest:approved'"]);
});

test("bitbucket provider extracts pull context", () => {
  const context = bitbucketProvider.extractPullContext("pullrequest:updated", {
    repository: {
      full_name: "acme-workspace/repo"
    },
    pullrequest: {
      id: 17
    }
  });

  assert.deepEqual(context, {
    owner: "acme-workspace",
    repo: "repo",
    pullNumber: 17
  });
});

test("bitbucket provider counts unique approved humans", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          participants: [
            {
              approved: true,
              user: {
                nickname: "trusted-admin",
                type: "user"
              }
            },
            {
              approved: true,
              user: {
                nickname: "ci-app",
                type: "app"
              }
            },
            {
              approved: true,
              user: {
                nickname: "alice",
                type: "user"
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );

    const approvals = await bitbucketProvider.fetchHumanApprovalCount(
      {
        owner: "acme-workspace",
        repo: "repo",
        pullNumber: 7
      },
      {
        authToken: "token",
        githubToken: "token",
        allowedAuthors: new Set(["trusted-admin"]),
        fetchTimeoutMs: 5_000,
        maxPages: 5,
        retry: {
          enabled: true,
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 2,
          jitterRatio: 0,
          retryableStatusCodes: [429, 500, 502, 503, 504]
        }
      }
    );

    assert.equal(approvals, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
