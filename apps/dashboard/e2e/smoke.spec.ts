import { expect, test } from "@playwright/test";

const snapshotFixture = {
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
        totalNotifications: 2,
        notificationsConsidered: 1,
        skippedNonPullRequest: 1,
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
        totalNotifications: 2,
        notificationsConsidered: 1,
        skippedNonPullRequest: 1,
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

const statusFixture = {
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

test("dashboard app renders triage suite", async ({ page }) => {
  await page.route("**/api/v1/dashboard/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(statusFixture)
    });
  });

  await page.route("**/api/v1/dashboard/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(snapshotFixture)
    });
  });

  await page.route("**/api/v1/dashboard/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: statusFixture,
        snapshot: snapshotFixture
      })
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Maintainer Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Digest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Score" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Patterns" })).toBeVisible();

  await page.getByRole("button", { name: "Open dashboard settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
