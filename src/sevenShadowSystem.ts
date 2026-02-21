import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import safeRegex from "safe-regex2";
import { z } from "zod";

import {
  DEFAULT_POLICY_OVERRIDE_CONSTRAINTS,
  mergePoliciesWithConstraints,
  parseOverrideConstraints,
  parsePolicyBundle,
  parsePolicyTrustStore,
  sha256Hex,
  toReplayComparable,
  verifyPolicyBundleWithTrustStore,
  verifyPolicyBundle,
  type PolicyOverrideConstraints
} from "./policyGovernance";
import { githubProvider } from "./providers/github";
import { ProviderApprovalError } from "./providers/types";
import type { ProviderAdapter, ProviderReviewTarget, PullContext } from "./providers/types";

const GuardRuleSchema = z.object({
  name: z.string().min(1),
  pattern: z.string().min(1),
  action: z.enum(["block", "score"]),
  weight: z.number().min(0).max(1).default(0.25)
});

const GuardRuntimeSchema = z.object({
  failOnUnsupportedEvent: z.boolean().default(true),
  failOnMalformedPayload: z.boolean().default(true),
  maxBodyChars: z.number().int().min(32).max(200_000).default(12_000),
  maxTargets: z.number().int().min(1).max(500).default(25),
  maxEventBytes: z.number().int().min(1_024).max(20_000_000).default(1_000_000)
});

const GuardReportSchema = z.object({
  includeBodies: z.boolean().default(false),
  redactionMode: z.enum(["none", "partial", "hash"]).default("hash")
});

const GuardApprovalsRetrySchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  baseDelayMs: z.number().int().min(1).max(60_000).default(250),
  maxDelayMs: z.number().int().min(1).max(300_000).default(2_500),
  jitterRatio: z.number().min(0).max(1).default(0.2),
  retryableStatusCodes: z.array(z.number().int().min(100).max(599)).default([429, 500, 502, 503, 504])
});

const GuardApprovalsSchema = z.object({
  minHumanApprovals: z.number().int().min(0).default(1),
  fetchTimeoutMs: z.number().int().min(250).max(120_000).default(10_000),
  maxPages: z.number().int().min(1).max(50).default(10),
  retry: GuardApprovalsRetrySchema.default({})
});

function validateDistinctAuthorLists(
  blockedAuthors: string[],
  allowedAuthors: string[],
  ctx: z.RefinementCtx
): void {
  const blocked = new Set(blockedAuthors.map((item) => item.trim().toLowerCase()));
  const overlap = allowedAuthors
    .map((item) => item.trim().toLowerCase())
    .filter((item) => blocked.has(item));

  if (overlap.length === 0) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["allowedAuthors"],
    message: `E_POLICY_AUTHOR_OVERLAP: allowedAuthors overlaps blockedAuthors (${overlap.join(", ")})`
  });
}

const GuardPolicyV2SchemaBase = z.object({
  version: z.literal(2),
  enforcement: z.enum(["block", "warn"]).default("block"),
  blockBotAuthors: z.boolean().default(true),
  blockedAuthors: z.array(z.string().min(1)).default([]),
  allowedAuthors: z.array(z.string().min(1)).default([]),
  scanPrBody: z.boolean().default(true),
  scanReviewBody: z.boolean().default(true),
  scanCommentBody: z.boolean().default(true),
  maxAiScore: z.number().min(0).max(1).default(0.65),
  disclosureTag: z.string().min(1).default("[AI-ASSISTED]"),
  disclosureRequiredScore: z.number().min(0).max(1).default(0.45),
  runtime: GuardRuntimeSchema,
  report: GuardReportSchema,
  approvals: GuardApprovalsSchema,
  rules: z.array(GuardRuleSchema).min(1)
});

export const GuardPolicySchema = GuardPolicyV2SchemaBase.superRefine((policy, ctx) => {
  validateDistinctAuthorLists(policy.blockedAuthors, policy.allowedAuthors, ctx);
});

const GuardPolicyV1Schema = z.object({
  version: z.literal(1),
  enforcement: z.enum(["block", "warn"]).default("block"),
  blockBotAuthors: z.boolean().default(true),
  blockedAuthors: z.array(z.string().min(1)).default([]),
  allowedAuthors: z.array(z.string().min(1)).default([]),
  scanPrBody: z.boolean().default(true),
  scanReviewBody: z.boolean().default(true),
  scanCommentBody: z.boolean().default(true),
  maxAiScore: z.number().min(0).max(1).default(0.65),
  disclosureTag: z.string().min(1).default("[AI-ASSISTED]"),
  disclosureRequiredScore: z.number().min(0).max(1).default(0.45),
  minHumanApprovals: z.number().int().min(0).default(1),
  rules: z.array(GuardRuleSchema).min(1)
}).superRefine((policy, ctx) => {
  validateDistinctAuthorLists(policy.blockedAuthors, policy.allowedAuthors, ctx);
});

export type GuardPolicy = z.infer<typeof GuardPolicySchema>;
type GuardPolicyV1 = z.infer<typeof GuardPolicyV1Schema>;
type GuardRule = z.infer<typeof GuardRuleSchema>;
type ReportFormat = "json" | "markdown" | "sarif" | "all";

interface ParsedArgs {
  policyPath: string;
  policyBundlePath?: string;
  policySchemaPath?: string;
  policyTrustStorePath?: string;
  policyPublicKeySpecs: string[];
  orgPolicyPath?: string;
  localPolicyPath?: string;
  overrideConstraintsPath?: string;
  replayReportPath?: string;
  eventPath?: string;
  eventName?: string;
  reportPath?: string;
  provider: string;
  reportFormat: ReportFormat;
  failOnUnsupportedEvent?: boolean;
  maxBodyChars?: number;
  maxEventBytes?: number;
  redact: boolean;
}

interface NormalizedPolicyResult {
  policy: GuardPolicy;
  inputVersion: 1 | 2;
}

interface CompiledRule extends GuardRule {
  regex: RegExp;
}

interface HumanApprovalsSummary {
  required: number;
  actual: number | null;
  checked: boolean;
}

export interface ReviewTarget extends ProviderReviewTarget {}

export interface GuardFinding {
  code: string;
  severity: "block" | "warn";
  message: string;
  remediation?: string;
  targetReferenceId?: string;
  details?: Record<string, unknown>;
}

export interface TargetEvaluation {
  target: ReviewTarget;
  aiScore: number;
  matchedRules: string[];
  findings: GuardFinding[];
}

export interface GuardResult {
  targetEvaluations: TargetEvaluation[];
  findings: GuardFinding[];
  highestScore: number;
}

export interface ReportTargetSummary {
  source: ReviewTarget["source"];
  referenceId: string;
  authorLogin: string;
  authorType: ReviewTarget["authorType"];
  aiScore: number;
  matchedRules: string[];
  findingCodes: string[];
  bodyHash: string;
  body?: string;
  bodyExcerpt?: string;
}

export interface AccessibilitySummary {
  plainLanguageDecision: string;
  statusWords: {
    pass: string;
    warn: string;
    block: string;
  };
  nonColorStatusSignals: boolean;
  screenReaderFriendly: boolean;
  cognitiveLoad: "low" | "medium";
}

export interface GuardReportV2 {
  schemaVersion: 2;
  timestamp: string;
  provider: string;
  eventName: string;
  policyPath: string;
  policyVersion: 1 | 2;
  enforcement: GuardPolicy["enforcement"];
  decision: "pass" | "warn" | "block";
  targetsScanned: number;
  highestAiScore: number;
  humanApprovals: HumanApprovalsSummary;
  findings: GuardFinding[];
  targets: ReportTargetSummary[];
  evidenceHashes: Record<string, string>;
  accessibilitySummary: AccessibilitySummary;
  generatedReports?: string[];
}

const PROVIDERS: Record<string, ProviderAdapter> = {
  github: githubProvider
};

function parseBooleanStrict(value: string, optionName: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`E_INVALID_ARG_BOOLEAN: ${optionName} must be true or false`);
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`E_INVALID_ARG_INT: ${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseReportFormat(value: string): ReportFormat {
  if (value === "json" || value === "markdown" || value === "sarif" || value === "all") {
    return value;
  }

  throw new Error("E_INVALID_REPORT_FORMAT: expected json|markdown|sarif|all");
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    policyPath: "config/seven-shadow-system.policy.json",
    policyPublicKeySpecs: [],
    provider: "github",
    reportFormat: "json",
    redact: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";

    if (token === "--policy") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --policy");
      }
      args.policyPath = value;
      i += 1;
      continue;
    }

    if (token === "--policy-bundle") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --policy-bundle");
      }
      args.policyBundlePath = value;
      i += 1;
      continue;
    }

    if (token === "--policy-schema") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --policy-schema");
      }
      args.policySchemaPath = value;
      i += 1;
      continue;
    }

    if (token === "--policy-public-key") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --policy-public-key");
      }
      args.policyPublicKeySpecs.push(value);
      i += 1;
      continue;
    }

    if (token === "--policy-trust-store") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --policy-trust-store");
      }
      args.policyTrustStorePath = value;
      i += 1;
      continue;
    }

    if (token === "--org-policy") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --org-policy");
      }
      args.orgPolicyPath = value;
      i += 1;
      continue;
    }

    if (token === "--local-policy") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --local-policy");
      }
      args.localPolicyPath = value;
      i += 1;
      continue;
    }

    if (token === "--override-constraints") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --override-constraints");
      }
      args.overrideConstraintsPath = value;
      i += 1;
      continue;
    }

    if (token === "--event") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --event");
      }
      args.eventPath = value;
      i += 1;
      continue;
    }

    if (token === "--replay-report") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --replay-report");
      }
      args.replayReportPath = value;
      i += 1;
      continue;
    }

    if (token === "--event-name") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --event-name");
      }
      args.eventName = value;
      i += 1;
      continue;
    }

    if (token === "--report") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --report");
      }
      args.reportPath = value;
      i += 1;
      continue;
    }

    if (token === "--provider") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --provider");
      }
      args.provider = value;
      i += 1;
      continue;
    }

    if (token === "--report-format") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --report-format");
      }
      args.reportFormat = parseReportFormat(value);
      i += 1;
      continue;
    }

    if (token === "--fail-on-unsupported-event") {
      const nextToken = argv[i + 1];
      if (!nextToken || nextToken.startsWith("--")) {
        args.failOnUnsupportedEvent = true;
      } else {
        args.failOnUnsupportedEvent = parseBooleanStrict(nextToken, "--fail-on-unsupported-event");
        i += 1;
      }
      continue;
    }

    if (token === "--max-body-chars") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --max-body-chars");
      }
      args.maxBodyChars = parsePositiveInt(value, "--max-body-chars");
      i += 1;
      continue;
    }

    if (token === "--max-event-bytes") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --max-event-bytes");
      }
      args.maxEventBytes = parsePositiveInt(value, "--max-event-bytes");
      i += 1;
      continue;
    }

    if (token === "--redact") {
      args.redact = true;
      continue;
    }

    if (token === "--no-redact") {
      args.redact = false;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`E_UNKNOWN_ARG: ${token}`);
    }
  }

  if (args.policyBundlePath && args.orgPolicyPath) {
    throw new Error("E_ARG_CONFLICT: --policy-bundle cannot be used with --org-policy");
  }

  if (args.policyBundlePath && args.localPolicyPath) {
    throw new Error("E_ARG_CONFLICT: --policy-bundle cannot be used with --local-policy");
  }

  if (!args.policyBundlePath && args.policyPublicKeySpecs.length > 0) {
    throw new Error("E_ARG_CONFLICT: --policy-public-key requires --policy-bundle");
  }

  if (!args.policyBundlePath && args.policyTrustStorePath) {
    throw new Error("E_ARG_CONFLICT: --policy-trust-store requires --policy-bundle");
  }

  if (!args.policyBundlePath && args.policySchemaPath) {
    throw new Error("E_ARG_CONFLICT: --policy-schema requires --policy-bundle");
  }

  if (args.policyTrustStorePath && args.policyPublicKeySpecs.length > 0) {
    throw new Error("E_ARG_CONFLICT: --policy-trust-store cannot be used with --policy-public-key");
  }

  if (!args.orgPolicyPath && args.localPolicyPath) {
    throw new Error("E_ARG_CONFLICT: --local-policy requires --org-policy");
  }

  if (!args.orgPolicyPath && args.overrideConstraintsPath) {
    throw new Error("E_ARG_CONFLICT: --override-constraints requires --org-policy");
  }

  return args;
}

function normalizeLogin(value: string): string {
  return value.trim().toLowerCase();
}

function toLowerSet(values: string[]): Set<string> {
  return new Set(values.map((value) => normalizeLogin(value)));
}

function withRemediation(finding: GuardFinding): GuardFinding {
  if (finding.remediation) {
    return finding;
  }

  const remediationByCode: Record<string, string> = {
    GUARD_UNSUPPORTED_EVENT: "Use a supported pull request review event or set runtime.failOnUnsupportedEvent to false.",
    GUARD_MALFORMED_EVENT: "Fix event payload shape or disable runtime.failOnMalformedPayload for this environment.",
    GUARD_EVENT_TOO_LARGE: "Reduce event payload size or increase runtime.maxEventBytes with maintainer review.",
    GUARD_EVENT_PARSE_ERROR: "Ensure event payload is valid JSON and encoded as UTF-8 text.",
    GUARD_BODY_TRUNCATED: "Increase runtime.maxBodyChars if the project intentionally uses longer review text.",
    GUARD_TARGET_LIMIT_REACHED: "Increase runtime.maxTargets or split large review batches into smaller checks.",
    GUARD_BLOCKED_AUTHOR: "Remove the author from blockedAuthors or require a different reviewer.",
    GUARD_BOT_BLOCKED: "Use human-authored reviews or disable blockBotAuthors where policy permits.",
    GUARD_RULE_BLOCK: "Revise the review content or adjust the blocking rule pattern.",
    GUARD_DISCLOSURE_REQUIRED: "Add the configured disclosure tag to high AI-score content.",
    GUARD_AI_SCORE_EXCEEDED: "Reduce AI-template language or raise maxAiScore with maintainer approval.",
    GUARD_PULL_CONTEXT_MISSING: "Ensure the workflow is triggered by pull-request related events with repository context.",
    GUARD_APPROVALS_UNVERIFIED: "Provide GITHUB_TOKEN with pull request read scope so approvals can be verified.",
    GUARD_APPROVALS_RATE_LIMITED: "Increase approval retry capacity or wait for GitHub API rate limits to reset before retrying.",
    GUARD_APPROVALS_TIMEOUT: "Increase approvals.fetchTimeoutMs or review provider/network latency before rerunning.",
    GUARD_APPROVALS_RETRY_EXHAUSTED: "Tune approvals.retry.* settings or reduce provider pressure, then retry verification.",
    GUARD_APPROVALS_FETCH_ERROR: "Retry later or verify GitHub API/network access and token permissions.",
    GUARD_HUMAN_APPROVALS: "Collect additional human approvals or lower approvals.minHumanApprovals.",
    GUARD_REPLAY_MISMATCH: "Re-run with the same policy/event inputs or refresh the replay baseline when intended behavior changes."
  };

  return {
    ...finding,
    remediation: remediationByCode[finding.code] ?? "Review policy and payload details for this finding."
  };
}

function getProvider(name: string): ProviderAdapter {
  const provider = PROVIDERS[name.trim().toLowerCase()];
  if (!provider) {
    throw new Error(`E_PROVIDER_UNSUPPORTED: '${name}'`);
  }

  return provider;
}

interface ResolvedPolicyMaterial {
  policyRaw: unknown;
  policyPathForReport: string;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`E_POLICY_INVALID_OBJECT: ${label} must be a JSON object`);
  }

  return value as Record<string, unknown>;
}

async function loadJsonFileOptional(filePath: string): Promise<unknown | null> {
  try {
    return await loadJsonFile(filePath);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function parseKeySpec(value: string): { keyId: string; keyPath: string } {
  const index = value.indexOf("=");
  if (index <= 0 || index >= value.length - 1) {
    throw new Error(`E_POLICY_BUNDLE_KEY_SPEC_INVALID: expected keyId=path, received '${value}'`);
  }

  const keyId = value.slice(0, index).trim();
  const keyPath = value.slice(index + 1).trim();

  if (!keyId || !keyPath) {
    throw new Error(`E_POLICY_BUNDLE_KEY_SPEC_INVALID: expected keyId=path, received '${value}'`);
  }

  return {
    keyId,
    keyPath
  };
}

async function loadTrustedPublicKeys(specs: string[]): Promise<Record<string, string>> {
  const keys: Record<string, string> = {};

  for (const spec of specs) {
    const parsed = parseKeySpec(spec);
    if (parsed.keyId in keys) {
      throw new Error(`E_POLICY_BUNDLE_KEY_DUPLICATE: duplicate keyId '${parsed.keyId}'`);
    }

    keys[parsed.keyId] = await fs.readFile(parsed.keyPath, "utf8");
  }

  return keys;
}

async function loadOverrideConstraints(args: ParsedArgs): Promise<PolicyOverrideConstraints> {
  if (!args.overrideConstraintsPath) {
    return DEFAULT_POLICY_OVERRIDE_CONSTRAINTS;
  }

  const raw = await loadJsonFile(args.overrideConstraintsPath);
  return parseOverrideConstraints(raw);
}

async function resolvePolicyMaterial(args: ParsedArgs): Promise<ResolvedPolicyMaterial> {
  if (args.policyBundlePath) {
    const bundleRaw = await loadJsonFile(args.policyBundlePath);
    const bundle = parsePolicyBundle(bundleRaw);
    const schemaPath = args.policySchemaPath ?? path.join(process.cwd(), "schemas", "policy-v2.schema.json");
    const schemaRaw = await fs.readFile(schemaPath, "utf8");

    if (args.policyTrustStorePath) {
      const trustStoreRaw = await loadJsonFile(args.policyTrustStorePath);
      const trustStore = parsePolicyTrustStore(trustStoreRaw);
      await verifyPolicyBundleWithTrustStore(bundle, trustStore, sha256Hex(schemaRaw));
    } else {
      if (args.policyPublicKeySpecs.length === 0) {
        throw new Error(
          "E_POLICY_BUNDLE_TRUST_REQUIRED: provide --policy-public-key keyId=path or --policy-trust-store <path>"
        );
      }

      const trustedPublicKeys = await loadTrustedPublicKeys(args.policyPublicKeySpecs);
      verifyPolicyBundle(bundle, trustedPublicKeys, sha256Hex(schemaRaw));
    }

    return {
      policyRaw: bundle.policy,
      policyPathForReport: args.policyBundlePath
    };
  }

  if (args.orgPolicyPath) {
    const orgRaw = await loadJsonFile(args.orgPolicyPath);
    const orgPolicy = asRecord(orgRaw, "--org-policy");

    const localPath = args.localPolicyPath ?? args.policyPath;
    const localRaw = await loadJsonFileOptional(localPath);
    const localPolicy = localRaw === null ? {} : asRecord(localRaw, "--local-policy");

    const constraints = await loadOverrideConstraints(args);
    const merged = mergePoliciesWithConstraints(orgPolicy, localPolicy, constraints);

    return {
      policyRaw: merged,
      policyPathForReport: `${args.orgPolicyPath} + ${localPath}`
    };
  }

  return {
    policyRaw: await loadJsonFile(args.policyPath),
    policyPathForReport: args.policyPath
  };
}

async function evaluateReplayFinding(report: GuardReportV2, replayReportPath: string): Promise<GuardFinding | null> {
  try {
    const replayRaw = await loadJsonFile(replayReportPath);
    const replayRecord = asRecord(replayRaw, "--replay-report");

    const expected = toReplayComparable(replayRecord);
    const actual = toReplayComparable(report as unknown as Record<string, unknown>);

    if (expected === actual) {
      return null;
    }

    return withRemediation({
      code: "GUARD_REPLAY_MISMATCH",
      severity: "block",
      message: "Replay baseline does not match deterministic guard output",
      details: {
        replayReportPath,
        expectedHash: sha256Hex(expected),
        actualHash: sha256Hex(actual)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return withRemediation({
      code: "GUARD_REPLAY_MISMATCH",
      severity: "block",
      message: "Replay comparison failed because replay report could not be read",
      details: {
        replayReportPath,
        error: message.slice(0, 220)
      }
    });
  }
}

function normalizePolicyInput(policyRaw: unknown): NormalizedPolicyResult {
  const version =
    policyRaw && typeof policyRaw === "object" && typeof (policyRaw as { version?: unknown }).version === "number"
      ? ((policyRaw as { version: number }).version as number)
      : null;

  if (version === 2) {
    const policy = GuardPolicySchema.parse(policyRaw);
    return {
      policy,
      inputVersion: 2
    };
  }

  if (version === 1) {
    const legacy = GuardPolicyV1Schema.parse(policyRaw);
    const upgraded = upgradePolicyV1ToV2(legacy);

    return {
      policy: upgraded,
      inputVersion: 1
    };
  }

  throw new Error("E_POLICY_VERSION_UNSUPPORTED: expected version 1 or 2");
}

function upgradePolicyV1ToV2(policyV1: GuardPolicyV1): GuardPolicy {
  return GuardPolicySchema.parse({
    ...policyV1,
    version: 2,
    runtime: {
      failOnUnsupportedEvent: true,
      failOnMalformedPayload: true,
      maxBodyChars: 12_000,
      maxTargets: 25,
      maxEventBytes: 1_000_000
    },
    report: {
      includeBodies: true,
      redactionMode: "none"
    },
    approvals: {
      minHumanApprovals: policyV1.minHumanApprovals,
      fetchTimeoutMs: 10_000,
      maxPages: 10,
      retry: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 2_500,
        jitterRatio: 0.2,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      }
    }
  });
}

function applyCliOverrides(policy: GuardPolicy, args: ParsedArgs): GuardPolicy {
  const runtime = {
    ...policy.runtime,
    failOnUnsupportedEvent:
      args.failOnUnsupportedEvent === undefined ? policy.runtime.failOnUnsupportedEvent : args.failOnUnsupportedEvent,
    maxBodyChars: args.maxBodyChars ?? policy.runtime.maxBodyChars,
    maxEventBytes: args.maxEventBytes ?? policy.runtime.maxEventBytes
  };

  const report = {
    ...policy.report
  };

  if (args.redact) {
    report.includeBodies = false;
    if (report.redactionMode === "none") {
      report.redactionMode = "hash";
    }
  }

  return {
    ...policy,
    runtime,
    report
  };
}

export function extractTargetsFromEvent(eventName: string, payload: unknown, policy: GuardPolicy): ReviewTarget[] {
  const extraction = githubProvider.extractTargets(eventName, payload, policy);
  return extraction.targets;
}

function buildRegex(pattern: string): RegExp {
  if (!safeRegex(pattern)) {
    throw new Error(`E_UNSAFE_RULE_REGEX: pattern='${pattern}'`);
  }

  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_INVALID_RULE_REGEX: pattern='${pattern}' error='${message}'`);
  }
}

function compileRules(rules: GuardRule[]): CompiledRule[] {
  return rules.map((rule) => ({
    ...rule,
    regex: buildRegex(rule.pattern)
  }));
}

function evaluateTargetsWithCompiledRules(
  policy: GuardPolicy,
  targets: ReviewTarget[],
  compiledRules: CompiledRule[]
): GuardResult {
  const blockedAuthors = toLowerSet(policy.blockedAuthors);
  const allowedAuthors = toLowerSet(policy.allowedAuthors);

  const targetEvaluations: TargetEvaluation[] = [];
  const globalFindings: GuardFinding[] = [];
  let highestScore = 0;

  for (const target of targets) {
    const findings: GuardFinding[] = [];
    const matchedRules: string[] = [];
    const author = normalizeLogin(target.authorLogin);

    if (allowedAuthors.has(author)) {
      targetEvaluations.push({
        target,
        aiScore: 0,
        matchedRules,
        findings
      });
      continue;
    }

    if (blockedAuthors.has(author)) {
      findings.push(
        withRemediation({
          code: "GUARD_BLOCKED_AUTHOR",
          severity: "block",
          message: `Review author '${target.authorLogin}' is blocked by policy`,
          targetReferenceId: target.referenceId
        })
      );
    }

    if (policy.blockBotAuthors && target.authorType === "Bot") {
      findings.push(
        withRemediation({
          code: "GUARD_BOT_BLOCKED",
          severity: "block",
          message: `Bot-origin review content blocked for '${target.authorLogin}'`,
          targetReferenceId: target.referenceId
        })
      );
    }

    let aiScore = 0;
    for (const rule of compiledRules) {
      if (!rule.regex.test(target.body)) {
        continue;
      }

      matchedRules.push(rule.name);

      if (rule.action === "block") {
        findings.push(
          withRemediation({
            code: "GUARD_RULE_BLOCK",
            severity: "block",
            message: `Blocked by rule '${rule.name}'`,
            targetReferenceId: target.referenceId,
            details: {
              rule: rule.name
            }
          })
        );
      } else {
        aiScore += rule.weight;
      }
    }

    aiScore = Math.min(1, aiScore);
    highestScore = Math.max(highestScore, aiScore);

    if (
      aiScore >= policy.disclosureRequiredScore &&
      !target.body.toLowerCase().includes(policy.disclosureTag.toLowerCase())
    ) {
      findings.push(
        withRemediation({
          code: "GUARD_DISCLOSURE_REQUIRED",
          severity: "block",
          message: `Missing disclosure tag '${policy.disclosureTag}' for high AI-score review`,
          targetReferenceId: target.referenceId,
          details: {
            aiScore,
            threshold: policy.disclosureRequiredScore
          }
        })
      );
    }

    if (aiScore > policy.maxAiScore) {
      findings.push(
        withRemediation({
          code: "GUARD_AI_SCORE_EXCEEDED",
          severity: "block",
          message: `AI signal score ${aiScore.toFixed(3)} exceeds max ${policy.maxAiScore.toFixed(3)}`,
          targetReferenceId: target.referenceId,
          details: {
            aiScore,
            maxAiScore: policy.maxAiScore
          }
        })
      );
    }

    targetEvaluations.push({
      target,
      aiScore,
      matchedRules,
      findings
    });

    globalFindings.push(...findings);
  }

  return {
    targetEvaluations,
    findings: globalFindings,
    highestScore
  };
}

export function evaluateTargets(policy: GuardPolicy, targets: ReviewTarget[]): GuardResult {
  const compiledRules = compileRules(policy.rules);
  return evaluateTargetsWithCompiledRules(policy, targets, compiledRules);
}

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function applyRuntimeTargetLimits(policy: GuardPolicy, targets: ReviewTarget[]): { targets: ReviewTarget[]; findings: GuardFinding[] } {
  const findings: GuardFinding[] = [];
  const trimmedTargets: ReviewTarget[] = [];

  const cappedTargets = targets.slice(0, policy.runtime.maxTargets);
  if (targets.length > policy.runtime.maxTargets) {
    findings.push(
      withRemediation({
        code: "GUARD_TARGET_LIMIT_REACHED",
        severity: "block",
        message: `Targets scanned ${targets.length} exceed runtime.maxTargets ${policy.runtime.maxTargets}`,
        details: {
          totalTargets: targets.length,
          maxTargets: policy.runtime.maxTargets
        }
      })
    );
  }

  for (const target of cappedTargets) {
    if (target.body.length > policy.runtime.maxBodyChars) {
      trimmedTargets.push({
        ...target,
        body: target.body.slice(0, policy.runtime.maxBodyChars)
      });

      findings.push(
        withRemediation({
          code: "GUARD_BODY_TRUNCATED",
          severity: "block",
          message: `Body for '${target.referenceId}' exceeded runtime.maxBodyChars and was truncated`,
          targetReferenceId: target.referenceId,
          details: {
            originalLength: target.body.length,
            maxBodyChars: policy.runtime.maxBodyChars
          }
        })
      );

      continue;
    }

    trimmedTargets.push(target);
  }

  return {
    targets: trimmedTargets,
    findings
  };
}

function decideOutcome(policy: GuardPolicy, findings: GuardFinding[]): "pass" | "warn" | "block" {
  const hasBlock = findings.some((item) => item.severity === "block");

  if (hasBlock && policy.enforcement === "block") {
    return "block";
  }

  if (findings.length > 0) {
    return "warn";
  }

  return "pass";
}

function summarizeDecision(decision: "pass" | "warn" | "block", findings: GuardFinding[]): string {
  if (decision === "pass") {
    return "Pass: policy checks completed and no blocking findings were detected.";
  }

  if (decision === "warn") {
    return `Warn: ${findings.length} policy finding(s) were detected but enforcement allows warnings.`;
  }

  return `Block: ${findings.length} policy finding(s) require maintainer action before merge.`;
}

function buildAccessibilitySummary(
  decision: "pass" | "warn" | "block",
  findings: GuardFinding[]
): AccessibilitySummary {
  return {
    plainLanguageDecision: summarizeDecision(decision, findings),
    statusWords: {
      pass: "Pass",
      warn: "Warn",
      block: "Block"
    },
    nonColorStatusSignals: true,
    screenReaderFriendly: true,
    cognitiveLoad: findings.length > 5 ? "medium" : "low"
  };
}

function toReportTarget(
  evaluation: TargetEvaluation,
  findings: GuardFinding[],
  policy: GuardPolicy
): ReportTargetSummary {
  const bodyHash = hashText(evaluation.target.body);

  const targetFindingCodes = findings
    .filter((item) => item.targetReferenceId === evaluation.target.referenceId)
    .map((item) => item.code);

  const result: ReportTargetSummary = {
    source: evaluation.target.source,
    referenceId: evaluation.target.referenceId,
    authorLogin: evaluation.target.authorLogin,
    authorType: evaluation.target.authorType,
    aiScore: evaluation.aiScore,
    matchedRules: evaluation.matchedRules,
    findingCodes: targetFindingCodes,
    bodyHash
  };

  if (!policy.report.includeBodies) {
    return result;
  }

  if (policy.report.redactionMode === "none") {
    result.body = evaluation.target.body;
    return result;
  }

  if (policy.report.redactionMode === "partial") {
    result.bodyExcerpt = evaluation.target.body.slice(0, 200);
  }

  return result;
}

function buildEvidenceHashes(targets: TargetEvaluation[]): Record<string, string> {
  const hashes: Record<string, string> = {};

  for (const item of targets) {
    hashes[item.target.referenceId] = hashText(item.target.body);
  }

  return hashes;
}

function renderMarkdownReport(report: GuardReportV2): string {
  const lines: string[] = [];

  lines.push("# Seven Shadow System Report");
  lines.push("");
  lines.push(`- Decision: **${report.decision.toUpperCase()}**`);
  lines.push(`- Event: \`${report.eventName}\``);
  lines.push(`- Provider: \`${report.provider}\``);
  lines.push(`- Findings: ${report.findings.length}`);
  lines.push(`- Targets Scanned: ${report.targetsScanned}`);
  lines.push(`- Highest AI Score: ${report.highestAiScore.toFixed(3)}`);
  lines.push("");
  lines.push("## Plain Language Summary");
  lines.push("");
  lines.push(report.accessibilitySummary.plainLanguageDecision);
  lines.push("");

  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("No findings.");
  } else {
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity.toUpperCase()}] \`${finding.code}\`: ${finding.message}`);
      if (finding.remediation) {
        lines.push(`  Remediation: ${finding.remediation}`);
      }
    }
  }

  lines.push("");
  lines.push("## Target Evidence Hashes");
  lines.push("");
  for (const [referenceId, hash] of Object.entries(report.evidenceHashes)) {
    lines.push(`- \`${referenceId}\`: \`${hash}\``);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderSarifReport(report: GuardReportV2): Record<string, unknown> {
  const rules = Array.from(new Set(report.findings.map((item) => item.code))).map((code) => {
    const finding = report.findings.find((item) => item.code === code);
    return {
      id: code,
      name: code,
      shortDescription: {
        text: code
      },
      fullDescription: {
        text: finding?.remediation ?? "Policy finding"
      }
    };
  });

  const results = report.findings.map((finding) => ({
    ruleId: finding.code,
    level: finding.severity === "block" ? "error" : "warning",
    message: {
      text: `${finding.message} Remediation: ${finding.remediation ?? "See policy documentation."}`
    },
    properties: {
      targetReferenceId: finding.targetReferenceId ?? null
    }
  }));

  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Seven Shadow System",
            informationUri: "https://github.com/VontaJamal/seven-shadow-system",
            rules
          }
        },
        results
      }
    ]
  };
}

async function loadJsonFile(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function loadJsonFileWithByteLimit(filePath: string, maxBytes: number): Promise<unknown> {
  const raw = await fs.readFile(filePath);
  if (raw.byteLength > maxBytes) {
    throw new Error(`E_EVENT_FILE_TOO_LARGE: bytes=${raw.byteLength} maxBytes=${maxBytes}`);
  }

  try {
    return JSON.parse(raw.toString("utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_EVENT_JSON_PARSE: ${message}`);
  }
}

async function writeTextReport(reportPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, content, "utf8");
}

function resolveReportPath(reportPath: string, format: Exclude<ReportFormat, "all">): string {
  const extByFormat: Record<Exclude<ReportFormat, "all">, string> = {
    json: ".json",
    markdown: ".md",
    sarif: ".sarif"
  };

  const expectedExt = extByFormat[format];
  if (!path.extname(reportPath)) {
    return `${reportPath}${expectedExt}`;
  }

  if (path.extname(reportPath).toLowerCase() === expectedExt) {
    return reportPath;
  }

  return path.join(path.dirname(reportPath), `${path.parse(reportPath).name}${expectedExt}`);
}

async function writeReports(reportPath: string, format: ReportFormat, report: GuardReportV2): Promise<string[]> {
  if (format !== "all") {
    const destination = resolveReportPath(reportPath, format);

    if (format === "json") {
      await writeTextReport(destination, `${JSON.stringify(report, null, 2)}\n`);
      return [destination];
    }

    if (format === "markdown") {
      await writeTextReport(destination, renderMarkdownReport(report));
      return [destination];
    }

    await writeTextReport(destination, `${JSON.stringify(renderSarifReport(report), null, 2)}\n`);
    return [destination];
  }

  const parsed = path.parse(reportPath);
  const basePath = parsed.ext ? path.join(parsed.dir, parsed.name) : reportPath;

  const jsonPath = `${basePath}.json`;
  const markdownPath = `${basePath}.md`;
  const sarifPath = `${basePath}.sarif`;

  await writeTextReport(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeTextReport(markdownPath, renderMarkdownReport(report));
  await writeTextReport(sarifPath, `${JSON.stringify(renderSarifReport(report), null, 2)}\n`);

  return [jsonPath, markdownPath, sarifPath];
}

export async function runSevenShadowSystem(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseArgs(argv);
  const eventPath = args.eventPath ?? env.GITHUB_EVENT_PATH;
  const eventName = args.eventName ?? env.GITHUB_EVENT_NAME ?? "unknown";

  if (!eventPath) {
    throw new Error("E_EVENT_PATH_REQUIRED");
  }

  const resolvedPolicy = await resolvePolicyMaterial(args);
  const normalizedPolicy = normalizePolicyInput(resolvedPolicy.policyRaw);
  const policy = applyCliOverrides(normalizedPolicy.policy, args);
  const provider = getProvider(args.provider);

  const findings: GuardFinding[] = [];
  let eventPayload: unknown = {};
  let eventPayloadAvailable = false;

  try {
    eventPayload = await loadJsonFileWithByteLimit(eventPath, policy.runtime.maxEventBytes);
    eventPayloadAvailable = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isLargeEvent = message.startsWith("E_EVENT_FILE_TOO_LARGE:");

    findings.push(
      withRemediation({
        code: isLargeEvent ? "GUARD_EVENT_TOO_LARGE" : "GUARD_EVENT_PARSE_ERROR",
        severity: policy.runtime.failOnMalformedPayload ? "block" : "warn",
        message: isLargeEvent
          ? `Event payload exceeded runtime.maxEventBytes (${policy.runtime.maxEventBytes})`
          : "Failed to parse event payload JSON",
        details: {
          error: message.slice(0, 220),
          maxEventBytes: policy.runtime.maxEventBytes
        }
      })
    );
  }

  const eventSupported = provider.supportedEvents.has(eventName);
  if (!eventSupported) {
    findings.push(
      withRemediation({
        code: "GUARD_UNSUPPORTED_EVENT",
        severity: policy.runtime.failOnUnsupportedEvent ? "block" : "warn",
        message: `Provider '${provider.name}' does not support event '${eventName}'`,
        details: {
          supportedEvents: Array.from(provider.supportedEvents)
        }
      })
    );
  }

  let targets: ReviewTarget[] = [];
  let extractionMalformedReasons: string[] = [];

  if (eventSupported && eventPayloadAvailable) {
    const extraction = provider.extractTargets(eventName, eventPayload, policy);
    targets = extraction.targets;
    extractionMalformedReasons = extraction.malformedReasons;

    if (policy.runtime.failOnMalformedPayload && extractionMalformedReasons.length > 0) {
      findings.push(
        withRemediation({
          code: "GUARD_MALFORMED_EVENT",
          severity: "block",
          message: `Malformed event payload: ${extractionMalformedReasons.join("; ")}`,
          details: {
            reasons: extractionMalformedReasons
          }
        })
      );
    }

    const scanningEnabled = policy.scanPrBody || policy.scanReviewBody || policy.scanCommentBody;
    if (policy.runtime.failOnMalformedPayload && scanningEnabled && targets.length === 0) {
      findings.push(
        withRemediation({
          code: "GUARD_MALFORMED_EVENT",
          severity: "block",
          message: "No scannable review targets were found in the event payload"
        })
      );
    }
  }

  const limitedTargets = applyRuntimeTargetLimits(policy, targets);
  findings.push(...limitedTargets.findings);

  const compiledRules = compileRules(policy.rules);
  const baseResult = evaluateTargetsWithCompiledRules(policy, limitedTargets.targets, compiledRules);
  findings.push(...baseResult.findings);

  const allowedAuthors = toLowerSet(policy.allowedAuthors);

  const humanApprovals: HumanApprovalsSummary = {
    required: policy.approvals.minHumanApprovals,
    actual: null,
    checked: false
  };

  if (eventSupported && eventPayloadAvailable && policy.approvals.minHumanApprovals > 0) {
    const pullContext: PullContext | null = provider.extractPullContext(eventName, eventPayload);

    if (!pullContext) {
      findings.push(
        withRemediation({
          code: "GUARD_PULL_CONTEXT_MISSING",
          severity: "block",
          message: "Unable to evaluate required human approvals because pull request context was missing"
        })
      );
    } else {
      const githubToken = env.GITHUB_TOKEN;
      if (!githubToken) {
        findings.push(
          withRemediation({
            code: "GUARD_APPROVALS_UNVERIFIED",
            severity: "block",
            message: "GITHUB_TOKEN unavailable; cannot verify required human approvals"
          })
        );
      } else {
        try {
          const approvals = await provider.fetchHumanApprovalCount(pullContext, {
            githubToken,
            allowedAuthors,
            fetchTimeoutMs: policy.approvals.fetchTimeoutMs,
            maxPages: policy.approvals.maxPages,
            retry: policy.approvals.retry
          });

          humanApprovals.actual = approvals;
          humanApprovals.checked = true;

          if (approvals < policy.approvals.minHumanApprovals) {
            findings.push(
              withRemediation({
                code: "GUARD_HUMAN_APPROVALS",
                severity: "block",
                message: `Human approvals ${approvals} below required ${policy.approvals.minHumanApprovals}`,
                details: {
                  approvals,
                  required: policy.approvals.minHumanApprovals
                }
              })
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const providerError = error instanceof ProviderApprovalError ? error : null;
          const codeByKind: Record<ProviderApprovalError["kind"], string> = {
            rate_limited: "GUARD_APPROVALS_RATE_LIMITED",
            timeout: "GUARD_APPROVALS_TIMEOUT",
            retry_exhausted: "GUARD_APPROVALS_RETRY_EXHAUSTED",
            fetch_error: "GUARD_APPROVALS_FETCH_ERROR",
            http_error: "GUARD_APPROVALS_FETCH_ERROR"
          };

          const findingCode = providerError ? codeByKind[providerError.kind] : "GUARD_APPROVALS_FETCH_ERROR";

          findings.push(
            withRemediation({
              code: findingCode,
              severity: "block",
              message:
                findingCode === "GUARD_APPROVALS_RATE_LIMITED"
                  ? "Approval verification was rate-limited by provider"
                  : findingCode === "GUARD_APPROVALS_TIMEOUT"
                    ? "Approval verification timed out"
                    : findingCode === "GUARD_APPROVALS_RETRY_EXHAUSTED"
                      ? "Approval verification retries exhausted before confidence could be established"
                      : "Failed to fetch pull request approvals from provider",
              details: {
                provider: provider.name,
                error: message.slice(0, 220),
                ...(providerError
                  ? {
                      providerErrorKind: providerError.kind,
                      providerDetails: providerError.details
                    }
                  : {})
              }
            })
          );
        }
      }
    }
  }

  let decision = decideOutcome(policy, findings);
  let accessibilitySummary = buildAccessibilitySummary(decision, findings);

  const reportTargets = baseResult.targetEvaluations.map((item) => toReportTarget(item, findings, policy));

  const report: GuardReportV2 = {
    schemaVersion: 2,
    timestamp: new Date().toISOString(),
    provider: provider.name,
    eventName,
    policyPath: resolvedPolicy.policyPathForReport,
    policyVersion: normalizedPolicy.inputVersion,
    enforcement: policy.enforcement,
    decision,
    targetsScanned: limitedTargets.targets.length,
    highestAiScore: baseResult.highestScore,
    humanApprovals,
    findings,
    targets: reportTargets,
    evidenceHashes: buildEvidenceHashes(baseResult.targetEvaluations),
    accessibilitySummary
  };

  if (args.replayReportPath) {
    const replayFinding = await evaluateReplayFinding(report, args.replayReportPath);
    if (replayFinding) {
      findings.push(replayFinding);
      decision = decideOutcome(policy, findings);
      accessibilitySummary = buildAccessibilitySummary(decision, findings);
      report.decision = decision;
      report.findings = findings;
      report.accessibilitySummary = accessibilitySummary;
    }
  }

  if (args.reportPath) {
    report.generatedReports = await writeReports(args.reportPath, args.reportFormat, report);
  }

  console.log(JSON.stringify(report, null, 2));

  return report.decision === "block" ? 1 : 0;
}

if (require.main === module) {
  runSevenShadowSystem()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Seven Shadow System failed: ${message}`);
      process.exit(1);
    });
}
