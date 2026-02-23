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
    domain: "Testing",
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

export function evaluateTesting(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];
  const corpus = context.corpus;

  const noTestCoverageHits = countMatches(corpus, /no tests added|untested change|behavior change without test|missing regression test/i);
  if (noTestCoverageHits > 0) {
    addFinding(
      findings,
      "SHADOW_TESTING_COVERAGE_MISSING",
      "high",
      "Behavior-changing work appears untested.",
      "Add integration or E2E coverage that proves user-visible behavior still works.",
      {
        hits: noTestCoverageHits
      }
    );
  }

  const externalDependencyHits = countMatches(corpus, /hits real api|calls production api in test|external network in tests|no mock service worker/i);
  if (externalDependencyHits > 0) {
    addFinding(
      findings,
      "SHADOW_TESTING_UNMOCKED_EXTERNALS",
      "high",
      "Tests appear to rely on external APIs/services.",
      "Mock external dependencies (for example with MSW) to keep tests deterministic.",
      {
        hits: externalDependencyHits
      }
    );
  }

  const implementationDetailHits = countMatches(
    corpus,
    /snapshot-only test|implementation detail test|tests internal state only|asserts private method/i
  );
  if (implementationDetailHits > 0) {
    addFinding(
      findings,
      "SHADOW_TESTING_IMPL_DETAIL_HEAVY",
      "medium",
      "Testing signal indicates implementation-detail-heavy assertions.",
      "Prefer user-behavior assertions via integration or end-to-end tests.",
      {
        hits: implementationDetailHits
      }
    );
  }

  const behaviorEvidenceHits = countMatches(corpus, /integration test|e2e|playwright|cypress|testing library|user-event|msw/i);
  if (context.linesChanged >= 300 && behaviorEvidenceHits === 0) {
    addFinding(
      findings,
      "SHADOW_TESTING_BEHAVIOR_EVIDENCE_MISSING",
      "medium",
      "Large change set without behavior-first testing evidence.",
      "Add integration/E2E evidence and include deterministic mocking for external dependencies.",
      {
        linesChanged: context.linesChanged
      }
    );
  }

  const score = Math.min(
    100,
    noTestCoverageHits * 26 +
      externalDependencyHits * 24 +
      implementationDetailHits * 12 +
      (context.linesChanged >= 300 && behaviorEvidenceHits === 0 ? 18 : 0)
  );

  return {
    domain: "Testing",
    score,
    rationale: "Testing prioritizes behavior-first confidence, deterministic mocks, and workflow-level validation over implementation-detail padding.",
    findings
  };
}
