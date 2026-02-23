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
    domain: "Scales",
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

export function evaluateScales(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];

  if (context.changedFiles > 200 || context.linesChanged > 8_000) {
    addFinding(
      findings,
      "SHADOW_SCALES_BLAST_RADIUS_CRITICAL",
      "critical",
      "Blast radius is extremely high for a single review cycle.",
      "Split changes into smaller modular increments before merge.",
      {
        changedFiles: context.changedFiles,
        linesChanged: context.linesChanged
      }
    );
  } else if (context.changedFiles > 80 || context.linesChanged > 3_000) {
    addFinding(
      findings,
      "SHADOW_SCALES_BLAST_RADIUS_HIGH",
      "high",
      "Change set is large enough to increase scaling and review risk.",
      "Reduce coupling and decompose the change set for safer scaling.",
      {
        changedFiles: context.changedFiles,
        linesChanged: context.linesChanged
      }
    );
  } else if (context.changedFiles > 40 || context.linesChanged > 1_200) {
    addFinding(
      findings,
      "SHADOW_SCALES_BLAST_RADIUS_MEDIUM",
      "medium",
      "Change set size suggests moderate scaling risk.",
      "Document scaling path and blast-radius mitigation for affected systems.",
      {
        changedFiles: context.changedFiles,
        linesChanged: context.linesChanged
      }
    );
  }

  const couplingSignals = countMatches(context.corpus, /tightly coupled|hard scaling ceiling|single point of failure|monolith bottleneck/i);
  if (couplingSignals > 0) {
    addFinding(
      findings,
      "SHADOW_SCALES_COUPLING_RISK",
      "high",
      "Architectural coupling signal indicates future scale constraints.",
      "Decouple components and preserve independent scaling boundaries.",
      {
        hits: couplingSignals
      }
    );
  }

  const overEngineeringSignals = countMatches(context.corpus, /premature optimization|over-engineered abstraction|unnecessary distributed/i);
  if (overEngineeringSignals > 0) {
    addFinding(
      findings,
      "SHADOW_SCALES_OVERENGINEERING",
      "medium",
      "Complexity appears higher than current scale requires.",
      "Right-size architecture for current demand while keeping an explicit growth path.",
      {
        hits: overEngineeringSignals
      }
    );
  }

  const score = Math.min(
    100,
    Math.min(70, Math.round(context.changedFiles * 0.3 + context.linesChanged * 0.005)) +
      couplingSignals * 18 +
      overEngineeringSignals * 9
  );

  return {
    domain: "Scales",
    score,
    rationale: "Scales enforces right-sized architecture: minimal current complexity without creating future scaling ceilings.",
    findings
  };
}
