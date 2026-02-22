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
  });
});
