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
    domain: "Aesthetics",
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

export function evaluateAesthetics(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];
  const corpus = context.corpus;

  const responsiveBreaks = countMatches(corpus, /responsive broken|layout breaks on mobile|overflow on small screen|not mobile friendly/i);
  if (responsiveBreaks > 0) {
    addFinding(
      findings,
      "SHADOW_AESTHETICS_RESPONSIVE_BREAK",
      "high",
      "Responsive layout regression signal detected.",
      "Fix breakpoints and verify mobile/tablet/desktop layouts remain coherent.",
      {
        hits: responsiveBreaks
      }
    );
  }

  const designSystemBreaks = countMatches(corpus, /design system mismatch|theme clash|visual inconsistency|component style drift/i);
  if (designSystemBreaks > 0) {
    addFinding(
      findings,
      "SHADOW_AESTHETICS_DESIGN_SYSTEM_BREAK",
      "high",
      "Visual consistency appears to diverge from the agreed design language.",
      "Align spacing, typography, and component style with existing design system conventions.",
      {
        hits: designSystemBreaks
      }
    );
  }

  const styleViolations = countMatches(corpus, /style lint fail|css lint fail|formatting violation|naming inconsistency/i);
  if (styleViolations > 0) {
    addFinding(
      findings,
      "SHADOW_AESTHETICS_STYLE_DISCIPLINE",
      "medium",
      "Style discipline issues were identified on touched UI surfaces.",
      "Resolve style/lint issues and keep surface naming/patterns consistent.",
      {
        hits: styleViolations
      }
    );
  }

  const score = Math.min(100, responsiveBreaks * 25 + designSystemBreaks * 22 + styleViolations * 12);

  return {
    domain: "Aesthetics",
    score,
    rationale: "Aesthetics ensures shipped UI feels cohesive, responsive, and intentionally aligned with team design standards.",
    findings
  };
}
