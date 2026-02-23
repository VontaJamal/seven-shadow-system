# Seven Shadows Doctrine v3

This doctrine defines seven enforceable engineering disciplines for trustworthy AI-assisted review and delivery.

<!-- quickstart:start -->
## Quickstart Doctrine (2-Minute Read)

1. Security: Build fortresses, not demos. Protect data, validate inputs, and patch cracks immediately.
2. Access: Accessibility is non-negotiable. Screen readers, keyboard users, contrast, focus, and semantic structure must all work.
3. Testing: Behavior-first confidence. Integration/E2E over test-count vanity, with deterministic mocks (MSW recommended).
4. Execution: Finish-line discipline. Red CI, unresolved threads, and known breakage do not ship.
5. Scales: Right-size architecture now, preserve clean growth paths for later.
6. Value: Every change must provide explicit user or product value.
7. Aesthetics: Responsive, cohesive, and design-system-aligned experiences only.

If a domain is violated, the work is not finished.
<!-- quickstart:end -->

## Ecosystem Position

Seven Shadow System is part of the Sovereign engineering ecosystem. Doctrine, policy, CI, and contributor workflow are designed to align with maintainers-first quality and durable trust.

## 1) Security

Belief:
Our software must be vault-grade by default. Security is not a feature layer; it is the foundation.

Doctrine:
No exposed secrets, no implicit trust boundaries, no unvalidated input, no silent auth bypasses. If a crack appears, patch immediately, assess blast radius, and document lessons so it does not repeat.

Principles:
- Treat all external input as untrusted until validated.
- Never hardcode secrets or sensitive credentials.
- Enforce server-side authorization for protected actions.
- Preserve auditable remediation when risk is found.

Anti-patterns:
- "Ship now, harden later" security posture.
- Trusting client-supplied permissions.
- Leaving known vulnerabilities unresolved before merge.

Enforcement intent:
Block critical trust-boundary and secret hygiene failures, warn on emerging security debt.

## 2) Access (Accessibility)

Belief:
If someone cannot use what we build because of disability-related barriers, we did not finish building it.

Doctrine:
Accessibility is respect in implementation form. The full experience must work with screen readers, keyboard-only navigation, sufficient contrast, visible focus, semantic labels, and correct language metadata.

Principles:
- Ensure every interactive flow is keyboard-usable.
- Provide accessible names for controls and meaningful alt text for non-decorative images.
- Keep contrast and focus visibility at usable standards.
- Validate with assistive-tech-aware checks, not visual-only assumptions.

Anti-patterns:
- Accessibility treated as optional cleanup.
- Color-only communication of state.
- Missing ARIA/labels for critical controls.

Enforcement intent:
Block severe accessibility barriers, warn on advisory gaps like skip-nav, screen-reader validation, and metadata omissions.

## 3) Testing

Belief:
Tests exist to prove real user behavior still works, not to inflate coverage optics.

Doctrine:
Behavior-first testing is primary. Integration and E2E tests drive confidence on user-facing changes; critical unit tests protect deterministic logic. External systems should be mocked for deterministic CI.

Principles:
- Prioritize user-flow assertions over implementation detail assertions.
- Add regression coverage for behavior-changing fixes.
- Keep tests deterministic with controlled dependencies (MSW recommended for API mocking).
- Use E2E tooling (Playwright/Cypress) where full workflow confidence is required.

Anti-patterns:
- Snapshot-only confidence.
- Tests that rely on production APIs.
- Feature changes shipped with no behavior-level evidence.

Enforcement intent:
Block untested behavior risk and unmocked external dependency patterns; warn on brittle or low-signal testing strategy.

## 4) Execution

Belief:
Standards are measured at the finish line, not mid-race.

Doctrine:
Execution discipline means no merge with red CI, unresolved critical threads, or known broken behavior. Quality is a completion criterion.

Principles:
- Resolve blocking checks before merge.
- Close critical discussion loops before release.
- Keep delivery artifacts deterministic and auditable.

Anti-patterns:
- Merging through red checks.
- Deferring known breakage to "next PR".
- Shipping unresolved critical review debt.

Enforcement intent:
Block unresolved execution blockers, warn on bounded operational debt.

## 5) Scales

Belief:
Build for current size without trapping future growth.

Doctrine:
Avoid both over-engineering and short-sighted architecture. Keep systems simple for current load but structured for clean expansion.

Principles:
- Right-size complexity to present requirements.
- Preserve modular boundaries to avoid future rewrites.
- Contain blast radius in large changes.

Anti-patterns:
- Premature distributed complexity.
- Monolithic coupling that blocks independent scaling.
- Massive unreviewable change sets.

Enforcement intent:
Block hard scaling ceilings and extreme blast-radius risks; warn on over-complexity and medium risk.

## 6) Value

Belief:
If a change has no user or product value, it should not ship.

Doctrine:
Every feature, surface, and interaction needs explicit purpose. Remove noise, reduce cognitive load, and prioritize outcomes over novelty.

Principles:
- Tie changes to user or product outcomes.
- Prefer clarity and utility over decorative complexity.
- Reject duplicate/no-value additions.

Anti-patterns:
- Generic low-effort review commentary with no evidence.
- Feature additions without outcome rationale.
- Dead or unused surfaces left in merged work.

Enforcement intent:
Block high-confidence low-value/duplicate churn, warn on thin rationale.

## 7) Aesthetics

Belief:
Visual quality communicates engineering quality.

Doctrine:
Responsive integrity and cohesive design-system alignment are non-negotiable. Interfaces should feel intentional, not stitched together.

Principles:
- Preserve responsive behavior across breakpoints.
- Align spacing, typography, and component patterns with system standards.
- Keep visual output cohesive and intentional.

Anti-patterns:
- Mobile breakage accepted as minor.
- Design-system drift on touched surfaces.
- Inconsistent visual language across related views.

Enforcement intent:
Block severe responsive/design-system regressions, warn on stylistic inconsistency debt.
