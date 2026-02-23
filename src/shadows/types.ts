import type { AccessibilitySummary, GuardFinding, GuardPolicy, ReviewTarget } from "../sevenShadowSystem";

export const SHADOW_DOMAIN_ORDER = [
  "Security",
  "Access",
  "Testing",
  "Execution",
  "Scales",
  "Value",
  "Aesthetics"
] as const;

export type ShadowDomain = (typeof SHADOW_DOMAIN_ORDER)[number];

export type ShadowSeverity = "low" | "medium" | "high" | "critical";

export type ShadowDecision = "pass" | "warn" | "block";

export type ShadowEnforcementStage = "whisper" | "oath" | "throne";

export interface ShadowFinding {
  code: string;
  domain: ShadowDomain;
  severity: ShadowSeverity;
  message: string;
  remediation: string;
  details?: Record<string, unknown>;
}

export interface ShadowThreshold {
  warnAt: number;
  blockAt: number;
}

export interface ShadowRuleConfig {
  enabled: boolean;
  checkSeverities: Record<string, ShadowSeverity>;
}

export interface ShadowCoverageBand {
  maxLinesChanged: number;
  maxFilesChanged: number;
  domains: 1 | 2 | 3;
}

export interface ShadowCoveragePolicy {
  selector: "risk-ranked-auto";
  sizeBands: {
    small: ShadowCoverageBand;
    medium: ShadowCoverageBand;
    large: {
      domains: 3;
    };
  };
  tieBreakOrder: ShadowDomain[];
}

export interface ShadowPolicyV3Additions {
  enforcementStage: ShadowEnforcementStage;
  coveragePolicy: ShadowCoveragePolicy;
  shadowThresholds: Record<ShadowDomain, ShadowThreshold>;
  shadowRules: Record<ShadowDomain, ShadowRuleConfig>;
}

export interface NormalizedShadowPolicy extends ShadowPolicyV3Additions {
  inputVersion: 2 | 3;
  guardPolicy: GuardPolicy;
}

export interface ShadowDoctrineDomain {
  name: string;
  belief: string;
  doctrine: string;
  principles: string[];
  antiPatterns: string[];
  checkIntent: string[];
  remediationStyle: string;
}

export interface ShadowDoctrine {
  version: 1;
  shadows: Record<ShadowDomain, ShadowDoctrineDomain>;
}

export interface ShadowExceptionRecord {
  check: string;
  reason: string;
  expiresAt: string;
}

export interface ShadowAppliedException extends ShadowExceptionRecord {
  domain: ShadowDomain;
}

export interface ShadowEvaluationContext {
  eventName: string;
  eventPayload: Record<string, unknown>;
  targets: ReviewTarget[];
  guardFindings: GuardFinding[];
  corpus: string;
  linesChanged: number;
  changedFiles: number;
}

export interface ShadowDomainEvaluation {
  domain: ShadowDomain;
  score: number;
  rationale: string;
  findings: ShadowFinding[];
}

export interface ShadowDomainDecision {
  domain: ShadowDomain;
  score: number;
  decision: ShadowDecision;
  findings: Array<ShadowFinding & { effectiveDecision: "warn" | "block" }>;
  rationale: string;
}

export interface ShadowGateReportV3 {
  schemaVersion: 3;
  timestamp: string;
  provider: string;
  eventName: string;
  policyVersion: 2 | 3;
  enforcementStage: ShadowEnforcementStage;
  decision: ShadowDecision;
  selectedDomains: ShadowDomain[];
  targetsScanned: number;
  highestAiScore: number;
  findings: Array<ShadowFinding & { effectiveDecision: "warn" | "block" }>;
  shadowDecisions: ShadowDomainDecision[];
  exceptionsApplied: ShadowAppliedException[];
  accessibilitySummary: AccessibilitySummary;
}

export interface ShadowGateEvaluationResult {
  report: ShadowGateReportV3;
  selectedDomains: ShadowDomain[];
  policy: NormalizedShadowPolicy;
  doctrine: ShadowDoctrine;
}
