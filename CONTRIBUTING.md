# Contributing to Seven Shadow System

Thanks for helping build the open baseline for trustworthy AI PR review governance.

## Core Expectations

- Keep changes deterministic, auditable, and fail-closed by default.
- Prefer explicit policy behavior over hidden heuristics.
- Preserve portability across npm, submodule, and GitHub Action integrations.
- Accessibility is a release gate for docs, CLI messaging, and generated reports.

## Contribution Flow

1. Open an issue describing the bug, risk, or proposal.
2. For behavior changes, submit an RFC under `docs/rfcs/`.
3. Implement with tests and migration notes when interfaces change.
4. Open a pull request with linked issue/RFC.

## Required PR Checks

- CI passing on Node 20 and Node 22.
- New/updated tests for policy and runtime behavior.
- Security impact noted (or explicitly marked none).
- Accessibility impact noted (including report output and docs language).

## DCO Sign-off

All commits must be signed off:

```bash
git commit -s -m "your message"
```

By signing off, you certify contribution rights under the [Developer Certificate of Origin](https://developercertificate.org/).

## RFC Process

- RFC files live in `docs/rfcs/`.
- Use incremental, decision-focused RFCs.
- Include problem statement, alternatives, migration, rollout, and rollback.
- Core policy/spec changes require council approval (see `GOVERNANCE.md`).

## Security Reporting

Do not open public issues for active vulnerabilities. See `SECURITY.md`.
