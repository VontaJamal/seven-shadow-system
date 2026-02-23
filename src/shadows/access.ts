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
    domain: "Access",
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

export function evaluateAccess(context: ShadowEvaluationContext): ShadowDomainEvaluation {
  const findings: ShadowFinding[] = [];
  const corpus = context.corpus;

  const altTextMissing = countMatches(corpus, /missing alt text|no alt text|image without alt/i);
  if (altTextMissing > 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_MISSING_ALT_TEXT",
      "high",
      "Accessibility issue: missing alt text was identified.",
      "Add meaningful alt text for non-decorative images.",
      {
        hits: altTextMissing
      }
    );
  }

  const ariaMissing = countMatches(corpus, /missing aria(?:-|\s)?label|aria label missing|unlabeled button/i);
  if (ariaMissing > 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_MISSING_ARIA_LABEL",
      "high",
      "Accessibility issue: interactive controls appear unlabeled for assistive technology.",
      "Add appropriate accessible names (e.g., aria-label or linked label text) to interactive controls.",
      {
        hits: ariaMissing
      }
    );
  }

  const keyboardBlocked = countMatches(corpus, /keyboard inaccessible|cannot tab|no keyboard support|focus trap/i);
  if (keyboardBlocked > 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_KEYBOARD_INACCESSIBLE",
      "critical",
      "Accessibility issue: keyboard users may be blocked from critical interactions.",
      "Ensure all interactive flows are keyboard navigable with logical tab order and escape paths.",
      {
        hits: keyboardBlocked
      }
    );
  }

  const contrastIssues = countMatches(corpus, /insufficient color contrast|low contrast text|contrast ratio fails/i);
  if (contrastIssues > 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_CONTRAST_FAIL",
      "high",
      "Accessibility issue: color contrast appears below acceptable thresholds.",
      "Adjust colors to meet WCAG contrast requirements and verify across themes.",
      {
        hits: contrastIssues
      }
    );
  }

  const focusIndicatorIssues = countMatches(corpus, /missing focus indicator|focus not visible|no visible focus/i);
  if (focusIndicatorIssues > 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_FOCUS_VISIBILITY",
      "high",
      "Accessibility issue: focus indicators appear missing or not visible.",
      "Provide clear, consistent visible focus styling for keyboard navigation.",
      {
        hits: focusIndicatorIssues
      }
    );
  }

  const advisoryHits =
    countMatches(corpus, /missing skip(?:-|\s)?nav|no skip link/i) +
    countMatches(corpus, /untested screen reader|screen reader not tested/i) +
    countMatches(corpus, /missing lang attribute|html lang missing/i);

  if (advisoryHits > 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_ADVISORY_GAPS",
      "medium",
      "Accessibility advisory gaps were detected (skip-nav, screen-reader testing, or lang metadata).",
      "Add skip links, validate with screen readers, and ensure document language metadata is present.",
      {
        hits: advisoryHits
      }
    );
  }

  const uiSurfaceSignal = countMatches(corpus, /ui|frontend|component|layout|responsive|css|aria|screen reader/i);
  const a11yEvidenceSignal = countMatches(corpus, /aria|alt text|keyboard|screen reader|contrast|focus|wcag|skip nav|lang attribute/i);

  if (uiSurfaceSignal > 0 && a11yEvidenceSignal === 0) {
    addFinding(
      findings,
      "SHADOW_ACCESS_A11Y_EVIDENCE_MISSING",
      "medium",
      "UI-related changes were referenced without explicit accessibility evidence.",
      "Document accessibility validation (keyboard, screen-reader, contrast, and focus behavior).",
      {
        uiSurfaceSignal
      }
    );
  }

  const score = Math.min(
    100,
    keyboardBlocked * 35 +
      altTextMissing * 18 +
      ariaMissing * 20 +
      contrastIssues * 18 +
      focusIndicatorIssues * 18 +
      advisoryHits * 8 +
      (uiSurfaceSignal > 0 && a11yEvidenceSignal === 0 ? 12 : 0)
  );

  return {
    domain: "Access",
    score,
    rationale: "Access evaluates user-facing accessibility fundamentals: semantic labeling, keyboard support, contrast, and assistive-tech readiness.",
    findings
  };
}
