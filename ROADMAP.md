# Roadmap

## Quick Summary

- The roadmap moves from foundation hardening to ecosystem and dashboard maturity.
- Each milestone builds on deterministic governance, provider coverage, and triage UX.
- `1.0` marks stable contracts and long-term support posture.

## 0.2 Foundation Hardening

- Policy v2 default contract.
- Fail-closed runtime controls.
- Redacted multi-format reporting (JSON/Markdown/SARIF).
- Security/governance baseline docs and contributor controls.

## 0.3 Provider Adapter Expansion

- Provider adapter test harness.
- Additional provider adapters (community-driven).
- Compatibility test matrix across providers.

## 0.4 Policy Ecosystem

- RFC-approved policy packs.
- Rule validation and profiling tooling.
- Public benchmark suite for AI-review governance scenarios.

## 0.5 Rinshari Dashboard

The Rinshari UI — a local web dashboard for repo health and PR triage.

- `npx 7s dashboard` launches localhost viewer
- PR queue ranked by trust score (AI-generated, low-effort, duplicate detection)
- Pattern clustering: group PRs touching the same files, similar titles, recurring CI failures
- Noise vs. signal scoring per PR and per contributor
- One-click batch triage for clustered PRs
- Policy configuration GUI (checkboxes and sliders instead of raw JSON)
- Notification filter view: surface only what needs human eyes
- Mobile-responsive for on-the-go triage
- Civilian-friendly: zero config required to launch, sensible defaults

## 0.6 Pattern Intelligence

Signal extraction for maintainers drowning in notifications.

- **`7s patterns`** — Cluster PRs by: files touched, author behavior, similar descriptions, recurring CI failures. Surface "these 47 PRs are all doing the same thing" for batch triage.
- **`7s inbox`** — Pull GitHub notifications, score by signal weight (maintainer comment > bot comment > first-time contributor), filter noise, show only what needs human attention.
- **`7s score`** — Trust score per PR. Factors: AI-generated probability, effort level, duplication of existing issues, test coverage delta, review comment resolution rate. Rank the 10 PRs that matter out of 200.
- **`7s digest`** — Daily/weekly summary of repo activity. What changed, what's stuck, what needs you. Email or CLI output.

## 1.0 Baseline Standard

- Stable policy/report schemas.
- Long-term support branch.
- Published interoperability guide for downstream governance boards.
