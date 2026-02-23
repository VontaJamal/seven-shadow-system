import { z } from "zod";

import { getProviderByName } from "../providers/registry";
import { GuardPolicySchema, evaluateTargets, type GuardFinding, type ReviewTarget } from "../sevenShadowSystem";
import { evaluateAccess } from "./access";
import { evaluateAesthetics } from "./aesthetics";
import { evaluateExecution } from "./execution";
import { evaluateScales } from "./scales";
import { evaluateSecurity } from "./security";
import { evaluateTesting } from "./testing";
import type {
  NormalizedShadowPolicy,
  ShadowAppliedException,
  ShadowCoveragePolicy,
  ShadowDecision,
  ShadowDoctrine,
  ShadowDomain,
  ShadowDomainDecision,
  ShadowDomainEvaluation,
  ShadowEnforcementStage,
  ShadowEvaluationContext,
  ShadowExceptionRecord,
  ShadowFinding,
  ShadowGateEvaluationResult,
  ShadowGateReportV3,
  ShadowRuleConfig,
  ShadowSeverity,
  ShadowThreshold
} from "./types";
import { evaluateValue } from "./value";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const SHADOW_DOMAINS: ShadowDomain[] = ["Security", "Access", "Testing", "Execution", "Scales", "Value", "Aesthetics"];

const DEFAULT_TIE_BREAK_ORDER: ShadowDomain[] = ["Security", "Access", "Testing", "Execution", "Scales", "Value", "Aesthetics"];

const DEFAULT_COVERAGE_POLICY: ShadowCoveragePolicy = {
  selector: "risk-ranked-auto",
  sizeBands: {
    small: {
      maxLinesChanged: 250,
      maxFilesChanged: 15,
      domains: 1
    },
    medium: {
      maxLinesChanged: 1_200,
      maxFilesChanged: 60,
      domains: 2
    },
    large: {
      domains: 3
    }
  },
  tieBreakOrder: DEFAULT_TIE_BREAK_ORDER
};

const DEFAULT_THRESHOLDS: Record<ShadowDomain, ShadowThreshold> = {
  Security: { warnAt: 20, blockAt: 45 },
  Access: { warnAt: 18, blockAt: 42 },
  Testing: { warnAt: 20, blockAt: 45 },
  Execution: { warnAt: 18, blockAt: 40 },
  Scales: { warnAt: 22, blockAt: 50 },
  Value: { warnAt: 16, blockAt: 40 },
  Aesthetics: { warnAt: 16, blockAt: 40 }
};

const DEFAULT_SHADOW_RULES: Record<ShadowDomain, ShadowRuleConfig> = {
  Security: { enabled: true, checkSeverities: {} },
  Access: { enabled: true, checkSeverities: {} },
  Testing: { enabled: true, checkSeverities: {} },
  Execution: { enabled: true, checkSeverities: {} },
  Scales: { enabled: true, checkSeverities: {} },
  Value: { enabled: true, checkSeverities: {} },
  Aesthetics: { enabled: true, checkSeverities: {} }
};

const ShadowThresholdSchema = z.object({
  warnAt: z.number().min(0).max(100),
  blockAt: z.number().min(0).max(100)
});

const ShadowRuleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  checkSeverities: z.record(z.enum(["low", "medium", "high", "critical"])).default({})
});

const ShadowCoveragePolicySchema = z.object({
  selector: z.literal("risk-ranked-auto"),
  sizeBands: z.object({
    small: z.object({
      maxLinesChanged: z.number().int().min(1).max(1_000_000),
      maxFilesChanged: z.number().int().min(1).max(100_000),
      domains: z.union([z.literal(1), z.literal(2), z.literal(3)])
    }),
    medium: z.object({
      maxLinesChanged: z.number().int().min(1).max(1_000_000),
      maxFilesChanged: z.number().int().min(1).max(100_000),
      domains: z.union([z.literal(1), z.literal(2), z.literal(3)])
    }),
    large: z.object({
      domains: z.literal(3)
    })
  }),
  tieBreakOrder: z
    .array(z.enum(["Security", "Access", "Testing", "Execution", "Scales", "Value", "Aesthetics"]))
    .length(7)
});

const ShadowPolicyV3AdditionsSchema = z.object({
  enforcementStage: z.enum(["whisper", "oath", "throne"]).default("whisper"),
  coveragePolicy: ShadowCoveragePolicySchema.default(DEFAULT_COVERAGE_POLICY),
  shadowThresholds: z
    .object({
      Security: ShadowThresholdSchema,
      Access: ShadowThresholdSchema,
      Testing: ShadowThresholdSchema,
      Execution: ShadowThresholdSchema,
      Scales: ShadowThresholdSchema,
      Value: ShadowThresholdSchema,
      Aesthetics: ShadowThresholdSchema
    })
    .default(DEFAULT_THRESHOLDS),
  shadowRules: z
    .object({
      Security: ShadowRuleConfigSchema,
      Access: ShadowRuleConfigSchema,
      Testing: ShadowRuleConfigSchema,
      Execution: ShadowRuleConfigSchema,
      Scales: ShadowRuleConfigSchema,
      Value: ShadowRuleConfigSchema,
      Aesthetics: ShadowRuleConfigSchema
    })
    .default(DEFAULT_SHADOW_RULES)
});

const ShadowDoctrineDomainSchema = z.object({
  name: z.string().min(1),
  belief: z.string().min(1),
  doctrine: z.string().min(1),
  principles: z.array(z.string().min(1)).min(3).max(5),
  antiPatterns: z.array(z.string().min(1)).min(2),
  checkIntent: z.array(z.string().min(1)).min(1),
  remediationStyle: z.string().min(1)
});

const ShadowDoctrineSchema = z.object({
  version: z.literal(1),
  shadows: z.object({
    Security: ShadowDoctrineDomainSchema,
    Access: ShadowDoctrineDomainSchema,
    Testing: ShadowDoctrineDomainSchema,
    Execution: ShadowDoctrineDomainSchema,
    Scales: ShadowDoctrineDomainSchema,
    Value: ShadowDoctrineDomainSchema,
    Aesthetics: ShadowDoctrineDomainSchema
  })
});

const ShadowExceptionSchema = z.object({
  check: z.string().min(1),
  reason: z.string().min(1),
  expiresAt: z.string().min(1)
});

function parseIsoDate(value: string, field: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`E_SHADOW_EXCEPTIONS_INVALID: '${field}' must be ISO-8601`);
  }
  return value;
}

function normalizeTieBreakOrder(order: ShadowDomain[]): ShadowDomain[] {
  const seen = new Set<ShadowDomain>();
  const normalized: ShadowDomain[] = [];

  for (const item of order) {
    if (!seen.has(item)) {
      normalized.push(item);
      seen.add(item);
    }
  }

  for (const domain of DEFAULT_TIE_BREAK_ORDER) {
    if (!seen.has(domain)) {
      normalized.push(domain);
    }
  }

  return normalized;
}

export function parseShadowDoctrine(raw: unknown): ShadowDoctrine {
  try {
    return ShadowDoctrineSchema.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_SHADOW_DOCTRINE_INVALID: ${message}`);
  }
}

export function parseShadowExceptions(raw: unknown): ShadowExceptionRecord[] {
  if (raw === undefined || raw === null) {
    return [];
  }

  let entries: unknown = raw;
  if (isRecord(raw) && Array.isArray(raw.exceptions)) {
    entries = raw.exceptions;
  }

  if (!Array.isArray(entries)) {
    throw new Error("E_SHADOW_EXCEPTIONS_INVALID: expected array or { exceptions: [] }");
  }

  let parsed: ShadowExceptionRecord[];
  try {
    parsed = entries.map((entry) => {
      const candidate = ShadowExceptionSchema.parse(entry);
      return {
        check: candidate.check,
        reason: candidate.reason,
        expiresAt: parseIsoDate(candidate.expiresAt, "expiresAt")
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_SHADOW_EXCEPTIONS_INVALID: ${message}`);
  }

  return parsed.sort((left, right) => `${left.check}:${left.expiresAt}`.localeCompare(`${right.check}:${right.expiresAt}`));
}

function parseShadowPolicyV3(raw: Record<string, unknown>): NormalizedShadowPolicy {
  let parsedAdditions: z.infer<typeof ShadowPolicyV3AdditionsSchema>;
  try {
    parsedAdditions = ShadowPolicyV3AdditionsSchema.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_SHADOW_POLICY_INVALID: ${message}`);
  }

  const guardCandidate: Record<string, unknown> = {
    ...raw,
    version: 2
  };

  let guardPolicy: z.infer<typeof GuardPolicySchema>;
  try {
    guardPolicy = GuardPolicySchema.parse(guardCandidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`E_SHADOW_POLICY_INVALID: ${message}`);
  }

  return {
    inputVersion: 3,
    guardPolicy,
    enforcementStage: parsedAdditions.enforcementStage,
    coveragePolicy: {
      ...parsedAdditions.coveragePolicy,
      tieBreakOrder: normalizeTieBreakOrder(parsedAdditions.coveragePolicy.tieBreakOrder)
    },
    shadowThresholds: parsedAdditions.shadowThresholds,
    shadowRules: parsedAdditions.shadowRules
  };
}

export function parseShadowPolicy(raw: unknown): NormalizedShadowPolicy {
  if (!isRecord(raw)) {
    throw new Error("E_SHADOW_POLICY_INVALID: policy must be an object");
  }

  const version = raw.version;
  if (version === 2) {
    let guardPolicy: z.infer<typeof GuardPolicySchema>;
    try {
      guardPolicy = GuardPolicySchema.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`E_SHADOW_POLICY_INVALID: ${message}`);
    }
    return {
      inputVersion: 2,
      guardPolicy,
      enforcementStage: "whisper",
      coveragePolicy: DEFAULT_COVERAGE_POLICY,
      shadowThresholds: DEFAULT_THRESHOLDS,
      shadowRules: DEFAULT_SHADOW_RULES
    };
  }

  if (version === 3) {
    return parseShadowPolicyV3(raw);
  }

  throw new Error("E_SHADOW_POLICY_VERSION: expected policy version 2 or 3");
}

function toCorpus(payload: Record<string, unknown>, targets: ReviewTarget[]): string {
  const pieces: string[] = [];

  for (const target of targets) {
    pieces.push(target.body);
  }

  const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : null;
  if (pullRequest) {
    if (typeof pullRequest.title === "string") {
      pieces.push(pullRequest.title);
    }
    if (typeof pullRequest.body === "string") {
      pieces.push(pullRequest.body);
    }
  }

  const review = isRecord(payload.review) ? payload.review : null;
  if (review && typeof review.body === "string") {
    pieces.push(review.body);
  }

  const comment = isRecord(payload.comment) ? payload.comment : null;
  if (comment && typeof comment.body === "string") {
    pieces.push(comment.body);
  }

  return pieces.join("\n");
}

function toPullMetrics(payload: Record<string, unknown>): { changedFiles: number; linesChanged: number } {
  const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : null;

  const changedFilesRaw = pullRequest && typeof pullRequest.changed_files === "number" ? pullRequest.changed_files : 0;
  const additionsRaw = pullRequest && typeof pullRequest.additions === "number" ? pullRequest.additions : 0;
  const deletionsRaw = pullRequest && typeof pullRequest.deletions === "number" ? pullRequest.deletions : 0;

  const changedFiles = Math.max(0, Math.floor(changedFilesRaw));
  const linesChanged = Math.max(0, Math.floor(additionsRaw) + Math.floor(deletionsRaw));

  return {
    changedFiles,
    linesChanged
  };
}

function evaluatorByDomain(context: ShadowEvaluationContext): Record<ShadowDomain, ShadowDomainEvaluation> {
  return {
    Security: evaluateSecurity(context),
    Access: evaluateAccess(context),
    Testing: evaluateTesting(context),
    Execution: evaluateExecution(context),
    Scales: evaluateScales(context),
    Value: evaluateValue(context),
    Aesthetics: evaluateAesthetics(context)
  };
}

function toSizeBand(
  coveragePolicy: ShadowCoveragePolicy,
  metrics: { changedFiles: number; linesChanged: number }
): { label: "small" | "medium" | "large"; domains: 1 | 2 | 3 } {
  if (
    metrics.linesChanged <= coveragePolicy.sizeBands.small.maxLinesChanged &&
    metrics.changedFiles <= coveragePolicy.sizeBands.small.maxFilesChanged
  ) {
    return {
      label: "small",
      domains: coveragePolicy.sizeBands.small.domains
    };
  }

  if (
    metrics.linesChanged <= coveragePolicy.sizeBands.medium.maxLinesChanged &&
    metrics.changedFiles <= coveragePolicy.sizeBands.medium.maxFilesChanged
  ) {
    return {
      label: "medium",
      domains: coveragePolicy.sizeBands.medium.domains
    };
  }

  return {
    label: "large",
    domains: coveragePolicy.sizeBands.large.domains
  };
}

function computeRankingScores(
  evaluations: Record<ShadowDomain, ShadowDomainEvaluation>,
  guardFindings: GuardFinding[],
  metrics: { changedFiles: number; linesChanged: number }
): Record<ShadowDomain, number> {
  const scores: Record<ShadowDomain, number> = {
    Security: evaluations.Security.score,
    Access: evaluations.Access.score,
    Testing: evaluations.Testing.score,
    Execution: evaluations.Execution.score,
    Scales: evaluations.Scales.score,
    Value: evaluations.Value.score,
    Aesthetics: evaluations.Aesthetics.score
  };

  const blockingGuardFindings = guardFindings.filter((item) => item.severity === "block").length;
  scores.Security += blockingGuardFindings * 6;
  scores.Execution += guardFindings.filter((item) => item.code.startsWith("GUARD_APPROVALS_")).length * 8;
  scores.Scales += Math.min(20, Math.round(metrics.linesChanged / 150));
  scores.Testing += metrics.linesChanged >= 300 ? 10 : 0;

  for (const domain of SHADOW_DOMAINS) {
    scores[domain] = clamp(Number(scores[domain].toFixed(3)), 0, 100);
  }

  return scores;
}

function selectDomains(
  policy: NormalizedShadowPolicy,
  scores: Record<ShadowDomain, number>,
  metrics: { changedFiles: number; linesChanged: number }
): ShadowDomain[] {
  const tieOrder = policy.coveragePolicy.tieBreakOrder;
  const tieIndex = new Map<ShadowDomain, number>(tieOrder.map((domain, index) => [domain, index]));
  const domainCount = toSizeBand(policy.coveragePolicy, metrics).domains;

  return SHADOW_DOMAINS.filter((domain) => policy.shadowRules[domain].enabled)
    .sort((left, right) => {
      if (scores[left] !== scores[right]) {
        return scores[right] - scores[left];
      }

      return (tieIndex.get(left) ?? Number.MAX_SAFE_INTEGER) - (tieIndex.get(right) ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, Math.max(1, domainCount));
}

function applySeverityOverride(finding: ShadowFinding, ruleConfig: ShadowRuleConfig): ShadowFinding {
  const severityOverride = ruleConfig.checkSeverities[finding.code];
  if (!severityOverride) {
    return finding;
  }

  return {
    ...finding,
    severity: severityOverride
  };
}

function toThresholdFindings(domain: ShadowDomain, score: number, threshold: ShadowThreshold): ShadowFinding[] {
  const codePrefix = `SHADOW_${domain.toUpperCase()}_RISK`;
  const findings: ShadowFinding[] = [];

  if (score >= threshold.blockAt) {
    findings.push({
      code: `${codePrefix}_BLOCK_THRESHOLD`,
      domain,
      severity: "high",
      message: `Risk score ${score.toFixed(1)} reached blocking threshold ${threshold.blockAt}.`,
      remediation: "Reduce risk signals for this domain or split work into safer increments.",
      details: {
        score,
        threshold: threshold.blockAt
      }
    });
    return findings;
  }

  if (score >= threshold.warnAt) {
    findings.push({
      code: `${codePrefix}_WARN_THRESHOLD`,
      domain,
      severity: "medium",
      message: `Risk score ${score.toFixed(1)} reached warning threshold ${threshold.warnAt}.`,
      remediation: "Add explicit mitigation evidence for this domain before merge.",
      details: {
        score,
        threshold: threshold.warnAt
      }
    });
  }

  return findings;
}

function toEffectiveDecision(stage: ShadowEnforcementStage, finding: ShadowFinding): "warn" | "block" {
  if (stage === "whisper") {
    if (finding.severity === "critical" && (finding.domain === "Security" || finding.code.startsWith("SHADOW_RUNTIME_"))) {
      return "block";
    }

    return "warn";
  }

  if (stage === "oath") {
    if (finding.severity === "high" || finding.severity === "critical") {
      return "block";
    }

    return "warn";
  }

  if (finding.severity === "low") {
    return "warn";
  }

  return "block";
}

function summarizeDecision(decision: ShadowDecision, stage: ShadowEnforcementStage, findingCount: number): string {
  if (decision === "pass") {
    return `Pass: Seven Shadows evaluation passed at ${stage.toUpperCase()} stage with no active findings.`;
  }

  if (decision === "warn") {
    return `Warn: ${findingCount} finding(s) detected at ${stage.toUpperCase()} stage.`;
  }

  return `Block: ${findingCount} finding(s) require action at ${stage.toUpperCase()} stage before merge.`;
}

function makeAccessibilitySummary(decision: ShadowDecision, stage: ShadowEnforcementStage, findingCount: number) {
  return {
    plainLanguageDecision: summarizeDecision(decision, stage, findingCount),
    statusWords: {
      pass: "Pass",
      warn: "Warn",
      block: "Block"
    },
    nonColorStatusSignals: true,
    screenReaderFriendly: true,
    cognitiveLoad: findingCount > 5 ? "medium" : "low"
  } as const;
}

function applyExceptions(
  findings: ShadowFinding[],
  activeExceptions: ShadowExceptionRecord[]
): { findings: ShadowFinding[]; applied: ShadowAppliedException[] } {
  const byCode = new Map<string, ShadowExceptionRecord>();
  for (const item of activeExceptions) {
    if (!byCode.has(item.check)) {
      byCode.set(item.check, item);
    }
  }

  const kept: ShadowFinding[] = [];
  const applied: ShadowAppliedException[] = [];

  for (const finding of findings) {
    const matching = byCode.get(finding.code);
    if (!matching) {
      kept.push(finding);
      continue;
    }

    applied.push({
      check: matching.check,
      reason: matching.reason,
      expiresAt: matching.expiresAt,
      domain: finding.domain
    });
  }

  return {
    findings: kept,
    applied
  };
}

function activeExceptions(exceptions: ShadowExceptionRecord[], now: Date): ShadowExceptionRecord[] {
  const nowMs = now.getTime();
  return exceptions.filter((item) => Date.parse(item.expiresAt) >= nowMs);
}

function compareDomain(left: ShadowDomain, right: ShadowDomain, tieBreakOrder: ShadowDomain[]): number {
  return tieBreakOrder.indexOf(left) - tieBreakOrder.indexOf(right);
}

function toRuntimeIntegrityFinding(message: string): ShadowFinding {
  return {
    code: "SHADOW_RUNTIME_INTEGRITY",
    domain: "Security",
    severity: "critical",
    message,
    remediation: "Fix runtime input/adapter configuration before using Shadow Gate.",
    details: {}
  };
}

function toDecision(findings: Array<ShadowFinding & { effectiveDecision: "warn" | "block" }>): ShadowDecision {
  if (findings.some((item) => item.effectiveDecision === "block")) {
    return "block";
  }

  if (findings.length > 0) {
    return "warn";
  }

  return "pass";
}

export function evaluateShadowGate(options: {
  providerName?: string;
  eventName: string;
  eventPayload: unknown;
  policyRaw: unknown;
  doctrineRaw: unknown;
  exceptionsRaw?: unknown;
  now?: Date;
}): ShadowGateEvaluationResult {
  const now = options.now ?? new Date();
  const doctrine = parseShadowDoctrine(options.doctrineRaw);
  const policy = parseShadowPolicy(options.policyRaw);
  const exceptions = parseShadowExceptions(options.exceptionsRaw);
  const active = activeExceptions(exceptions, now);
  const providerName = options.providerName ?? "github";

  const provider = getProviderByName(providerName);
  if (!provider) {
    const finding = toRuntimeIntegrityFinding(`Provider '${providerName}' is not supported.`);
    const effectiveFinding = {
      ...finding,
      effectiveDecision: "block" as const
    };

    const report: ShadowGateReportV3 = {
      schemaVersion: 3,
      timestamp: now.toISOString(),
      provider: providerName,
      eventName: options.eventName,
      policyVersion: policy.inputVersion,
      enforcementStage: policy.enforcementStage,
      decision: "block",
      selectedDomains: ["Security"],
      targetsScanned: 0,
      highestAiScore: 0,
      findings: [effectiveFinding],
      shadowDecisions: [
        {
          domain: "Security",
          score: 100,
          decision: "block",
          findings: [effectiveFinding],
          rationale: "Runtime integrity block."
        }
      ],
      exceptionsApplied: [],
      accessibilitySummary: makeAccessibilitySummary("block", policy.enforcementStage, 1)
    };

    return {
      report,
      selectedDomains: ["Security"],
      policy,
      doctrine
    };
  }

  if (!isRecord(options.eventPayload)) {
    const finding = toRuntimeIntegrityFinding("Event payload must be an object.");
    const effectiveFinding = {
      ...finding,
      effectiveDecision: "block" as const
    };

    const report: ShadowGateReportV3 = {
      schemaVersion: 3,
      timestamp: now.toISOString(),
      provider: providerName,
      eventName: options.eventName,
      policyVersion: policy.inputVersion,
      enforcementStage: policy.enforcementStage,
      decision: "block",
      selectedDomains: ["Security"],
      targetsScanned: 0,
      highestAiScore: 0,
      findings: [effectiveFinding],
      shadowDecisions: [
        {
          domain: "Security",
          score: 100,
          decision: "block",
          findings: [effectiveFinding],
          rationale: "Runtime integrity block."
        }
      ],
      exceptionsApplied: [],
      accessibilitySummary: makeAccessibilitySummary("block", policy.enforcementStage, 1)
    };

    return {
      report,
      selectedDomains: ["Security"],
      policy,
      doctrine
    };
  }

  const extraction = provider.extractTargets(options.eventName, options.eventPayload, {
    scanPrBody: policy.guardPolicy.scanPrBody,
    scanReviewBody: policy.guardPolicy.scanReviewBody,
    scanCommentBody: policy.guardPolicy.scanCommentBody,
    approvals: {
      fetchTimeoutMs: policy.guardPolicy.approvals.fetchTimeoutMs,
      maxPages: policy.guardPolicy.approvals.maxPages
    }
  });

  const targets = extraction.targets;
  const guardResult = evaluateTargets(policy.guardPolicy, targets);

  const metrics = toPullMetrics(options.eventPayload);
  const context: ShadowEvaluationContext = {
    eventName: options.eventName,
    eventPayload: options.eventPayload,
    targets,
    guardFindings: guardResult.findings,
    corpus: toCorpus(options.eventPayload, targets),
    changedFiles: metrics.changedFiles,
    linesChanged: metrics.linesChanged
  };

  const evaluations = evaluatorByDomain(context);

  if (extraction.malformedReasons.length > 0) {
    evaluations.Security.findings.push({
      code: "SHADOW_RUNTIME_MALFORMED_EXTRACTION",
      domain: "Security",
      severity: "critical",
      message: "Provider extraction reported malformed payload shape.",
      remediation: "Fix event payload shape and re-run Shadow Gate.",
      details: {
        reasons: extraction.malformedReasons
      }
    });
    evaluations.Security.score = clamp(evaluations.Security.score + 45, 0, 100);
  }

  const rankingScores = computeRankingScores(evaluations, guardResult.findings, metrics);
  const selectedDomains = selectDomains(policy, rankingScores, metrics);

  const domainDecisions: ShadowDomainDecision[] = [];
  const allEffectiveFindings: Array<ShadowFinding & { effectiveDecision: "warn" | "block" }> = [];
  const exceptionsApplied: ShadowAppliedException[] = [];

  for (const domain of selectedDomains) {
    const evaluation = evaluations[domain];
    const ruleConfig = policy.shadowRules[domain];

    const baseFindings = evaluation.findings.map((finding) => applySeverityOverride(finding, ruleConfig));
    const thresholdFindings = toThresholdFindings(domain, evaluation.score, policy.shadowThresholds[domain]);

    const mergedFindings = [...baseFindings, ...thresholdFindings];
    const exceptionFiltered = applyExceptions(mergedFindings, active);

    exceptionsApplied.push(...exceptionFiltered.applied);

    const effectiveFindings = exceptionFiltered.findings.map((finding) => ({
      ...finding,
      effectiveDecision: toEffectiveDecision(policy.enforcementStage, finding)
    }));

    const decision = toDecision(effectiveFindings);

    const domainDecision: ShadowDomainDecision = {
      domain,
      score: Number(evaluation.score.toFixed(3)),
      decision,
      findings: effectiveFindings,
      rationale: evaluation.rationale
    };

    domainDecisions.push(domainDecision);
    allEffectiveFindings.push(...effectiveFindings);
  }

  domainDecisions.sort((left, right) => compareDomain(left.domain, right.domain, policy.coveragePolicy.tieBreakOrder));
  allEffectiveFindings.sort((left, right) => compareDomain(left.domain, right.domain, policy.coveragePolicy.tieBreakOrder));

  const decision = toDecision(allEffectiveFindings);

  const report: ShadowGateReportV3 = {
    schemaVersion: 3,
    timestamp: now.toISOString(),
    provider: providerName,
    eventName: options.eventName,
    policyVersion: policy.inputVersion,
    enforcementStage: policy.enforcementStage,
    decision,
    selectedDomains,
    targetsScanned: targets.length,
    highestAiScore: Number(guardResult.highestScore.toFixed(3)),
    findings: allEffectiveFindings,
    shadowDecisions: domainDecisions,
    exceptionsApplied: exceptionsApplied.sort((left, right) => {
      if (left.domain !== right.domain) {
        return compareDomain(left.domain, right.domain, policy.coveragePolicy.tieBreakOrder);
      }
      return left.check.localeCompare(right.check);
    }),
    accessibilitySummary: makeAccessibilitySummary(decision, policy.enforcementStage, allEffectiveFindings.length)
  };

  return {
    report,
    selectedDomains,
    policy,
    doctrine
  };
}

function colorize(text: string, code: string, enabled: boolean): string {
  if (!enabled) {
    return text;
  }

  return `${code}${text}\u001b[0m`;
}

function statusBadge(status: ShadowDecision, useColor: boolean): string {
  if (status === "pass") {
    return colorize("[PASS]", "\u001b[32m", useColor);
  }

  if (status === "warn") {
    return colorize("[WARN]", "\u001b[33m", useColor);
  }

  return colorize("[BLOCK]", "\u001b[31m", useColor);
}

export function renderShadowGateMarkdown(report: ShadowGateReportV3, options: { useColor?: boolean } = {}): string {
  const useColor = options.useColor === true;
  const lines: string[] = [];

  lines.push("# Seven Shadows Gate");
  lines.push("");
  lines.push(`Stage: [${report.enforcementStage.toUpperCase()}]`);
  lines.push(`Decision: ${statusBadge(report.decision, useColor)}`);
  lines.push(`Provider/Event: ${report.provider} / ${report.eventName}`);
  lines.push(`Selected Domains: ${report.selectedDomains.join(", ")}`);
  lines.push(`Targets Scanned: ${report.targetsScanned}`);
  lines.push(`Highest AI Score: ${report.highestAiScore.toFixed(3)}`);
  lines.push("");
  lines.push("## Domain Decisions");
  lines.push("");

  for (const domainDecision of report.shadowDecisions) {
    const label = domainDecision.domain.padEnd(10, " ");
    lines.push(`${statusBadge(domainDecision.decision, useColor)} ${label} score=${domainDecision.score.toFixed(1)}`);
  }

  lines.push("");
  lines.push("## Findings");
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No active findings.");
  } else {
    for (const finding of report.findings) {
      lines.push(
        `- ${statusBadge(finding.effectiveDecision === "block" ? "block" : "warn", useColor)} [${finding.domain}] ${finding.code}: ${finding.message}`
      );
      lines.push(`  Remediation: ${finding.remediation}`);
    }
  }

  if (report.exceptionsApplied.length > 0) {
    lines.push("");
    lines.push("## Exceptions Applied");
    lines.push("");
    for (const exception of report.exceptionsApplied) {
      lines.push(`- [${exception.domain}] ${exception.check} (expires ${exception.expiresAt}) - ${exception.reason}`);
    }
  }

  lines.push("");

  return lines.join("\n");
}
