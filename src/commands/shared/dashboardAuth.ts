import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { getProviderByName } from "../../providers/registry";

const execFileAsync = promisify(execFile);

export interface ResolveDashboardAuthOptions {
  providerName: string;
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
}

export interface ResolvedDashboardAuth {
  env: NodeJS.ProcessEnv;
  authTokenEnvVar: string;
  source: "env" | "gh-token" | "gh-login" | "none";
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function isCommandNotFound(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException;
  return err?.code === "ENOENT";
}

async function runGhToken(): Promise<string> {
  const { stdout } = await execFileAsync("gh", ["auth", "token"]);
  return stdout.trim();
}

async function runGhLoginInteractive(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "gh",
      ["auth", "login", "--web", "--hostname", "github.com", "--scopes", "repo,read:org,notifications"],
      {
        stdio: "inherit"
      }
    );

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`gh auth login exited with code ${code ?? "unknown"}`));
    });
  });
}

export async function resolveDashboardAuth(options: ResolveDashboardAuthOptions): Promise<ResolvedDashboardAuth> {
  const providerName = options.providerName.trim().toLowerCase();
  const provider = getProviderByName(providerName);
  if (!provider) {
    throw makeError("E_PROVIDER_UNSUPPORTED", `provider '${providerName}' is not registered`);
  }

  const authTokenEnvVar = provider.approvalTokenEnvVar ?? "GITHUB_TOKEN";
  const env = options.env ?? process.env;
  const existingToken = env[authTokenEnvVar]?.trim();

  if (existingToken) {
    return {
      env,
      authTokenEnvVar,
      source: "env"
    };
  }

  if (providerName !== "github") {
    return {
      env,
      authTokenEnvVar,
      source: "none"
    };
  }

  try {
    const token = await runGhToken();
    if (token.length > 0) {
      return {
        env: {
          ...env,
          [authTokenEnvVar]: token
        },
        authTokenEnvVar,
        source: "gh-token"
      };
    }
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw makeError(
        "E_DASHBOARD_GH_NOT_FOUND",
        "gh CLI not found. Install GitHub CLI or set GITHUB_TOKEN before running 7s dashboard."
      );
    }
  }

  const interactive = options.interactive ?? false;
  if (!interactive) {
    throw makeError(
      "E_DASHBOARD_AUTH_REQUIRED",
      "GITHUB_TOKEN is missing and gh auth token is unavailable. Set GITHUB_TOKEN or run from an interactive terminal."
    );
  }

  try {
    await runGhLoginInteractive();
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw makeError(
        "E_DASHBOARD_GH_NOT_FOUND",
        "gh CLI not found. Install GitHub CLI or set GITHUB_TOKEN before running 7s dashboard."
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_DASHBOARD_GH_AUTH_FAILED", message.slice(0, 220));
  }

  try {
    const token = await runGhToken();
    if (!token) {
      throw new Error("gh auth token returned empty output");
    }

    return {
      env: {
        ...env,
        [authTokenEnvVar]: token
      },
      authTokenEnvVar,
      source: "gh-login"
    };
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw makeError(
        "E_DASHBOARD_GH_NOT_FOUND",
        "gh CLI not found. Install GitHub CLI or set GITHUB_TOKEN before running 7s dashboard."
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_DASHBOARD_GH_AUTH_FAILED", message.slice(0, 220));
  }
}
