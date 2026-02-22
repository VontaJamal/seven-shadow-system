import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { startDashboardServer } from "../dashboard/server";
import { resolveDashboardAuth } from "./shared/dashboardAuth";
import type { SentinelProviderName } from "./types";

interface DashboardArgs {
  repoArg?: string;
  providerName: SentinelProviderName;
  limit: number;
  configPath?: string;
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  refreshSec: number;
  openMode: "auto" | "open" | "no-open";
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw makeError("E_SENTINEL_ARG_INVALID", `${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseHost(value: string): "127.0.0.1" | "0.0.0.0" {
  if (value === "127.0.0.1" || value === "0.0.0.0") {
    return value;
  }

  throw makeError("E_SENTINEL_ARG_INVALID", "--host must be 127.0.0.1|0.0.0.0");
}

export function parseDashboardArgs(argv: string[]): DashboardArgs {
  const args: DashboardArgs = {
    providerName: "github",
    limit: 20,
    host: "127.0.0.1",
    port: 7777,
    refreshSec: 120,
    openMode: "auto"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: 7s dashboard [--repo <owner/repo>] [--provider github|gitlab|bitbucket] [--limit <n>] [--config <path>] [--host 127.0.0.1|0.0.0.0] [--port <n>] [--refresh-sec <n>] [--open] [--no-open]"
      );
    }

    if (token === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--repo");
      }
      args.repoArg = value;
      index += 1;
      continue;
    }

    if (token === "--provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--provider");
      }

      const normalized = value.trim().toLowerCase();
      if (normalized !== "github" && normalized !== "gitlab" && normalized !== "bitbucket") {
        throw makeError("E_SENTINEL_ARG_INVALID", "--provider must be github|gitlab|bitbucket");
      }

      args.providerName = normalized;
      index += 1;
      continue;
    }

    if (token === "--limit") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--limit");
      }

      args.limit = parsePositiveInt(value, "--limit");
      index += 1;
      continue;
    }

    if (token === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--config");
      }

      args.configPath = value;
      index += 1;
      continue;
    }

    if (token === "--host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--host");
      }

      args.host = parseHost(value.trim());
      index += 1;
      continue;
    }

    if (token === "--port") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--port");
      }

      const parsed = parsePositiveInt(value, "--port");
      if (parsed > 65535) {
        throw makeError("E_SENTINEL_ARG_INVALID", "--port must be <= 65535");
      }
      args.port = parsed;
      index += 1;
      continue;
    }

    if (token === "--refresh-sec") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--refresh-sec");
      }

      args.refreshSec = parsePositiveInt(value, "--refresh-sec");
      index += 1;
      continue;
    }

    if (token === "--open") {
      args.openMode = "open";
      continue;
    }

    if (token === "--no-open") {
      args.openMode = "no-open";
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SENTINEL_ARG_UNKNOWN", token);
    }
  }

  return args;
}

function isInteractive(env: NodeJS.ProcessEnv): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && env.CI !== "true" && env.CI !== "1");
}

function shouldOpenBrowser(mode: DashboardArgs["openMode"], env: NodeJS.ProcessEnv): boolean {
  if (mode === "open") {
    return true;
  }

  if (mode === "no-open") {
    return false;
  }

  return isInteractive(env);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveDashboardAssetRoot(cwd: string): Promise<string> {
  const candidates = [
    path.resolve(__dirname, "..", "..", "dashboard"),
    path.resolve(cwd, "dist", "dashboard"),
    path.resolve(cwd, "apps", "dashboard", "dist")
  ];

  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }

  throw makeError(
    "E_DASHBOARD_ASSETS_MISSING",
    "Dashboard assets not found. Run 'npm run dashboard:build' before starting the dashboard."
  );
}

function openUrl(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

export async function runDashboardCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseDashboardArgs(argv);
  const interactive = isInteractive(env);
  const shouldOpen = shouldOpenBrowser(args.openMode, env);

  const auth = await resolveDashboardAuth({
    providerName: args.providerName,
    env,
    interactive
  });

  const assetRoot = await resolveDashboardAssetRoot(process.cwd());
  const server = await startDashboardServer({
    host: args.host,
    port: args.port,
    refreshSeconds: args.refreshSec,
    providerName: args.providerName,
    repoArg: args.repoArg,
    limit: args.limit,
    configPath: args.configPath,
    env: auth.env,
    assetRoot
  });

  process.stdout.write(`Sentinel Eye dashboard running at ${server.url}\n`);
  process.stdout.write(`Provider: ${args.providerName}\n`);
  process.stdout.write(`Refresh interval: ${args.refreshSec}s\n`);

  if (shouldOpen) {
    try {
      openUrl(server.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Dashboard auto-open failed: ${message}\n`);
    }
  }

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
      process.stdout.write("Sentinel Eye dashboard stopped.\n");
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Dashboard shutdown failed: ${message}\n`);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void shutdown();
  });

  process.once("SIGTERM", () => {
    void shutdown();
  });

  return 0;
}
