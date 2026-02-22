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

const configFixture = {
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

  await page.route("**/api/v1/dashboard/config", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(configFixture)
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(configFixture)
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Maintainer Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Digest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Score" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Patterns" })).toBeVisible();

  await page.getByRole("button", { name: "Open dashboard settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Triage Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Patterns" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scoring" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Processing Limits" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Settings" })).toBeVisible();
  await expect(page.getByText("Shadow Controls")).toHaveCount(0);
  await expect(page.getByText("Apply Shadow Controls")).toHaveCount(0);

  await page.getByRole("radio", { name: /Sovereign/i }).click();
  await expect(page.getByRole("heading", { name: "Triage Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Settings" })).toBeVisible();
});
