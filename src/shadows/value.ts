import type { ShadowDomainEvaluation, ShadowEvaluationContext, ShadowFinding } from "./types";

function addFinding(
  findings: ShadowFinding[],
  code: string,
  severity: ShadowFinding["severity"],
  message: string,
  remediation: string,
  details: Record<string, unknown> = {}
): void {
  findings.push({
    code,
    domain: "Value",
    severity,
    message,
    remediation,
    details
  });
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
  return matches ? matches.length : 0;
}

export function evaluateValue(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];
  const corpus = context.corpus;

  const genericTemplateHits = countMatches(corpus, /\blgtm\b|\bgreat work\b|\blooks good\b|\bnit\b|\boverall\b/i);
  const evidenceHits = countMatches(corpus, /file:|line\s+\d+|because|impact|user|flow|regression|risk/i);

  if (genericTemplateHits > 1 && evidenceHits === 0) {
    addFinding(
      findings,
      "SHADOW_VALUE_LOW_SIGNAL_REVIEW",
      "high",
      "Review signal appears generic and low-evidence.",
      "Provide specific user/product impact with actionable evidence.",
      {
        genericTemplateHits
      }
    );
  } else if (genericTemplateHits > 0 && evidenceHits <= genericTemplateHits) {
    addFinding(
      findings,
      "SHADOW_VALUE_EVIDENCE_THIN",
      "medium",
      "Review value signal is thin relative to template language.",
      "Increase concrete impact rationale and tie comments to user/product outcomes.",
      {
        genericTemplateHits,
        evidenceHits
      }
    );
  }

  const duplicateFeatureSignals = countMatches(corpus, /duplicate feature|already exists|no user value|dead code|unused component/i);
  if (duplicateFeatureSignals > 0) {
    addFinding(
      findings,
      "SHADOW_VALUE_DUPLICATE_OR_DEAD_SURFACE",
      "high",
      "Potential duplicate/no-value product surface detected.",
      "Remove unused additions or justify incremental user/product value explicitly.",
      {
        hits: duplicateFeatureSignals
      }
    );
  }

  const intentSignal = countMatches(corpus, /user value|business value|product value|intent|outcome|adoption|retention/i);
  if (context.linesChanged > 250 && intentSignal === 0) {
    addFinding(
      findings,
      "SHADOW_VALUE_INTENT_MISSING",
      "medium",
      "Large change lacks explicit value intent signal.",
      "State what user/product outcome this change improves and why it matters.",
      {
        linesChanged: context.linesChanged
      }
    );
  }

  const score = Math.min(100, genericTemplateHits * 12 + duplicateFeatureSignals * 20 + (intentSignal === 0 ? 14 : 0));

  return {
    domain: "Value",
    score,
    rationale: "Value ensures every change carries explicit user or product impact instead of low-signal churn.",
    findings
  };
}
