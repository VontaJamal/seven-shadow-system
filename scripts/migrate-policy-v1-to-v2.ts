import fs from "node:fs/promises";
import path from "node:path";

interface LegacyPolicy {
  version: 1;
  enforcement: "block" | "warn";
  blockBotAuthors: boolean;
  blockedAuthors: string[];
  allowedAuthors: string[];
  scanPrBody: boolean;
  scanReviewBody: boolean;
  scanCommentBody: boolean;
  maxAiScore: number;
  disclosureTag: string;
  disclosureRequiredScore: number;
  minHumanApprovals: number;
  rules: Array<{
    name: string;
    pattern: string;
    action: "block" | "score";
    weight?: number;
  }>;
}

function toV2(policy: LegacyPolicy) {
  return {
    version: 2,
    enforcement: policy.enforcement,
    blockBotAuthors: policy.blockBotAuthors,
    blockedAuthors: policy.blockedAuthors,
    allowedAuthors: policy.allowedAuthors,
    scanPrBody: policy.scanPrBody,
    scanReviewBody: policy.scanReviewBody,
    scanCommentBody: policy.scanCommentBody,
    maxAiScore: policy.maxAiScore,
    disclosureTag: policy.disclosureTag,
    disclosureRequiredScore: policy.disclosureRequiredScore,
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
      minHumanApprovals: policy.minHumanApprovals,
      fetchTimeoutMs: 10000,
      maxPages: 10,
      retry: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 2500,
        jitterRatio: 0.2,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      }
    },
    rules: policy.rules
  };
}

async function run(): Promise<void> {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] ?? path.join(path.dirname(inputPath ?? ""), `${path.parse(inputPath ?? "policy").name}.v2.json`);

  if (!inputPath) {
    throw new Error("Usage: node dist/scripts/migrate-policy-v1-to-v2.js <input-policy-v1.json> [output-policy-v2.json]");
  }

  const raw = await fs.readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw) as LegacyPolicy;

  if (parsed.version !== 1) {
    throw new Error(`Expected version 1 policy, received version '${String((parsed as { version?: unknown }).version)}'`);
  }

  const migrated = toV2(parsed);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");

  console.log(`Migrated policy written to ${outputPath}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Policy migration failed: ${message}`);
  process.exit(1);
});
