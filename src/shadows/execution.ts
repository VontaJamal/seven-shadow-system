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
    domain: "Execution",
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

export function evaluateExecution(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];
  const corpus = context.corpus;

  const blockingSignals = countMatches(corpus, /ci failing|tests failing|broken build|unresolved thread|merge blocked/i);
  if (blockingSignals > 0) {
    addFinding(
      findings,
      "SHADOW_EXECUTION_BLOCKING_DEBT",
      "high",
      "Execution signal indicates unresolved blocking delivery debt.",
      "Resolve failing checks and unresolved review threads before merge.",
      {
        hits: blockingSignals
      }
    );
  }

  const advisorySignals = countMatches(corpus, /stale branch|merge conflict|skipped check|operational debt/i);
  if (advisorySignals > 0) {
    addFinding(
      findings,
      "SHADOW_EXECUTION_ADVISORY_DEBT",
      "medium",
      "Execution advisory debt detected.",
      "Close operational debt items and rerun quality checks before merge.",
      {
        hits: advisorySignals
      }
    );
  }

  const approvalsBlocking = context.guardFindings.filter((item) => item.code.startsWith("GUARD_APPROVALS_")).length;
  if (approvalsBlocking > 0) {
    addFinding(
      findings,
      "SHADOW_EXECUTION_APPROVAL_PIPELINE",
      "high",
      "Approval pipeline verification did not complete cleanly.",
      "Restore provider token/scope and re-verify approval requirements.",
      {
        guardFindings: approvalsBlocking
      }
    );
  }

  const score = Math.min(100, blockingSignals * 26 + advisorySignals * 12 + approvalsBlocking * 20);

  return {
    domain: "Execution",
    score,
    rationale: "Execution enforces finish-line quality: clean pipelines, resolved threads, and disciplined merge readiness.",
    findings
  };
}
