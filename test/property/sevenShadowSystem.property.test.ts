import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { GuardPolicySchema, evaluateTargets, type ReviewTarget } from "../../src/sevenShadowSystem";

interface FuzzProfile {
  numRuns: number;
  maxSkipsPerRun: number;
  seed?: number;
  maxRuntimeMs: number;
}

function loadFuzzProfile(): FuzzProfile {
  const filePath = path.join(process.cwd(), "config", "fuzz-profile.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<FuzzProfile>;

  return {
    numRuns: raw.numRuns ?? 100,
    maxSkipsPerRun: raw.maxSkipsPerRun ?? 200,
    seed: raw.seed,
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

const propertyPolicy = GuardPolicySchema.parse({
  version: 2,
  enforcement: "block",
  blockBotAuthors: true,
  blockedAuthors: ["blocked-user"],
  allowedAuthors: [],
  scanPrBody: true,
  scanReviewBody: true,
  scanCommentBody: true,
  maxAiScore: 0.6,
  disclosureTag: "[AI-ASSISTED]",
  disclosureRequiredScore: 0.4,
  runtime: {
    failOnUnsupportedEvent: true,
    failOnMalformedPayload: true,
    maxBodyChars: 4000,
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
      baseDelayMs: 250,
      maxDelayMs: 2500,
      jitterRatio: 0,
      retryableStatusCodes: [429, 500, 502, 503, 504]
    }
  },
  rules: [
    {
      name: "explicit-disclaimer",
      pattern: "as an ai language model",
      action: "block"
    },
    {
      name: "generic-template",
      pattern: "great work",
      action: "score",
      weight: 0.3
    }
  ]
});

const targetArb: fc.Arbitrary<ReviewTarget> = fc.record({
  source: fc.constantFrom<ReviewTarget["source"]>("pr_body", "review", "comment"),
  referenceId: fc.string({ minLength: 1, maxLength: 30 }),
  authorLogin: fc.string({ minLength: 1, maxLength: 20 }),
  authorType: fc.constantFrom<ReviewTarget["authorType"]>("User", "Bot", "Unknown"),
  body: fc.string({ maxLength: 300 })
});

test("property: evaluateTargets is deterministic with bounded score and remediation text", async () => {
  try {
    await fc.assert(
      fc.property(fc.array(targetArb, { maxLength: 20 }), (targets) => {
        const first = evaluateTargets(propertyPolicy, targets);
        const second = evaluateTargets(propertyPolicy, JSON.parse(JSON.stringify(targets)) as ReviewTarget[]);

        assert.deepEqual(second, first);
        assert.ok(first.highestScore >= 0 && first.highestScore <= 1);

        for (const finding of first.findings) {
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
    throw new Error(`Property test failed (seed=${String(seed ?? "auto")}): ${message}`);
  }
});
