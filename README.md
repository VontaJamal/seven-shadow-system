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

## CLI

Primary binary aliases:

- `sss`
- `seven-shadow-system`

Guard mode remains backward compatible:

```bash
seven-shadow-system --policy config/seven-shadow-system.policy.json --event examples/pr_review_event.json --event-name pull_request_review
sss guard --policy config/seven-shadow-system.policy.json --event examples/pr_review_event.json --event-name pull_request_review
```

Sentinel Eye commands (GitHub-first in this phase):

```bash
sss comments --pr 123 --repo owner/repo --format md
sss failures --pr 123 --repo owner/repo --format md
sss lint --pr 123 --repo owner/repo --format json
sss test-quality --path test --format md
```

Full command reference: `docs/sentinel-eye.md`

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
- CLI dispatcher: `src/cli.ts`
- Sentinel commands: `src/commands/`
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

[Explore the Vault →](https://github.com/VontaJamal/shadow-vault)

🏴‍☠️ [Sovereign](https://github.com/VontaJamal) — The Shadow Dominion.
