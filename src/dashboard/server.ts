import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { buildDashboardSnapshot } from "../commands/shared/dashboardSnapshot";
import type { SentinelProviderName } from "../commands/types";
import type {
  SentinelDashboardError,
  SentinelDashboardSnapshot,
  SentinelDashboardStatus
} from "./types";

export interface StartDashboardServerOptions {
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  refreshSeconds: number;
  providerName: SentinelProviderName;
  repoArg?: string;
  limit: number;
  configPath?: string;
  env: NodeJS.ProcessEnv;
  assetRoot: string;
}

export interface DashboardServerHandle {
  url: string;
  close: () => Promise<void>;
  refreshNow: () => Promise<void>;
  getStatus: () => SentinelDashboardStatus;
  getSnapshot: () => SentinelDashboardSnapshot;
}

const RETRYABLE_CODES = new Set([
  "E_SENTINEL_API_ERROR",
  "E_SENTINEL_AUTH_MISSING",
  "E_SENTINEL_NOTIFICATIONS_SCOPE_REQUIRED",
  "E_DASHBOARD_AUTH_REQUIRED"
]);

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function toDashboardError(error: unknown): SentinelDashboardError {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/^([A-Z0-9_]+):\s*(.*)$/);
  if (!match) {
    return {
      code: "E_DASHBOARD_UNKNOWN",
      message: raw.slice(0, 220)
    };
  }

  return {
    code: match[1] ?? "E_DASHBOARD_UNKNOWN",
    message: (match[2] ?? "unknown error").slice(0, 220)
  };
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function contentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  if (extension === ".js") {
    return "application/javascript; charset=utf-8";
  }

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }

  if (extension === ".svg") {
    return "image/svg+xml";
  }

  if (extension === ".ico") {
    return "image/x-icon";
  }

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".map") {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function repoLabelFromArg(repoArg: string | undefined): string {
  if (!repoArg) {
    return "unknown/unknown";
  }

  return repoArg.includes("/") ? repoArg : "unknown/unknown";
}

function createPendingSnapshot(options: StartDashboardServerOptions): SentinelDashboardSnapshot {
  const generatedAt = new Date().toISOString();

  return {
    meta: {
      repo: repoLabelFromArg(options.repoArg),
      provider: options.providerName,
      generatedAt,
      stale: false,
      backoffSeconds: 0,
      nextRefreshAt: null,
      refreshIntervalSeconds: options.refreshSeconds
    },
    sections: {
      digest: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard refresh is in progress"
        }
      },
      inbox: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard refresh is in progress"
        }
      },
      score: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard refresh is in progress"
        }
      },
      patterns: {
        status: "error",
        data: null,
        error: {
          code: "E_DASHBOARD_PENDING",
          message: "dashboard refresh is in progress"
        }
      }
    }
  };
}

function extractPrimaryError(snapshot: SentinelDashboardSnapshot): SentinelDashboardError | null {
  const sections = [
    snapshot.sections.digest,
    snapshot.sections.inbox,
    snapshot.sections.score,
    snapshot.sections.patterns
  ];

  for (const section of sections) {
    if (section.status === "error" && section.error) {
      return section.error;
    }
  }

  return null;
}

function hasAnySectionError(snapshot: SentinelDashboardSnapshot): boolean {
  return (
    snapshot.sections.digest.status === "error" ||
    snapshot.sections.inbox.status === "error" ||
    snapshot.sections.score.status === "error" ||
    snapshot.sections.patterns.status === "error"
  );
}

function isRetryable(error: SentinelDashboardError | null): boolean {
  if (!error) {
    return false;
  }

  if (RETRYABLE_CODES.has(error.code)) {
    return true;
  }

  if (error.code === "E_PROVIDER_UNSUPPORTED") {
    return false;
  }

  return /status=429/i.test(error.message) || /timed out/i.test(error.message);
}

function extractRetryAfterSeconds(error: SentinelDashboardError | null): number | null {
  if (!error) {
    return null;
  }

  const retryAfterSeconds = error.details?.retryAfterSeconds;
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.floor(retryAfterSeconds);
  }

  const retryAfterMs = error.details?.retryAfterMs;
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(1, Math.ceil(retryAfterMs / 1000));
  }

  const match = error.message.match(/retry-?after(?:=|\s+)(\d+)/i);
  if (match?.[1]) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function cloneWithMeta(
  snapshot: SentinelDashboardSnapshot,
  meta: Pick<SentinelDashboardSnapshot["meta"], "stale" | "backoffSeconds" | "nextRefreshAt" | "refreshIntervalSeconds">
): SentinelDashboardSnapshot {
  return {
    meta: {
      repo: snapshot.meta.repo,
      provider: snapshot.meta.provider,
      generatedAt: snapshot.meta.generatedAt,
      stale: meta.stale,
      backoffSeconds: meta.backoffSeconds,
      nextRefreshAt: meta.nextRefreshAt,
      refreshIntervalSeconds: meta.refreshIntervalSeconds
    },
    sections: {
      digest: snapshot.sections.digest,
      inbox: snapshot.sections.inbox,
      score: snapshot.sections.score,
      patterns: snapshot.sections.patterns
    }
  };
}

async function readStaticAsset(assetRoot: string, pathname: string): Promise<{ path: string; body: Buffer }> {
  const sanitized = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(decodeURIComponent(sanitized)).replace(/^([.][.][/\\])+/, "");
  const candidatePath = path.resolve(assetRoot, `.${normalized}`);

  if (!candidatePath.startsWith(path.resolve(assetRoot))) {
    throw makeError("E_DASHBOARD_ASSET_FORBIDDEN", "asset path escapes dashboard root");
  }

  try {
    const body = await fs.readFile(candidatePath);
    return {
      path: candidatePath,
      body
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }

    const fallbackPath = path.join(assetRoot, "index.html");
    const fallbackBody = await fs.readFile(fallbackPath);
    return {
      path: fallbackPath,
      body: fallbackBody
    };
  }
}

export async function startDashboardServer(options: StartDashboardServerOptions): Promise<DashboardServerHandle> {
  const assetRoot = path.resolve(options.assetRoot);

  try {
    const stat = await fs.stat(path.join(assetRoot, "index.html"));
    if (!stat.isFile()) {
      throw new Error("index.html is not a file");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_DASHBOARD_ASSETS_MISSING", `${assetRoot} (${message.slice(0, 220)})`);
  }

  const state: {
    latestSnapshot: SentinelDashboardSnapshot;
    status: SentinelDashboardStatus;
    timer: NodeJS.Timeout | null;
    inFlightRefresh: Promise<void> | null;
    lastSuccessAt: string | null;
    backoffSeconds: number;
    nextRefreshAt: string | null;
  } = {
    latestSnapshot: createPendingSnapshot(options),
    status: {
      provider: options.providerName,
      repo: repoLabelFromArg(options.repoArg),
      ready: false,
      stale: false,
      generatedAt: null,
      lastSuccessAt: null,
      lastError: null,
      backoffSeconds: 0,
      nextRefreshAt: null,
      refreshIntervalSeconds: options.refreshSeconds
    },
    timer: null,
    inFlightRefresh: null,
    lastSuccessAt: null,
    backoffSeconds: 0,
    nextRefreshAt: null
  };

  function scheduleNextRefresh(delaySeconds: number): void {
    if (state.timer) {
      clearTimeout(state.timer);
    }

    const nextDelayMs = Math.max(1, delaySeconds) * 1000;
    const nextRefreshAt = new Date(Date.now() + nextDelayMs).toISOString();
    state.nextRefreshAt = nextRefreshAt;
    state.status.nextRefreshAt = nextRefreshAt;

    state.timer = setTimeout(() => {
      void refreshNow();
    }, nextDelayMs);
  }

  async function refreshNow(): Promise<void> {
    if (state.inFlightRefresh) {
      return state.inFlightRefresh;
    }

    state.inFlightRefresh = (async () => {
      const candidate = await buildDashboardSnapshot({
        providerName: options.providerName,
        repoArg: options.repoArg,
        limit: options.limit,
        configPath: options.configPath,
        env: options.env,
        stale: false,
        backoffSeconds: 0,
        nextRefreshAt: null,
        refreshIntervalSeconds: options.refreshSeconds
      });

      const generatedAt = candidate.meta.generatedAt;
      const hadSectionErrors = hasAnySectionError(candidate);
      const primaryError = extractPrimaryError(candidate);

      if (!hadSectionErrors) {
        state.latestSnapshot = cloneWithMeta(candidate, {
          stale: false,
          backoffSeconds: 0,
          nextRefreshAt: null,
          refreshIntervalSeconds: options.refreshSeconds
        });

        state.lastSuccessAt = generatedAt;
        state.backoffSeconds = 0;
        state.status = {
          provider: candidate.meta.provider,
          repo: candidate.meta.repo,
          ready: true,
          stale: false,
          generatedAt,
          lastSuccessAt: state.lastSuccessAt,
          lastError: null,
          backoffSeconds: 0,
          nextRefreshAt: null,
          refreshIntervalSeconds: options.refreshSeconds
        };
        scheduleNextRefresh(options.refreshSeconds);
        return;
      }

      if (isRetryable(primaryError) && state.lastSuccessAt !== null) {
        const explicitDelay = extractRetryAfterSeconds(primaryError);
        const nextBackoff = explicitDelay
          ? Math.min(900, Math.max(options.refreshSeconds, explicitDelay))
          : Math.min(900, state.backoffSeconds > 0 ? state.backoffSeconds * 2 : options.refreshSeconds * 2);

        state.backoffSeconds = nextBackoff;
        state.latestSnapshot = cloneWithMeta(state.latestSnapshot, {
          stale: true,
          backoffSeconds: nextBackoff,
          nextRefreshAt: null,
          refreshIntervalSeconds: options.refreshSeconds
        });
        state.status = {
          provider: state.latestSnapshot.meta.provider,
          repo: state.latestSnapshot.meta.repo,
          ready: true,
          stale: true,
          generatedAt: state.latestSnapshot.meta.generatedAt,
          lastSuccessAt: state.lastSuccessAt,
          lastError: primaryError,
          backoffSeconds: nextBackoff,
          nextRefreshAt: null,
          refreshIntervalSeconds: options.refreshSeconds
        };
        scheduleNextRefresh(nextBackoff);
        return;
      }

      state.latestSnapshot = cloneWithMeta(candidate, {
        stale: false,
        backoffSeconds: 0,
        nextRefreshAt: null,
        refreshIntervalSeconds: options.refreshSeconds
      });
      state.backoffSeconds = 0;
      state.status = {
        provider: candidate.meta.provider,
        repo: candidate.meta.repo,
        ready: true,
        stale: false,
        generatedAt,
        lastSuccessAt: state.lastSuccessAt,
        lastError: primaryError,
        backoffSeconds: 0,
        nextRefreshAt: null,
        refreshIntervalSeconds: options.refreshSeconds
      };
      scheduleNextRefresh(options.refreshSeconds);
    })()
      .catch((error) => {
        const dashboardError = toDashboardError(error);
        const nextBackoff = Math.min(900, state.backoffSeconds > 0 ? state.backoffSeconds * 2 : options.refreshSeconds * 2);
        state.backoffSeconds = nextBackoff;

        state.latestSnapshot = cloneWithMeta(state.latestSnapshot, {
          stale: state.lastSuccessAt !== null,
          backoffSeconds: nextBackoff,
          nextRefreshAt: null,
          refreshIntervalSeconds: options.refreshSeconds
        });

        state.status = {
          provider: state.latestSnapshot.meta.provider,
          repo: state.latestSnapshot.meta.repo,
          ready: true,
          stale: state.lastSuccessAt !== null,
          generatedAt: state.latestSnapshot.meta.generatedAt,
          lastSuccessAt: state.lastSuccessAt,
          lastError: dashboardError,
          backoffSeconds: nextBackoff,
          nextRefreshAt: null,
          refreshIntervalSeconds: options.refreshSeconds
        };

        scheduleNextRefresh(nextBackoff);
      })
      .finally(() => {
        state.latestSnapshot = cloneWithMeta(state.latestSnapshot, {
          stale: state.status.stale,
          backoffSeconds: state.status.backoffSeconds,
          nextRefreshAt: state.status.nextRefreshAt,
          refreshIntervalSeconds: options.refreshSeconds
        });
        state.inFlightRefresh = null;
      });

    return state.inFlightRefresh;
  }

  await refreshNow();

  const server = http.createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const rawUrl = request.url ?? "/";
      const parsed = new URL(rawUrl, `http://${options.host}:${options.port}`);
      const pathname = parsed.pathname;

      if (method === "GET" && pathname === "/healthz") {
        sendJson(response, 200, {
          ok: true,
          ready: state.status.ready,
          stale: state.status.stale,
          generatedAt: state.status.generatedAt,
          nextRefreshAt: state.status.nextRefreshAt
        });
        return;
      }

      if (method === "GET" && pathname === "/api/v1/dashboard/status") {
        sendJson(response, 200, state.status);
        return;
      }

      if (method === "GET" && pathname === "/api/v1/dashboard/snapshot") {
        sendJson(response, 200, state.latestSnapshot);
        return;
      }

      if (method === "POST" && pathname === "/api/v1/dashboard/refresh") {
        await refreshNow();
        sendJson(response, 200, {
          status: state.status,
          snapshot: state.latestSnapshot
        });
        return;
      }

      if (method !== "GET") {
        sendJson(response, 405, {
          code: "E_DASHBOARD_METHOD_NOT_ALLOWED",
          message: "only GET and POST are supported"
        });
        return;
      }

      const asset = await readStaticAsset(assetRoot, pathname);
      response.statusCode = 200;
      response.setHeader("Content-Type", contentTypeForPath(asset.path));
      response.end(asset.body);
    } catch (error) {
      const dashboardError = toDashboardError(error);
      sendJson(response, 500, dashboardError);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EADDRINUSE") {
        reject(makeError("E_DASHBOARD_PORT_IN_USE", `port ${options.port} is already in use`));
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      reject(makeError("E_DASHBOARD_SERVER_START", message.slice(0, 220)));
    });

    server.listen(options.port, options.host, () => {
      resolve();
    });
  });

  const urlHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;

  return {
    url: `http://${urlHost}:${options.port}`,
    close: async () => {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    refreshNow,
    getStatus: () => state.status,
    getSnapshot: () => state.latestSnapshot
  };
}
