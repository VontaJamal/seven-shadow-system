import type { GuardFinding } from "../sevenShadowSystem";
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
    domain: "Security",
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

function mapGuardFinding(findings: ShadowFinding[], guardFinding: GuardFinding): void {
  if (guardFinding.code === "GUARD_MALFORMED_EVENT" || guardFinding.code === "GUARD_EVENT_PARSE_ERROR") {
    addFinding(
      findings,
      "SHADOW_SECURITY_RUNTIME_INTEGRITY",
      "critical",
      "Runtime integrity violation detected in guard validation.",
      "Fix malformed event/payload handling before rerunning Shadow Gate.",
      {
        sourceCode: guardFinding.code
      }
    );
    return;
  }

  if (guardFinding.code.startsWith("GUARD_APPROVALS_")) {
    addFinding(
      findings,
      "SHADOW_SECURITY_APPROVAL_TRUST",
      "high",
      "Approval trust boundary could not be verified.",
      "Restore provider token/permissions and re-run approval checks.",
      {
        sourceCode: guardFinding.code
      }
    );
    return;
  }

  if (guardFinding.severity === "block") {
    addFinding(
      findings,
      "SHADOW_SECURITY_GUARD_BLOCK",
      "high",
      "Guard-level security policy produced a blocking finding.",
      "Address the guard finding and keep security boundaries explicit.",
      {
        sourceCode: guardFinding.code
      }
    );
  }
}

export function evaluateSecurity(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];
  const corpus = context.corpus;

  const hardcodedSecretHits =
    countMatches(corpus, /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"'\n]{8,}["']/i) +
    countMatches(corpus, /-----BEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/i);

  if (hardcodedSecretHits > 0) {
    addFinding(
      findings,
      "SHADOW_SECURITY_HARDCODED_SECRET",
      "critical",
      "Possible hardcoded secret/token material detected.",
      "Remove the secret from code and rotate compromised credentials.",
      {
        hits: hardcodedSecretHits
      }
    );
  }

  const injectionHits = countMatches(corpus, /(?:'|\")\s*or\s*1\s*=\s*1|union\s+select|<script\b|javascript:/i);
  if (injectionHits > 0) {
    addFinding(
      findings,
      "SHADOW_SECURITY_INJECTION_SIGNAL",
      "high",
      "Potential SQL/XSS injection vector language detected.",
      "Validate and sanitize untrusted input; use parameterized queries and output escaping.",
      {
        hits: injectionHits
      }
    );
  }

  const authBoundaryHits = countMatches(corpus, /(?:missing auth|no auth check|public route|trust client input|bypass authorization)/i);
  if (authBoundaryHits > 0) {
    addFinding(
      findings,
      "SHADOW_SECURITY_TRUST_BOUNDARY",
      "high",
      "Auth/trust-boundary regression signal detected.",
      "Enforce server-side authorization and explicit trust boundaries on sensitive routes.",
      {
        hits: authBoundaryHits
      }
    );
  }

  const cveHits = countMatches(corpus, /(?:known cve|vulnerab(?:le|ility)|dependency risk|outdated security patch)/i);
  if (cveHits > 0) {
    addFinding(
      findings,
      "SHADOW_SECURITY_DEPENDENCY_RISK",
      "medium",
      "Dependency security risk signal detected.",
      "Update vulnerable dependencies and document mitigation if upgrade is blocked.",
      {
        hits: cveHits
      }
    );
  }

  for (const guardFinding of context.guardFindings) {
    mapGuardFinding(findings, guardFinding);
  }

  const score = Math.min(
    100,
    hardcodedSecretHits * 35 +
      injectionHits * 25 +
      authBoundaryHits * 20 +
      cveHits * 10 +
      context.guardFindings.filter((item) => item.severity === "block").length * 8
  );

  return {
    domain: "Security",
    score,
    rationale: "Security evaluates secret hygiene, injection vectors, trust boundaries, and guard integrity signals.",
    findings
  };
}
