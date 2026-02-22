import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { App } from "../App";

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("App", () => {
  test("renders dashboard tabs and settings", async () => {
    const snapshot = {
      meta: {
        repo: "acme/repo",
        provider: "github",
        generatedAt: "2026-02-22T00:00:00.000Z",
        stale: false,
        backoffSeconds: 0,
        nextRefreshAt: null,
        refreshIntervalSeconds: 120
      },
      sections: {
        digest: {
          status: "ok",
          data: {
            repo: "acme/repo",
            generatedAt: "2026-02-22T00:00:00.000Z",
            configPath: ".seven-shadow/sentinel-eye.json",
            totalNotifications: 1,
            notificationsConsidered: 1,
            skippedNonPullRequest: 0,
            topPriorities: [],
            topPatterns: []
          },
          error: null
        },
        inbox: {
          status: "ok",
          data: {
            repo: "acme/repo",
            generatedAt: "2026-02-22T00:00:00.000Z",
            configPath: ".seven-shadow/sentinel-eye.json",
            totalNotifications: 1,
            notificationsConsidered: 1,
            skippedNonPullRequest: 0,
            items: []
          },
          error: null
        },
        score: {
          status: "ok",
          data: {
            repo: "acme/repo",
            generatedAt: "2026-02-22T00:00:00.000Z",
            configPath: ".seven-shadow/sentinel-eye.json",
            totalPullRequests: 0,
            items: []
          },
          error: null
        },
        patterns: {
          status: "ok",
          data: {
            repo: "acme/repo",
            generatedAt: "2026-02-22T00:00:00.000Z",
            configPath: ".seven-shadow/sentinel-eye.json",
            totalPullRequests: 0,
            clusters: []
          },
          error: null
        }
      }
    };

    const status = {
      provider: "github",
      repo: "acme/repo",
      ready: true,
      stale: false,
      generatedAt: "2026-02-22T00:00:00.000Z",
      lastSuccessAt: "2026-02-22T00:00:00.000Z",
      lastError: null,
      backoffSeconds: 0,
      nextRefreshAt: null,
      refreshIntervalSeconds: 120
    };

    const config = {
      configPath: ".seven-shadow/sentinel-eye.json",
      source: "default",
      config: {
        version: 1,
        inbox: {
          requireNotificationsScope: true,
          includeReadByDefault: false
        },
        limits: {
          maxNotifications: 100,
          maxPullRequests: 50,
          maxFilesPerPullRequest: 300,
          maxFailureRunsPerPullRequest: 5,
          maxLogBytesPerJob: 5000000,
          maxDigestItems: 20
        },
        patterns: {
          minClusterSize: 2,
          pathDepth: 2,
          maxTitleTokens: 6,
          minTitleTokenLength: 3
        },
        scoring: {
          caps: {
            failingRuns: 5,
            unresolvedComments: 20,
            changedFiles: 250,
            linesChanged: 6000,
            duplicatePeers: 20
          },
          weights: {
            failingRuns: 35,
            unresolvedComments: 30,
            changedFiles: 15,
            linesChanged: 10,
            duplicatePeers: 10
          }
        }
      }
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/status")) {
        return new Response(JSON.stringify(status), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.endsWith("/snapshot")) {
        return new Response(JSON.stringify(snapshot), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.endsWith("/refresh") && init?.method === "POST") {
        return new Response(JSON.stringify({ status, snapshot }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.endsWith("/config") && !init?.method) {
        return new Response(JSON.stringify(config), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (url.endsWith("/config") && init?.method === "PUT") {
        return new Response(JSON.stringify(config), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response("not found", { status: 404 });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Maintainer Dashboard")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open dashboard settings" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Digest" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Score" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Patterns" })).toBeInTheDocument();
    });

    screen.getByRole("button", { name: "Open dashboard settings" }).click();
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Triage Settings" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Patterns" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Scoring" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Processing Limits" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply Settings" })).toBeInTheDocument();
      expect(screen.queryByText("Shadow Controls")).not.toBeInTheDocument();
      expect(screen.queryByText("Apply Shadow Controls")).not.toBeInTheDocument();
    });

    screen.getByRole("radio", { name: /Sovereign/i }).click();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Triage Settings" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply Settings" })).toBeInTheDocument();
    });
  });
});
