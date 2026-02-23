import fs from "node:fs/promises";
import path from "node:path";

interface ScorecardCheck {
  name?: string;
  score?: number;
}

interface SecurityGatesConfig {
  scorecard: {
    minimumScore: number;
    perCheckMinimums?: Record<string, number>;
  };
}

interface ParsedArgs {
  configPath: string;
  resultsPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    configPath: path.join("config", "security-gates.json"),
    resultsPath: "scorecard-results.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";

    if (token === "--config") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --config");
      }
      parsed.configPath = value;
      i += 1;
      continue;
    }

    if (token === "--results") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --results");
      }
      parsed.resultsPath = value;
      i += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`E_UNKNOWN_ARG: ${token}`);
    }
  }

  return parsed;
}

async function loadJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractResultCandidate(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) {
    return raw;
  }

  if (Array.isArray(raw)) {
    const candidate = raw.find((item) => isRecord(item) && Array.isArray((item as { checks?: unknown }).checks));
    if (candidate && isRecord(candidate)) {
      return candidate;
    }
  }

  throw new Error("E_SCORECARD_RESULTS_UNSUPPORTED: cannot locate a scorecard result object");
}

function extractChecks(raw: Record<string, unknown>): ScorecardCheck[] {
  const direct = raw.checks;
  if (Array.isArray(direct)) {
    return direct as ScorecardCheck[];
  }

  const nestedResults = raw.results;
  if (Array.isArray(nestedResults)) {
    const nested = nestedResults.find((item) => isRecord(item) && Array.isArray((item as { checks?: unknown }).checks));
    if (nested && isRecord(nested) && Array.isArray(nested.checks)) {
      return nested.checks as ScorecardCheck[];
    }
  }

  throw new Error("E_SCORECARD_RESULTS_UNSUPPORTED: checks array missing from scorecard output");
}

function extractOverallScore(raw: Record<string, unknown>, checks: ScorecardCheck[]): number {
  const directScore = toNumber(raw.score);
  if (directScore !== null) {
    return directScore;
  }

  const nestedResults = raw.results;
  if (Array.isArray(nestedResults)) {
    const nested = nestedResults.find((item) => isRecord(item) && typeof item.score === "number");
    if (nested && isRecord(nested)) {
      const nestedScore = toNumber(nested.score);
      if (nestedScore !== null) {
        return nestedScore;
      }
    }
  }

  const scoredChecks = checks
    .map((item) => toNumber(item.score))
    .filter((score): score is number => score !== null);

  if (scoredChecks.length === 0) {
    throw new Error("E_SCORECARD_RESULTS_UNSUPPORTED: no numeric overall score or check scores found");
  }

  const sum = scoredChecks.reduce((acc, value) => acc + value, 0);
  return sum / scoredChecks.length;
}

function parseConfig(raw: unknown): SecurityGatesConfig {
  if (!isRecord(raw) || !isRecord(raw.scorecard)) {
    throw new Error("E_SECURITY_GATES_CONFIG: missing scorecard section");
  }

  const minimumScore = toNumber(raw.scorecard.minimumScore);
  if (minimumScore === null) {
    throw new Error("E_SECURITY_GATES_CONFIG: scorecard.minimumScore must be numeric");
  }

  let perCheckMinimums: Record<string, number> | undefined;
  if (raw.scorecard.perCheckMinimums !== undefined) {
    if (!isRecord(raw.scorecard.perCheckMinimums)) {
      throw new Error("E_SECURITY_GATES_CONFIG: scorecard.perCheckMinimums must be an object");
    }

    perCheckMinimums = {};
    for (const [checkName, value] of Object.entries(raw.scorecard.perCheckMinimums)) {
      const numeric = toNumber(value);
      if (numeric === null) {
        throw new Error(`E_SECURITY_GATES_CONFIG: per-check minimum for '${checkName}' must be numeric`);
      }
      perCheckMinimums[checkName] = numeric;
    }
  }

  return {
    scorecard: {
      minimumScore,
      perCheckMinimums
    }
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const configRaw = await loadJson(args.configPath);
  const scorecardRaw = await loadJson(args.resultsPath);

  const config = parseConfig(configRaw);
  const scorecardResult = extractResultCandidate(scorecardRaw);
  const checks = extractChecks(scorecardResult);
  const overallScore = extractOverallScore(scorecardResult, checks);

  const checkScores = new Map<string, number>();
  for (const check of checks) {
    if (typeof check.name !== "string") {
      continue;
    }

    const score = toNumber(check.score);
    if (score === null) {
      continue;
    }

    checkScores.set(check.name, score);
  }

  const availableChecks = [...checkScores.keys()].sort((a, b) => a.localeCompare(b));

  const failures: string[] = [];

  if (overallScore < config.scorecard.minimumScore) {
    failures.push(
      `overall score ${overallScore.toFixed(2)} is below minimum ${config.scorecard.minimumScore.toFixed(2)}`
    );
  }

  for (const [checkName, minimum] of Object.entries(config.scorecard.perCheckMinimums ?? {})) {
    const actual = checkScores.get(checkName);

    if (actual === undefined) {
      failures.push(
        `required check '${checkName}' missing from scorecard results (available: ${availableChecks.join(", ") || "<none>"})`
      );
      continue;
    }

    if (actual < minimum) {
      failures.push(`check '${checkName}' score ${actual.toFixed(2)} is below minimum ${minimum.toFixed(2)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`E_SCORECARD_GATE_FAILED: ${failures.join("; ")}`);
  }

  console.log(`Scorecard gate passed: overall=${overallScore.toFixed(2)} minimum=${config.scorecard.minimumScore.toFixed(2)}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Scorecard evaluation failed: ${message}`);
  process.exit(1);
});
