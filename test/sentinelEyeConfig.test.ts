import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadSentinelEyeConfig,
  parseSentinelEyeConfig,
  writeSentinelEyeConfig
} from "../src/commands/shared/sentinelEyeConfig";

test("loadSentinelEyeConfig uses deterministic defaults when file is absent", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-eye-config-"));

  try {
    const resolved = await loadSentinelEyeConfig({ cwd: tempDir });
    assert.equal(resolved.source, "default");
    assert.equal(resolved.config.version, 1);
    assert.equal(resolved.config.inbox.requireNotificationsScope, true);
    assert.match(resolved.configPath, /\.seven-shadow[\/\\]sentinel-eye\.json$/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("loadSentinelEyeConfig fails deterministically on malformed JSON", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-eye-config-"));

  try {
    const configPath = path.join(tempDir, ".seven-shadow", "sentinel-eye.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{ not-json", "utf8");

    await assert.rejects(async () => {
      await loadSentinelEyeConfig({ cwd: tempDir });
    }, /E_SENTINEL_CONFIG_INVALID_JSON/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("parseSentinelEyeConfig validates required limits", () => {
  assert.throws(() => {
    parseSentinelEyeConfig({
      version: 1,
      inbox: {
        requireNotificationsScope: true,
        includeReadByDefault: false
      },
      limits: {
        maxNotifications: 0,
        maxPullRequests: 50,
        maxFilesPerPullRequest: 300,
        maxFailureRunsPerPullRequest: 5,
        maxLogBytesPerJob: 5_000_000,
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
          linesChanged: 6_000,
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
    });
  }, /E_SENTINEL_CONFIG_INVALID/);
});

test("writeSentinelEyeConfig persists canonical JSON with deterministic ordering", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-eye-config-"));

  try {
    const configPath = path.join(tempDir, ".seven-shadow", "sentinel-eye.json");
    await writeSentinelEyeConfig({
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
          maxLogBytesPerJob: 5_000_000,
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
            linesChanged: 6_000,
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
      },
      configPath
    });

    const raw = await fs.readFile(configPath, "utf8");
    assert.match(raw, /"version": 1/);
    assert.match(raw, /"inbox": \{/);
    assert.match(raw, /"limits": \{/);
    assert.match(raw, /"patterns": \{/);
    assert.match(raw, /"scoring": \{/);
    assert.equal(raw.endsWith("\n"), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
