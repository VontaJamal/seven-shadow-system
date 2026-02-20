# Seven Shadow System

Seven Shadow System is an open-source AI review guard for open source repositories.
It helps maintainers detect and govern AI-influenced review content in pull requests and comments.

It is designed to be reused across repositories as a **git submodule**, similar to `rinshari-ui`.

## Beginner Friendly

You do **not** need to know anything about Animate, advanced automation systems, or governance frameworks to use this.

If you can:
1. Clone a repo
2. Run a script
3. Open a pull request

you can use Seven Shadow System.

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

What this does:
1. Builds the guard
2. Runs test coverage
3. Runs one policy check against a sample GitHub event

## What It Actually Guards

Seven Shadow System can enforce rules like:
1. Block known bot-only reviewers
2. Require AI disclosure tags (for example `[AI-ASSISTED]`)
3. Score suspicious AI-pattern language
4. Require a minimum number of human approvals

It outputs a clear decision:
1. `pass`
2. `warn`
3. `block`

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

After wiring, the target repo has a ready-to-edit policy file and a ready-to-run GitHub workflow.

## Core Files

- Engine: `src/sevenShadowSystem.ts`
- Tests: `test/sevenShadowSystem.test.ts`
- Default policy: `config/seven-shadow-system.policy.json`
- Integration guide: `references/submodule-integration.md`
