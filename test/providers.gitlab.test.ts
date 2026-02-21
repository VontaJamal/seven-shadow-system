import assert from "node:assert/strict";
import test from "node:test";

import { gitlabProvider } from "../src/providers/gitlab";
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

test("gitlab provider declares supported events", () => {
  assert.deepEqual(Array.from(gitlabProvider.supportedEvents).sort(), ["Merge Request Hook", "Note Hook"]);
});

test("gitlab provider extracts merge request body and note body targets", () => {
  const mergeRequestTargets = gitlabProvider.extractTargets(
    "Merge Request Hook",
    {
      object_kind: "merge_request",
      project: {
        path_with_namespace: "acme/platform/repo"
      },
      user: {
        username: "maintainer"
      },
      object_attributes: {
        iid: 7,
        description: "Please review this merge request."
      }
    },
    defaultPolicy
  );

  assert.deepEqual(mergeRequestTargets.targets.map((item) => item.source), ["pr_body"]);
  assert.deepEqual(mergeRequestTargets.malformedReasons, []);

  const noteTargets = gitlabProvider.extractTargets(
    "Note Hook",
    {
      object_kind: "note",
      project: {
        path_with_namespace: "acme/platform/repo"
      },
      user: {
        username: "reviewer"
      },
      object_attributes: {
        id: 19,
        noteable_type: "MergeRequest",
        noteable_iid: 7,
        note: "Could we add more tests here?"
      }
    },
    defaultPolicy
  );

  assert.deepEqual(noteTargets.targets.map((item) => item.source), ["comment"]);
  assert.deepEqual(noteTargets.malformedReasons, []);
});

test("gitlab provider resolves Note Hook pull request iid from merge_request fallback", () => {
  const context = gitlabProvider.extractPullContext("Note Hook", {
    object_kind: "note",
    project: {
      path_with_namespace: "acme/platform/repo"
    },
    object_attributes: {
      noteable_type: "MergeRequest",
      note: "Looks good",
      id: 77
    },
    merge_request: {
      iid: 33
    }
  });

  assert.deepEqual(context, {
    owner: "acme/platform",
    repo: "repo",
    pullNumber: 33
  });
});

test("gitlab provider reports deterministic malformed reasons", () => {
  const malformed = gitlabProvider.extractTargets(
    "Note Hook",
    {
      object_kind: "note",
      project: {
        path_with_namespace: "acme/platform/repo"
      },
      object_attributes: {
        noteable_type: "Issue"
      }
    },
    defaultPolicy
  );

  assert.deepEqual(malformed.targets, []);
  assert.deepEqual(malformed.malformedReasons, [
    "note is not attached to a merge request",
    "missing object_attributes.note",
    "missing merge request iid"
  ]);
});

test("gitlab provider reports missing project namespace deterministically", () => {
  const malformed = gitlabProvider.extractTargets(
    "Merge Request Hook",
    {
      object_kind: "merge_request",
      object_attributes: {
        iid: 9
      }
    },
    defaultPolicy
  );

  assert.deepEqual(malformed.targets, []);
  assert.deepEqual(malformed.malformedReasons, ["missing project.path_with_namespace"]);
});

test("gitlab provider extracts pull context for merge request events", () => {
  const fromMergeRequest = gitlabProvider.extractPullContext("Merge Request Hook", {
    object_kind: "merge_request",
    project: {
      path_with_namespace: "acme/platform/repo"
    },
    object_attributes: {
      iid: 22
    }
  });

  assert.deepEqual(fromMergeRequest, {
    owner: "acme/platform",
    repo: "repo",
    pullNumber: 22
  });

  const fromNote = gitlabProvider.extractPullContext("Note Hook", {
    object_kind: "note",
    project: {
      path_with_namespace: "acme/platform/repo"
    },
    object_attributes: {
      noteable_type: "MergeRequest",
      noteable_iid: 22
    }
  });

  assert.deepEqual(fromNote, {
    owner: "acme/platform",
    repo: "repo",
    pullNumber: 22
  });
});

test("gitlab provider counts unique non-bot approvals", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          approved_by: [
            {
              user: {
                username: "trusted-admin",
                bot: false
              }
            },
            {
              user: {
                username: "release-bot",
                bot: true
              }
            },
            {
              user: {
                username: "alice",
                bot: false
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
    };

    const approvals = await gitlabProvider.fetchHumanApprovalCount(
      {
        owner: "acme/platform",
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
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
