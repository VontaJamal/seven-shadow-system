# Seven Shadow System

Seven Shadow System is an open-source AI review guard for maintainers.

It helps you detect and govern AI-influenced review content in pull requests and comments.

## Quick Summary

- Use this project to enforce deterministic review policy decisions (`pass`, `warn`, `block`).
- It supports CLI usage, npm package usage, and submodule integration.
- Start with the 3-minute local check, then wire it into CI for enforcement.

## The Seven Shadows

| Shadow | Domain |
| --- | --- |
| Aesthetics | Keep product surfaces clear, consistent, and intentionally designed so maintainers can parse risk quickly. |
| Security | Enforce trust boundaries, safe defaults, and strict token/input handling across all runtime paths. |
| Access | Enforce accessibility for all users: keyboard navigation, screen-reader semantics, contrast, focus visibility, and usable structure. |
| Testing | Prove behavior with deterministic unit, integration, and end-to-end coverage before release. |
| Execution | Ship with clean-tree discipline, deterministic workflows, and CI-complete release hygiene. |
| Scales | Bound processing and output sizes so runtime behavior remains predictable under load. |
| Value | Prioritize changes that reduce maintainer toil, increase trust, or materially improve adoption. |

## Doctrine-First V3

Seven Shadows Doctrine v3 introduces an explicit doctrine contract and a dedicated gate command:

- Narrative doctrine: `references/seven-shadow-doctrine.md`
- Machine doctrine schema: `schemas/shadow-doctrine-v1.schema.json`
- Doctrine sample: `config/shadow-doctrine.sample.json`
- Policy v3 schema: `schemas/policy-v3.schema.json`
- Shadow Gate report schema: `schemas/report-v3.schema.json`
- Exceptions schema: `schemas/shadow-exceptions-v1.schema.json`

### New commands

```bash
7s doctrine --quickstart
7s doctrine-lint --doctrine config/shadow-doctrine.sample.json --policy config/seven-shadow-system.policy.v3.sample.json
7s shadow-gate --policy config/seven-shadow-system.policy.v3.sample.json --doctrine config/shadow-doctrine.sample.json --event examples/pr_review_event.json --event-name pull_request_review
```

Stage progression for Shadow Gate: `whisper -> oath -> throne`.

## Start Here (Beginner)

You do not need advanced governance frameworks or complex CI setup to start.

If you can run `npm` and edit a JSON file, you can use this.

## 3-minute Local Check

```bash
npm install
npm test
npm run guard:seven-shadow -- --event examples/pr_review_event.json --event-name pull_request_review
```

## CLI

Primary binary aliases:

- `7s`
- `seven-shadow-system`

Guard mode remains backward compatible:

```bash
seven-shadow-system --policy config/seven-shadow-system.policy.json --event examples/pr_review_event.json --event-name pull_request_review
7s guard --policy config/seven-shadow-system.policy.json --event examples/pr_review_event.json --event-name pull_request_review
```

Shadow Gate (doctrine-grade review) with policy v3:

```bash
7s shadow-gate \
  --policy config/seven-shadow-system.policy.v3.sample.json \
  --doctrine config/shadow-doctrine.sample.json \
  --event examples/pr_review_event.json \
  --event-name pull_request_review
```

Sentinel Eye commands (GitHub-first in this phase):

```bash
7s comments --pr 123 --repo owner/repo --format md
7s failures --pr 123 --repo owner/repo --format md
7s lint --pr 123 --repo owner/repo --format json
7s test-quality --path test --format md
7s patterns --repo owner/repo --limit 20 --format md
7s inbox --repo owner/repo --limit 20 --format md
7s score --repo owner/repo --format md
7s digest --repo owner/repo --limit 20 --format md
7s dashboard --repo owner/repo --limit 20
```

Use **Settings** in the dashboard to tune Inbox, Patterns, Scoring, and Processing Limits, then apply them directly to Sentinel config.

Full command reference: `docs/sentinel-eye.md`
Dashboard reference: `docs/sentinel-eye-dashboard.md`

Sentinel Eye config (optional):

- default path: `.seven-shadow/sentinel-eye.json`
- schema: `schemas/sentinel-eye-v1.schema.json`
- sample: `config/sentinel-eye.sample.json`

## What Decision You Get

Each run ends with one result:

1. `pass` - policy checks passed
2. `warn` - policy concerns found but not blocking
3. `block` - policy failed and should stop merge/release flow

## What It Can Enforce

- Block known bot-only review sources
- Require disclosure tags (for example `[AI-ASSISTED]`)
- Score suspicious AI-style language patterns
- Require a minimum number of human approvals

If your policy requires human approvals (`minHumanApprovals > 0`), the guard needs `GITHUB_TOKEN`.
Without it, the run blocks by design.

Dashboard auth fallback order (GitHub):

1. `GITHUB_TOKEN` env var
2. `gh auth token`
3. interactive `gh auth login --web` flow

## Use It as a Submodule

Seven Shadow System is built to be reused in other repositories.

Wire it into a target repo:

```bash
./scripts/wire-submodule.sh /absolute/path/to/target-repo
```

By default it adds:

- `governance/seven-shadow-system` (submodule)
- `.seven-shadow/policy.json` (policy file)
- `.github/workflows/seven-shadow-system.yml` (workflow)
- `README.md` protection footer with:
  - `Protected by the Seven Shadows`
  - `Explore the Vault` link

Skip README footer injection if a consumer needs custom docs handling:

```bash
./scripts/wire-submodule.sh --skip-readme-badge /absolute/path/to/target-repo
```

## Policy Basics

Main policy file:

- `config/seven-shadow-system.policy.json`
- `config/seven-shadow-system.policy.v3.sample.json` (doctrine-grade stage/risk controls)

Consumer repos usually copy policy to:

- `.seven-shadow/policy.json`

Mac-first canonical documentation paths use `/Users/.../seven-shadow-system/...` while runtime commands remain cross-platform via relative paths and Node path resolution.

## Foundation-First

This project is intentionally a foundation.

You can:

- Use it as-is
- Fork it and customize rules
- Use it to spark your own governance system

## Core Files

- Engine: `src/sevenShadowSystem.ts`
- CLI dispatcher: `src/cli.ts`
- Sentinel command family (`comments`, `failures`, `lint`, `test-quality`, `patterns`, `inbox`, `score`, `digest`): `src/commands/`
- Dashboard server + GUI assets: `src/commands/dashboard.ts`, `src/dashboard/`, `apps/dashboard/`
- Log parsers: `src/parsers/`
- Tests: `test/sevenShadowSystem.test.ts`
- Submodule installer: `scripts/wire-submodule.sh`
- Integration guide: `references/submodule-integration.md`

## Security and Quality Gates

- CI + conformance + provider contracts + accessibility snapshots
- Supply-chain checks (dependency review + Scorecard)
- Secret scanning workflow (`.github/workflows/secret-scan.yml`)
- PR template aligned to all Seven Shadow domains (`.github/pull_request_template.md`)

## Open Source

- License: MIT (`LICENSE`)
- Public repo model for community extension and reuse

---
