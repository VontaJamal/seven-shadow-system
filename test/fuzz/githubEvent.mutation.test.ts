import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { GuardPolicySchema, runSevenShadowSystem } from "../../src/sevenShadowSystem";

interface FuzzProfile {
  numRuns: number;
  maxSkipsPerRun: number;
  seed?: number;
  maxPayloadBytes: number;
  maxRuntimeMs: number;
}

function loadFuzzProfile(): FuzzProfile {
  const filePath = path.join(process.cwd(), "config", "fuzz-profile.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FuzzProfile>;

  return {
    numRuns: raw.numRuns ?? 100,
    maxSkipsPerRun: raw.maxSkipsPerRun ?? 200,
    seed: raw.seed,
    maxPayloadBytes: raw.maxPayloadBytes ?? 1000000,
    maxRuntimeMs: raw.maxRuntimeMs ?? 15000
  };
}

function resolveSeed(profile: FuzzProfile): number | undefined {
  const fromEnv = process.env.FAST_CHECK_SEED;
  if (!fromEnv) {
    return profile.seed;
  }

  const parsed = Number.parseInt(fromEnv, 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid FAST_CHECK_SEED '${fromEnv}'`);
  }

  return parsed;
}

const profile = loadFuzzProfile();
const seed = resolveSeed(profile);

const fuzzPolicy = GuardPolicySchema.parse({
  version: 2,
  enforcement: "block",
  blockBotAuthors: true,
  blockedAuthors: [],
  allowedAuthors: [],
  scanPrBody: true,
  scanReviewBody: true,
  scanCommentBody: true,
  maxAiScore: 0.7,
  disclosureTag: "[AI-ASSISTED]",
  disclosureRequiredScore: 0.5,
  runtime: {
    failOnUnsupportedEvent: true,
    failOnMalformedPayload: true,
    maxBodyChars: 12000,
    maxTargets: 25,
    maxEventBytes: 1000000
  },
  report: {
    includeBodies: false,
    redactionMode: "hash"
  },
  approvals: {
    minHumanApprovals: 0,
    fetchTimeoutMs: 10000,
    maxPages: 10,
    retry: {
      enabled: true,
      maxAttempts: 3,
      baseDelayMs: 5,
      maxDelayMs: 20,
      jitterRatio: 0,
      retryableStatusCodes: [429, 500, 502, 503, 504]
    }
  },
  rules: [
    {
      name: "explicit-ai-disclaimer",
      pattern: "as an ai language model",
      action: "block"
    },
    {
      name: "template-signal",
      pattern: "great work",
      action: "score",
      weight: 0.25
    }
  ]
});

const eventNameArb = fc.constantFrom(
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
  "push",
  "schedule"
);

test("fuzz: mutated events never crash and always produce a valid decision domain", async () => {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "seven-shadow-fuzz-"));
  const policyPath = path.join(tempDir, "policy.json");
  const eventPath = path.join(tempDir, "event.json");
  const reportPath = path.join(tempDir, "report.json");

  const originalLog = console.log;
  console.log = () => {};

  try {
    await fsPromises.writeFile(policyPath, `${JSON.stringify(fuzzPolicy, null, 2)}\n`, "utf8");

    await fc.assert(
      fc.asyncProperty(eventNameArb, fc.jsonValue(), async (eventName, payload) => {
        const serialized = `${JSON.stringify(payload)}\n`;
        if (Buffer.byteLength(serialized, "utf8") > profile.maxPayloadBytes) {
          return;
        }

        await fsPromises.writeFile(eventPath, serialized, "utf8");

        const exitCode = await runSevenShadowSystem(
          [
            "--policy",
            policyPath,
            "--event",
            eventPath,
            "--event-name",
            eventName,
            "--report",
            reportPath,
            "--redact"
          ],
          { ...process.env, GITHUB_TOKEN: "" }
        );

        assert.ok(exitCode === 0 || exitCode === 1);

        const report = JSON.parse(await fsPromises.readFile(reportPath, "utf8")) as {
          decision: string;
          findings: Array<{ remediation?: string }>;
        };

        assert.ok(report.decision === "pass" || report.decision === "warn" || report.decision === "block");

        for (const finding of report.findings) {
          assert.ok(typeof finding.remediation === "string" && finding.remediation.length > 0);
        }
      }),
      {
        numRuns: profile.numRuns,
        maxSkipsPerRun: profile.maxSkipsPerRun,
        interruptAfterTimeLimit: profile.maxRuntimeMs,
        ...(seed !== undefined ? { seed } : {})
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Fuzz test failed (seed=${String(seed ?? "auto")}): ${message}`);
  } finally {
    console.log = originalLog;
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  }
});
