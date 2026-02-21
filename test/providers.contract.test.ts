import { githubProvider } from "../src/providers/github";
import { runProviderContractSuite } from "./providerContractHarness";

runProviderContractSuite({
  providerName: "github",
  provider: githubProvider,
  policyContext: {
    scanPrBody: true,
    scanReviewBody: true,
    scanCommentBody: true,
    approvals: {
      fetchTimeoutMs: 5000,
      maxPages: 10
    }
  },
  extractionCases: [
    {
      name: "extracts PR body + review body from pull_request_review",
      eventName: "pull_request_review",
      payload: {
        repository: { full_name: "acme/repo" },
        pull_request: {
          number: 7,
          body: "PR body text",
          user: { login: "owner", type: "User" }
        },
        review: {
          id: 12,
          body: "Looks solid",
          user: { login: "reviewer", type: "User" }
        }
      },
      expectedSources: ["pr_body", "review"]
    },
    {
      name: "extracts PR issue comment body from issue_comment",
      eventName: "issue_comment",
      payload: {
        repository: { full_name: "acme/repo" },
        issue: {
          number: 9,
          pull_request: {}
        },
        comment: {
          id: 44,
          body: "Can we add tests?",
          user: { login: "human-commenter", type: "User" }
        }
      },
      expectedSources: ["comment"]
    }
  ],
  malformedCase: {
    name: "flags missing PR object as malformed",
    eventName: "pull_request_review",
    payload: {
      repository: { full_name: "acme/repo" },
      review: {
        id: 19,
        body: "Test"
      }
    },
    expectedSources: ["review"],
    expectedMalformedReasons: ["missing pull_request object"]
  },
  pullContextCases: [
    {
      name: "extracts pull context from pull_request_review",
      eventName: "pull_request_review",
      payload: {
        repository: { full_name: "acme/repo" },
        pull_request: {
          number: 7
        }
      },
      expected: {
        owner: "acme",
        repo: "repo",
        pullNumber: 7
      }
    },
    {
      name: "extracts pull context from PR-backed issue_comment",
      eventName: "issue_comment",
      payload: {
        repository: { full_name: "acme/repo" },
        issue: {
          number: 11,
          pull_request: {}
        }
      },
      expected: {
        owner: "acme",
        repo: "repo",
        pullNumber: 11
      }
    },
    {
      name: "returns null pull context for non-PR issue_comment",
      eventName: "issue_comment",
      payload: {
        repository: { full_name: "acme/repo" },
        issue: {
          number: 12
        }
      },
      expected: null
    }
  ],
  approvalCase: {
    name: "counts latest non-bot approvals and ignores allowlisted users",
    context: {
      owner: "acme",
      repo: "repo",
      pullNumber: 42
    },
    allowedAuthors: new Set(["trusted-admin"]),
    expectedApprovals: 1,
    fetchTimeoutMs: 5000,
    maxPages: 5,
    fetchImpl: async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");

      if (page === "1") {
        return new Response(
          JSON.stringify([
            { state: "APPROVED", user: { login: "trusted-admin", type: "User" } },
            { state: "APPROVED", user: { login: "bot-reviewer", type: "Bot" } },
            { state: "APPROVED", user: { login: "alice", type: "User" } },
            { state: "CHANGES_REQUESTED", user: { login: "bob", type: "User" } }
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      if (page === "2") {
        return new Response(
          JSON.stringify([
            { state: "APPROVED", user: { login: "bob", type: "User" } },
            { state: "COMMENTED", user: { login: "alice", type: "User" } }
          ]),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      }

      return new Response("[]", {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }
  }
});
