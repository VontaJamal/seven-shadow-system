import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSevenShadowSystem } from "../src/sevenShadowSystem";

type Decision = "pass" | "warn" | "block";

interface ConformanceManifest {
  schemaVersion: number;
  cases: string[];
}

interface ConformanceCase {
  id: string;
  description: string;
  eventName: string;
  event: string;
  policy: string;
  expectedDecision?: Decision;
  expectedFindingCodes?: string[];
  expectedErrorContains?: string;
  githubToken?: string;
}

interface GuardReportLike {
  decision: Decision;
  findings: Array<{ code: string; remediation?: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseManifest(raw: unknown): ConformanceManifest {
  if (!isRecord(raw)) {
    throw new Error("E_CONFORMANCE_MANIFEST: manifest must be an object");
  }

  const schemaVersion = raw.schemaVersion;
  const cases = raw.cases;

  if (schemaVersion !== 1) {
    throw new Error(`E_CONFORMANCE_MANIFEST: unsupported schemaVersion '${String(schemaVersion)}'`);
  }

  if (!Array.isArray(cases) || !cases.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("E_CONFORMANCE_MANIFEST: cases must be a non-empty string array");
  }

  return {
    schemaVersion,
    cases
  };
}

function parseCase(raw: unknown, filePath: string): ConformanceCase {
  if (!isRecord(raw)) {
    throw new Error(`E_CONFORMANCE_CASE: ${filePath} must be an object`);
  }

  const requiredFields = ["id", "description", "eventName", "event", "policy"] as const;
  for (const field of requiredFields) {
    if (typeof raw[field] !== "string" || raw[field].length === 0) {
      throw new Error(`E_CONFORMANCE_CASE: ${filePath} missing string field '${field}'`);
    }
  }

  const expectedDecision = raw.expectedDecision;
  const expectedErrorContains = raw.expectedErrorContains;

  if (expectedDecision !== undefined && expectedDecision !== "pass" && expectedDecision !== "warn" && expectedDecision !== "block") {
    throw new Error(`E_CONFORMANCE_CASE: ${filePath} has invalid expectedDecision`);
  }

  if (expectedErrorContains !== undefined && (typeof expectedErrorContains !== "string" || expectedErrorContains.length === 0)) {
    throw new Error(`E_CONFORMANCE_CASE: ${filePath} has invalid expectedErrorContains`);
  }

  if (!expectedDecision && !expectedErrorContains) {
    throw new Error(`E_CONFORMANCE_CASE: ${filePath} must set expectedDecision or expectedErrorContains`);
  }

  if (expectedDecision && expectedErrorContains) {
    throw new Error(`E_CONFORMANCE_CASE: ${filePath} cannot set both expectedDecision and expectedErrorContains`);
  }

  if (raw.expectedFindingCodes !== undefined) {
    const findingCodes = raw.expectedFindingCodes;
    if (!Array.isArray(findingCodes) || !findingCodes.every((item) => typeof item === "string" && item.length > 0)) {
      throw new Error(`E_CONFORMANCE_CASE: ${filePath} expectedFindingCodes must be string[]`);
    }
  }

  if (raw.githubToken !== undefined && typeof raw.githubToken !== "string") {
    throw new Error(`E_CONFORMANCE_CASE: ${filePath} githubToken must be a string`);
  }

  return {
    id: raw.id as string,
    description: raw.description as string,
    eventName: raw.eventName as string,
    event: raw.event as string,
    policy: raw.policy as string,
    expectedDecision: expectedDecision as Decision | undefined,
    expectedFindingCodes: raw.expectedFindingCodes as string[] | undefined,
    expectedErrorContains: expectedErrorContains as string | undefined,
    githubToken: raw.githubToken as string | undefined
  };
}

async function loadJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function runCase(
  rootDir: string,
  tempDir: string,
  casePath: string
): Promise<{ id: string; ok: boolean; detail: string }> {
  const absoluteCasePath = path.resolve(rootDir, casePath);
  const parsedCase = parseCase(await loadJson(absoluteCasePath), absoluteCasePath);

  const eventPath = path.resolve(rootDir, parsedCase.event);
  const policyPath = path.resolve(rootDir, parsedCase.policy);
  const reportPath = path.join(tempDir, `${parsedCase.id}.report.json`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_TOKEN: parsedCase.githubToken ?? ""
  };

  try {
    const originalLog = console.log;
    console.log = () => {};

    try {
      await runSevenShadowSystem(
        [
          "--policy",
          policyPath,
          "--event",
          eventPath,
          "--event-name",
          parsedCase.eventName,
          "--report",
          reportPath,
          "--redact"
        ],
        env
      );
    } finally {
      console.log = originalLog;
    }

    if (parsedCase.expectedErrorContains) {
      return {
        id: parsedCase.id,
        ok: false,
        detail: `expected error containing '${parsedCase.expectedErrorContains}' but run succeeded`
      };
    }

    const report = (await loadJson(reportPath)) as GuardReportLike;

    if (report.decision !== parsedCase.expectedDecision) {
      return {
        id: parsedCase.id,
        ok: false,
        detail: `decision mismatch: expected ${parsedCase.expectedDecision}, got ${report.decision}`
      };
    }

    const codes = new Set(report.findings.map((item) => item.code));
    const missingCodes = (parsedCase.expectedFindingCodes ?? []).filter((code) => !codes.has(code));

    if (missingCodes.length > 0) {
      return {
        id: parsedCase.id,
        ok: false,
        detail: `missing expected finding codes: ${missingCodes.join(", ")}`
      };
    }

    const missingRemediation = report.findings.filter((finding) => !finding.remediation || finding.remediation.length === 0);
    if (missingRemediation.length > 0) {
      return {
        id: parsedCase.id,
        ok: false,
        detail: `findings without remediation text: ${missingRemediation.map((item) => item.code).join(", ")}`
      };
    }

    return {
      id: parsedCase.id,
      ok: true,
      detail: "passed"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!parsedCase.expectedErrorContains) {
      return {
        id: parsedCase.id,
        ok: false,
        detail: `unexpected error: ${message}`
      };
    }

    if (!message.includes(parsedCase.expectedErrorContains)) {
      return {
        id: parsedCase.id,
        ok: false,
        detail: `error mismatch: expected '${parsedCase.expectedErrorContains}', got '${message}'`
      };
    }

    return {
      id: parsedCase.id,
      ok: true,
      detail: "passed (expected runtime error)"
    };
  }
}

async function run(): Promise<void> {
  const rootDir = path.join(process.cwd(), "conformance");
  const manifestPath = path.join(rootDir, "manifest.json");
  const manifest = parseManifest(await loadJson(manifestPath));

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-conformance-"));
  const failures: Array<{ id: string; detail: string }> = [];

  try {
    for (const casePath of manifest.cases) {
      const result = await runCase(rootDir, tempDir, casePath);
      if (result.ok) {
        console.log(`PASS ${result.id}: ${result.detail}`);
      } else {
        console.error(`FAIL ${result.id}: ${result.detail}`);
        failures.push({ id: result.id, detail: result.detail });
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    throw new Error(`E_CONFORMANCE_FAILED: ${failures.length} case(s) failed`);
  }

  console.log(`Conformance passed: ${manifest.cases.length} case(s)`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Conformance failed: ${message}`);
  process.exit(1);
});
