# Seven Shadow System

Seven Shadow System is an open-source AI review guard for maintainers.

It helps you detect and govern AI-influenced review content in pull requests and comments.

## Start Here (Beginner)

You do not need to know Animate, advanced governance systems, or complicated CI tooling to start.

If you can run `npm` and edit a JSON file, you can use this.

## 3-minute Local Check

```bash
npm install
npm test
npm run guard:seven-shadow -- --event examples/pr_review_event.json --event-name pull_request_review
```

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

## Policy Basics

Main policy file:

- `config/seven-shadow-system.policy.json`

Consumer repos usually copy policy to:

- `.seven-shadow/policy.json`

## Foundation-First

This project is intentionally a foundation.

You can:

- Use it as-is
- Fork it and customize rules
- Use it to spark your own governance system

## Core Files

- Engine: `src/sevenShadowSystem.ts`
- Tests: `test/sevenShadowSystem.test.ts`
- Submodule installer: `scripts/wire-submodule.sh`
- Integration guide: `references/submodule-integration.md`

## Open Source

- License: MIT (`LICENSE`)
- Public repo model for community extension and reuse
