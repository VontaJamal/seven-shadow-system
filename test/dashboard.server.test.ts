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

    const indexResponse = await fetch(`${handle.url}/`);
    assert.equal(indexResponse.status, 200);
  } finally {
    await handle.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
