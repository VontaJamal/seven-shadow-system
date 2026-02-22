import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const SentinelEyeConfigSchema = z.object({
  version: z.literal(1),
  inbox: z.object({
    requireNotificationsScope: z.boolean(),
    includeReadByDefault: z.boolean()
  }),
  limits: z.object({
    maxNotifications: z.number().int().min(1).max(500),
    maxPullRequests: z.number().int().min(1).max(500),
    maxFilesPerPullRequest: z.number().int().min(1).max(2000),
    maxFailureRunsPerPullRequest: z.number().int().min(1).max(50),
    maxLogBytesPerJob: z.number().int().min(1024).max(20_000_000),
    maxDigestItems: z.number().int().min(1).max(100)
  }),
  patterns: z.object({
    minClusterSize: z.number().int().min(2).max(50),
    pathDepth: z.number().int().min(1).max(6),
    maxTitleTokens: z.number().int().min(1).max(12),
    minTitleTokenLength: z.number().int().min(1).max(20)
  }),
  scoring: z.object({
    caps: z.object({
      failingRuns: z.number().int().min(1).max(100),
      unresolvedComments: z.number().int().min(1).max(200),
      changedFiles: z.number().int().min(1).max(5000),
      linesChanged: z.number().int().min(1).max(200_000),
      duplicatePeers: z.number().int().min(1).max(200)
    }),
    weights: z.object({
      failingRuns: z.number().min(0).max(100),
      unresolvedComments: z.number().min(0).max(100),
      changedFiles: z.number().min(0).max(100),
      linesChanged: z.number().min(0).max(100),
      duplicatePeers: z.number().min(0).max(100)
    })
  })
});

export type SentinelEyeConfig = z.infer<typeof SentinelEyeConfigSchema>;

export interface ResolvedSentinelEyeConfig {
  config: SentinelEyeConfig;
  configPath: string;
  source: "default" | "file";
}

export const DEFAULT_SENTINEL_EYE_CONFIG_PATH = path.join(".seven-shadow", "sentinel-eye.json");

const DEFAULT_SENTINEL_EYE_CONFIG: SentinelEyeConfig = {
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
};

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${pathLabel} ${issue.message}`;
    })
    .join("; ")
    .slice(0, 500);
}

export function parseSentinelEyeConfig(raw: unknown): SentinelEyeConfig {
  try {
    return SentinelEyeConfigSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw makeError("E_SENTINEL_CONFIG_INVALID", formatZodIssues(error));
    }

    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SENTINEL_CONFIG_INVALID", message.slice(0, 220));
  }
}

export function buildCanonicalSentinelEyeConfig(config: SentinelEyeConfig): SentinelEyeConfig {
  return {
    version: 1,
    inbox: {
      requireNotificationsScope: config.inbox.requireNotificationsScope,
      includeReadByDefault: config.inbox.includeReadByDefault
    },
    limits: {
      maxNotifications: config.limits.maxNotifications,
      maxPullRequests: config.limits.maxPullRequests,
      maxFilesPerPullRequest: config.limits.maxFilesPerPullRequest,
      maxFailureRunsPerPullRequest: config.limits.maxFailureRunsPerPullRequest,
      maxLogBytesPerJob: config.limits.maxLogBytesPerJob,
      maxDigestItems: config.limits.maxDigestItems
    },
    patterns: {
      minClusterSize: config.patterns.minClusterSize,
      pathDepth: config.patterns.pathDepth,
      maxTitleTokens: config.patterns.maxTitleTokens,
      minTitleTokenLength: config.patterns.minTitleTokenLength
    },
    scoring: {
      caps: {
        failingRuns: config.scoring.caps.failingRuns,
        unresolvedComments: config.scoring.caps.unresolvedComments,
        changedFiles: config.scoring.caps.changedFiles,
        linesChanged: config.scoring.caps.linesChanged,
        duplicatePeers: config.scoring.caps.duplicatePeers
      },
      weights: {
        failingRuns: config.scoring.weights.failingRuns,
        unresolvedComments: config.scoring.weights.unresolvedComments,
        changedFiles: config.scoring.weights.changedFiles,
        linesChanged: config.scoring.weights.linesChanged,
        duplicatePeers: config.scoring.weights.duplicatePeers
      }
    }
  };
}

export function createDefaultSentinelEyeConfig(): SentinelEyeConfig {
  return buildCanonicalSentinelEyeConfig(DEFAULT_SENTINEL_EYE_CONFIG);
}

export function serializeSentinelEyeConfig(config: SentinelEyeConfig): string {
  return `${JSON.stringify(buildCanonicalSentinelEyeConfig(config), null, 2)}\n`;
}

export function resolveSentinelEyeConfigPath(options: {
  configPath?: string;
  cwd?: string;
} = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const requestedPath = options.configPath?.trim();
  return path.resolve(cwd, requestedPath && requestedPath.length > 0 ? requestedPath : DEFAULT_SENTINEL_EYE_CONFIG_PATH);
}

export async function loadSentinelEyeConfig(options: {
  configPath?: string;
  cwd?: string;
} = {}): Promise<ResolvedSentinelEyeConfig> {
  const requestedPath = options.configPath?.trim();
  const resolvedPath = resolveSentinelEyeConfigPath(options);

  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === "ENOENT") {
      if (requestedPath && requestedPath.length > 0) {
        throw makeError("E_SENTINEL_CONFIG_NOT_FOUND", `config file not found: ${resolvedPath}`);
      }

      return {
        config: createDefaultSentinelEyeConfig(),
        configPath: resolvedPath,
        source: "default"
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SENTINEL_CONFIG_READ", message.slice(0, 220));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SENTINEL_CONFIG_INVALID_JSON", message.slice(0, 220));
  }

  return {
    config: buildCanonicalSentinelEyeConfig(parseSentinelEyeConfig(parsed)),
    configPath: resolvedPath,
    source: "file"
  };
}

export async function writeSentinelEyeConfig(options: {
  config: SentinelEyeConfig;
  configPath?: string;
  cwd?: string;
}): Promise<string> {
  const resolvedPath = resolveSentinelEyeConfigPath({
    configPath: options.configPath,
    cwd: options.cwd
  });

  const validated = parseSentinelEyeConfig(options.config);
  const serialized = serializeSentinelEyeConfig(validated);

  try {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, serialized, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SENTINEL_CONFIG_WRITE", message.slice(0, 220));
  }

  return resolvedPath;
}
