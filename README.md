# Seven Shadow System

Seven Shadow System is an open-source, composable review-governance engine for detecting and enforcing policy around AI-influenced review content.

It is designed to be reused across repositories as a **git submodule**, similar to `rinshari-ui`.

## Foundation-First

This project is intentionally built as a foundation people can adopt as-is, fork, or extend into their own doctrine system.
If it sparks a better variant, that is part of the mission.

## Open Source

- License: MIT (`LICENSE`)
- Repo model: public, fork-friendly, policy-driven

## Quick Start (Local)

```bash
npm install
npm run test
npm run guard:seven-shadow -- --event examples/pr_review_event.json --event-name pull_request_review
```

## Submodule-First Integration

Use the installer script to wire Seven Shadow System into another repository:

```bash
./scripts/wire-submodule.sh /absolute/path/to/target-repo
```

Default install path in target repos:

- `governance/seven-shadow-system`

The script will:

1. Add Seven Shadow System as a git submodule.
2. Create `.github/workflows/seven-shadow-system.yml` in the target repo.
3. Seed `.seven-shadow/policy.json` in the target repo (if missing).

## Core Files

- Engine: `src/sevenShadowSystem.ts`
- Tests: `test/sevenShadowSystem.test.ts`
- Default policy: `config/seven-shadow-system.policy.json`
- Integration guide: `references/submodule-integration.md`
