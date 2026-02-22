import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startDashboardServer } from "../src/dashboard/server";

async function allocatePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

test("dashboard server exposes deterministic API endpoints", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-dashboard-"));
  const assetRoot = path.join(tempDir, "assets");
  const configPath = path.join(tempDir, ".seven-shadow", "sentinel-eye.json");

  await fs.mkdir(assetRoot, { recursive: true });
  await fs.writeFile(path.join(assetRoot, "index.html"), "<html><body><div id='root'></div></body></html>\n", "utf8");

  const port = await allocatePort();
  const handle = await startDashboardServer({
    host: "127.0.0.1",
    port,
    refreshSeconds: 120,
    providerName: "bitbucket",
    repoArg: "acme/repo",
    limit: 10,
    configPath,
    env: {},
    assetRoot
  });

  try {
    const healthResponse = await fetch(`${handle.url}/healthz`);
    assert.equal(healthResponse.status, 200);
    const health = (await healthResponse.json()) as Record<string, unknown>;
    assert.equal(health.ok, true);

    const statusResponse = await fetch(`${handle.url}/api/v1/dashboard/status`);
    assert.equal(statusResponse.status, 200);
    const status = (await statusResponse.json()) as Record<string, unknown>;
    assert.equal(status.provider, "bitbucket");

    const snapshotResponse = await fetch(`${handle.url}/api/v1/dashboard/snapshot`);
    assert.equal(snapshotResponse.status, 200);
    const snapshot = (await snapshotResponse.json()) as {
      sections: {
        digest: {
          status: string;
        };
      };
    };
    assert.equal(snapshot.sections.digest.status, "error");

    const refreshResponse = await fetch(`${handle.url}/api/v1/dashboard/refresh`, {
      method: "POST"
    });
    assert.equal(refreshResponse.status, 200);

    const configResponse = await fetch(`${handle.url}/api/v1/dashboard/config`);
    assert.equal(configResponse.status, 200);
    const configPayload = (await configResponse.json()) as {
      configPath: string;
      source: string;
      config: {
        version: number;
      };
    };
    assert.equal(configPayload.source, "default");
    assert.equal(configPayload.config.version, 1);
    assert.equal(configPayload.configPath, configPath);

    const updateConfigResponse = await fetch(`${handle.url}/api/v1/dashboard/config`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        config: {
          version: 1,
          inbox: {
            requireNotificationsScope: true,
            includeReadByDefault: false
          },
          limits: {
            maxNotifications: 80,
            maxPullRequests: 40,
            maxFilesPerPullRequest: 250,
            maxFailureRunsPerPullRequest: 5,
            maxLogBytesPerJob: 5_000_000,
            maxDigestItems: 15
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
        }
      })
    });
    assert.equal(updateConfigResponse.status, 200);

    const writtenConfig = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      limits: {
        maxDigestItems: number;
      };
    };
    assert.equal(writtenConfig.limits.maxDigestItems, 15);

    const indexResponse = await fetch(`${handle.url}/`);
    assert.equal(indexResponse.status, 200);
  } finally {
    await handle.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
