import assert from "node:assert/strict";
import test from "node:test";

import { parseDigestArgs, renderDigestMarkdown } from "../src/commands/digest";
import { parseInboxArgs, renderInboxMarkdown } from "../src/commands/inbox";
import { parsePatternsArgs, renderPatternsMarkdown } from "../src/commands/patterns";
import { parseScoreArgs, renderScoreMarkdown } from "../src/commands/score";
import type {
  SentinelDigestReport,
  SentinelInboxReport,
  SentinelPatternsReport,
  SentinelScoreReport
} from "../src/commands/types";

const scoredItem = {
  repo: "acme/repo",
  prNumber: 42,
  title: "Fix runtime guard",
  htmlUrl: "https://example.com/pr/42",
  state: "open",
  draft: false,
  author: "maintainer",
  createdAt: "2026-02-21T10:00:00.000Z",
  updatedAt: "2026-02-21T12:00:00.000Z",
  changedFiles: 12,
  additions: 120,
  deletions: 30,
  linesChanged: 150,
  unresolvedComments: 3,
  failingRuns: 1,
  duplicatePeers: 2,
  pathAreas: ["src/commands"],
  titleFingerprint: "fix guard runtime",
  failureSignatures: [".github/workflows/ci.yml::Run tests"],
  riskPoints: 59,
  priorityScore: 59,
  trustScore: 41,
  breakdown: {
    failingRuns: 10,
    unresolvedComments: 20,
    changedFiles: 15,
    linesChanged: 10,
    duplicatePeers: 4
  },
  notification: {
    id: "n-1",
    reason: "review_requested",
    unread: true,
    updatedAt: "2026-02-21T12:00:00.000Z"
  }
};

test("parse triage command args apply deterministic defaults", () => {
  const patterns = parsePatternsArgs([]);
  const inbox = parseInboxArgs([]);
  const score = parseScoreArgs([]);
  const digest = parseDigestArgs([]);

  assert.equal(patterns.providerName, "github");
  assert.equal(patterns.format, "md");
  assert.equal(inbox.includeAll, false);
  assert.equal(score.limit, 20);
  assert.equal(digest.format, "md");
});

test("triage markdown renderers include key sections", () => {
  const patternsReport: SentinelPatternsReport = {
    repo: "acme/repo",
    generatedAt: "2026-02-21T12:00:00.000Z",
    configPath: "/repo/.seven-shadow/sentinel-eye.json",
    totalPullRequests: 1,
    clusters: [
      {
        type: "path-area",
        key: "src/commands",
        size: 1,
        pullRequests: [
          {
            repo: "acme/repo",
            prNumber: 42,
            title: "Fix runtime guard",
            htmlUrl: "https://example.com/pr/42",
            priorityScore: 59
          }
        ]
      }
    ]
  };

  const scoreReport: SentinelScoreReport = {
    repo: "acme/repo",
    generatedAt: "2026-02-21T12:00:00.000Z",
    configPath: "/repo/.seven-shadow/sentinel-eye.json",
    totalPullRequests: 1,
    items: [scoredItem]
  };

  const inboxReport: SentinelInboxReport = {
    repo: "acme/repo",
    generatedAt: "2026-02-21T12:00:00.000Z",
    configPath: "/repo/.seven-shadow/sentinel-eye.json",
    totalNotifications: 2,
    notificationsConsidered: 1,
    skippedNonPullRequest: 1,
    items: [scoredItem]
  };

  const digestReport: SentinelDigestReport = {
    repo: "acme/repo",
    generatedAt: "2026-02-21T12:00:00.000Z",
    configPath: "/repo/.seven-shadow/sentinel-eye.json",
    totalNotifications: 2,
    notificationsConsidered: 1,
    skippedNonPullRequest: 1,
    topPriorities: [scoredItem],
    topPatterns: [
      {
        type: "path-area",
        key: "src/commands",
        size: 1,
        pullRequests: [
          {
            repo: "acme/repo",
            prNumber: 42,
            title: "Fix runtime guard",
            htmlUrl: "https://example.com/pr/42",
            priorityScore: 59
          }
        ]
      }
    ]
  };

  const patternsMarkdown = renderPatternsMarkdown(patternsReport);
  const scoreMarkdown = renderScoreMarkdown(scoreReport);
  const inboxMarkdown = renderInboxMarkdown(inboxReport);
  const digestMarkdown = renderDigestMarkdown(digestReport);

  assert.match(patternsMarkdown, /Pattern Clusters/);
  assert.match(scoreMarkdown, /PR Trust Scores/);
  assert.match(inboxMarkdown, /Maintainer Inbox/);
  assert.match(digestMarkdown, /Sentinel Eye Digest/);
});
