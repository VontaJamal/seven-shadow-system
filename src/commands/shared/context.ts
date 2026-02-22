import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getProviderByName } from "../../providers/registry";
import type { ProviderAdapter, SentinelProviderAdapter, SentinelRepositoryRef } from "../../providers/types";

const execFileAsync = promisify(execFile);

export interface ResolvedSentinelContext {
  provider: ProviderAdapter;
  sentinel: SentinelProviderAdapter;
  providerName: string;
  repo: SentinelRepositoryRef;
  prNumber: number | null;
  authToken: string;
  authTokenEnvVar: string;
}

interface ResolveSentinelContextOptions {
  providerName?: string;
  repoArg?: string;
  prNumber?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requirePr?: boolean;
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function asPositiveInt(value: number | undefined, optionName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw makeError("E_SENTINEL_ARG_INVALID", `${optionName} must be a positive integer`);
  }

  return value;
}

function parseRepoFromRemoteUrl(remoteUrl: string): SentinelRepositoryRef | null {
  const sshMatch = remoteUrl.match(/^git@[^:]+:(.+?)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      owner: sshMatch[1] ?? "",
      repo: sshMatch[2] ?? ""
    };
  }

  const sshProtocolMatch = remoteUrl.match(/^ssh:\/\/git@[^/]+\/(.+?)\/([^/]+?)(?:\.git)?$/);
  if (sshProtocolMatch) {
    return {
      owner: sshProtocolMatch[1] ?? "",
      repo: sshProtocolMatch[2] ?? ""
    };
  }

  try {
    const parsed = new URL(remoteUrl);
    const segments = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments.slice(0, segments.length - 1).join("/"),
      repo: segments[segments.length - 1] ?? ""
    };
  } catch {
    return null;
  }
}

function parseRepoArg(repoArg: string): SentinelRepositoryRef {
  const trimmed = repoArg.trim();
  const match = trimmed.match(/^(.+)\/(.+)$/);
  if (!match) {
    throw makeError("E_SENTINEL_ARG_INVALID", "--repo must be in owner/repo format");
  }

  const owner = (match[1] ?? "").trim();
  const repo = (match[2] ?? "").trim();
  if (!owner || !repo) {
    throw makeError("E_SENTINEL_ARG_INVALID", "--repo must be in owner/repo format");
  }

  return { owner, repo };
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args, { cwd });
    return result.stdout.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SENTINEL_GIT", message.slice(0, 220));
  }
}

async function detectRepoFromGit(cwd: string): Promise<SentinelRepositoryRef> {
  const remoteUrl = await runGit(cwd, ["remote", "get-url", "origin"]);
  const parsed = parseRepoFromRemoteUrl(remoteUrl);
  if (!parsed || !parsed.owner || !parsed.repo) {
    throw makeError("E_SENTINEL_REPO_RESOLVE_FAILED", `could not parse owner/repo from remote '${remoteUrl}'`);
  }

  return parsed;
}

async function detectCurrentBranch(cwd: string): Promise<string> {
  const branch = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") {
    throw makeError("E_SENTINEL_PR_RESOLVE_FAILED", "current branch is detached or unavailable");
  }

  return branch;
}

function getProvider(providerNameRaw: string): { provider: ProviderAdapter; sentinel: SentinelProviderAdapter } {
  const provider = getProviderByName(providerNameRaw);
  if (!provider) {
    throw makeError("E_PROVIDER_UNSUPPORTED", `provider '${providerNameRaw}' is not registered`);
  }

  if (!provider.sentinel) {
    throw makeError(
      "E_SENTINEL_PROVIDER_NOT_IMPLEMENTED",
      `sentinel commands are not implemented for provider '${provider.name}' in this phase`
    );
  }

  return {
    provider,
    sentinel: provider.sentinel
  };
}

export async function resolveSentinelContext(options: ResolveSentinelContextOptions = {}): Promise<ResolvedSentinelContext> {
  const providerName = (options.providerName ?? "github").trim().toLowerCase();
  const { provider, sentinel } = getProvider(providerName);
  const authTokenEnvVar = provider.approvalTokenEnvVar ?? "GITHUB_TOKEN";
  const env = options.env ?? process.env;
  const authToken = env[authTokenEnvVar]?.trim() ?? "";

  if (!authToken) {
    throw makeError(
      "E_SENTINEL_AUTH_MISSING",
      `${authTokenEnvVar} is required for sentinel commands with provider '${provider.name}'`
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const repo = options.repoArg ? parseRepoArg(options.repoArg) : await detectRepoFromGit(cwd);
  const requestedPr = asPositiveInt(options.prNumber, "--pr");

  let prNumber: number | null = requestedPr ?? null;
  const requirePr = options.requirePr ?? true;

  if (!prNumber && requirePr) {
    const branch = await detectCurrentBranch(cwd);
    prNumber = await sentinel.resolveOpenPullRequestForBranch(repo, branch, {
      authToken
    });

    if (!prNumber) {
      throw makeError(
        "E_SENTINEL_PR_RESOLVE_FAILED",
        `no open pull request found for current branch '${branch}'. Provide --pr <number> explicitly.`
      );
    }
  }

  return {
    provider,
    sentinel,
    providerName: provider.name,
    repo,
    prNumber,
    authToken,
    authTokenEnvVar
  };
}
