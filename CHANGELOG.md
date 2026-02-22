# Changelog

All notable changes to Seven Shadow System are documented in this file.

## Unreleased (RC prep)

### Changed

- Dashboard settings terminology is now civilian-friendly in both modes:
  - `Shadow Controls` -> `Triage Settings`
  - `Inbox Shadow` -> `Inbox`
  - `Patterns Shadow` -> `Patterns`
  - `Score Shadow` -> `Scoring`
  - `Digest + Execution Shadows` -> `Processing Limits`
  - `Apply Shadow Controls` -> `Apply Settings`
- README now includes an explicit `The Seven Shadows` section listing:
  - Aesthetics
  - Security
  - Access
  - Testing
  - Execution
  - Scales
  - Value
- Seven Shadows doctrine/checklist terminology now uses `Access` in doctrine contexts:
  - `AGENTS.md` doctrine list
  - `.github/pull_request_template.md` checklist + impact section
  - `docs/branch-protection.md` Seven Shadows enumeration
- Dashboard unit/e2e tests now assert plain-language settings labels and mode parity behavior.

### Notes

- This is an RC prep pass only:
  - no `package.json` version bump
  - no `v*` tag creation
  - no npm publish
- RC cut handoff remains separate:
  - update `package.json` version
  - create matching signed annotated tag `v<packageVersion>`
  - push tag to trigger `.github/workflows/release.yml`

## 0.3.0-rc.7 - 2026-02-22

### Added

- Dashboard settings control plane for maintainer-configurable shadow behavior.
- Dashboard config API:
  - `GET /api/v1/dashboard/config`
  - `PUT /api/v1/dashboard/config`
- GUI shadow control groups for:
  - Inbox
  - Patterns
  - Score
  - Digest/Execution bounds
- Deterministic config persistence helpers:
  - canonical serialization
  - validated write path for Sentinel Eye config

### Changed

- Dashboard now refreshes triage snapshot immediately after successful config save.
- Dashboard config endpoint can bootstrap defaults for missing `--config` files, enabling first-save setup directly from GUI.
- Dashboard docs updated to describe settings-based control workflow.

## 0.3.0-rc.6 - 2026-02-22

### Added

- Stable `7s dashboard` GUI command for local maintainer triage operations.
- Dashboard HTTP interface:
  - `GET /healthz`
  - `GET /api/v1/dashboard/status`
  - `GET /api/v1/dashboard/snapshot`
  - `POST /api/v1/dashboard/refresh`
- Civilian-first mode system with settings-only mode switching:
  - `civilian` (default)
  - `sovereign`
- Separate dashboard workspace at `apps/dashboard` using React + Vite + TypeScript.
- Dashboard backend/server modules:
  - `src/commands/dashboard.ts`
  - `src/commands/shared/dashboardAuth.ts`
  - `src/commands/shared/dashboardSnapshot.ts`
  - `src/dashboard/server.ts`
  - `src/dashboard/types.ts`
- Dashboard script aliases:
  - `sentinel:dashboard`
  - `eye:dashboard`
  - `dashboard:build`
  - `dashboard:test`
  - `dashboard:test:e2e`
- Dashboard docs:
  - `docs/sentinel-eye-dashboard.md`
- Dashboard command/unit/server tests plus GUI unit/e2e smoke tests.

### Changed

- Root package now includes `apps/dashboard` workspace wiring.
- Package publish files include prebuilt dashboard assets in `dist/dashboard/`.
- CLI dispatch help and command router now include `dashboard`.
- CLI main entrypoint now uses `process.exitCode` so long-running command surfaces (like dashboard server mode) remain alive.
- Site soul brief is now populated for the maintainer dashboard visual direction.
- CI now includes dashboard build/test/e2e coverage in a dedicated job.

## 0.3.0-rc.5 - 2026-02-22

### Added

- Sentinel Eye triage command family:
  - `7s patterns`
  - `7s inbox`
  - `7s score`
  - `7s digest`
- Sentinel Eye deterministic config contract:
  - default path `.seven-shadow/sentinel-eye.json`
  - schema `schemas/sentinel-eye-v1.schema.json`
  - sample `config/sentinel-eye.sample.json`
- Shared triage engine for deterministic ranking and pattern clustering (`src/commands/shared/triageEngine.ts`).
- GitHub Sentinel adapter support for:
  - notification listing
  - open PR listing
  - PR summary retrieval
  - PR file listing
- Additive npm script aliases:
  - `sentinel:patterns`, `sentinel:inbox`, `sentinel:score`, `sentinel:digest`
  - `eye:*` aliases mirroring Sentinel command scripts
- Naming guard test to prevent legacy doctrine-name regressions in parent repo files.
- RFC for triage suite expansion (`docs/rfcs/0001-sentinel-eye-triage-suite.md`).

### Changed

- Design-system submodule reference renamed from legacy path to `design/rinshari-eye`.
- Canonical doctrine link updated to `https://github.com/VontaJamal/rinshari-eye`.
- Sentinel Eye docs and README command references expanded for maintainer triage workflows.
- Sentinel output snapshot coverage extended to include patterns/inbox/score/digest markdown surfaces.

## 0.3.0-rc.4 - 2026-02-21

### Added

- Sentinel Eye subcommand dispatcher (`7s`) with backward-compatible guard mode:
  - `7s comments`
  - `7s failures`
  - `7s lint`
  - `7s test-quality`
- GitHub Sentinel provider adapter for unresolved review threads, failing CI run/job discovery, and zipped Actions log retrieval.
- Bounded CI log extraction controls for Sentinel commands:
  - `--max-lines-per-run` (default `200`)
  - `--context-lines` (default `5`)
  - `--max-runs` (default `10`)
  - `--max-log-bytes` (default `5000000`)
- Parser suite for CI-derived diagnostics:
  - ESLint
  - TypeScript
  - Jest
  - Vitest
  - Pytest/Flake8/Mypy
  - Generic fallback
- Secret scanning workflow (`.github/workflows/secret-scan.yml`).
- PR template with Seven Shadow domain checklist (`.github/pull_request_template.md`).
- Sentinel command output snapshot gate (`test/sentinelOutputs.snapshot.test.ts`).
- Armory handoff staging reference (`references/armory-sync.md`).
- Sentinel command documentation (`docs/sentinel-eye.md`).

### Changed

- Package binary now exposes both `seven-shadow-system` and `7s` command aliases via the new CLI dispatcher.
- Accessibility snapshot script now covers both guard and Sentinel output snapshots.
- Branch protection guidance now includes secret scan as a required check.

## 0.3.0-rc.3 - 2026-02-21

### Changed

- npm package identity changed from `@rinshari/seven-shadow-system` to `@rinshari/sss`.
- Release and release-dry-run workflows now resolve npm dist-tag from package version (`next` for prereleases, `latest` for stable releases).

### Notes

- CI npm publishing still requires an `NPM_TOKEN` that supports package publish with 2FA bypass for automation contexts.

## 0.3.0-rc.2 - 2026-02-21

### Fixed

- Release workflow npm publish authentication now correctly configures npm registry/scope via `actions/setup-node`, allowing `NPM_TOKEN` to be used for provenance publish.
- Release dry-run workflow now mirrors the same npm registry/scope auth configuration for parity.

## 0.3.0-rc.1 - 2026-02-21

### Added

- Downstream trust rollout bootstrap CLI (`scripts/bootstrap-trust-rollout.sh`) with idempotent scaffold + lint snapshot + migration PR template generation.
- GitLab smoke workflow and runtime smoke runner for provider hardening (`.github/workflows/gitlab-smoke.yml`, `scripts/gitlab-smoke.ts`).
- Bitbucket Cloud provider adapter (`src/providers/bitbucket.ts`) with deterministic malformed payload semantics and approval verification support.
- Bitbucket Server/Data Center future-plan stub metadata (`src/providers/bitbucket-server.stub.ts`).
- Bitbucket provider contract fixture (`conformance/provider-contract/providers/bitbucket.v1.json`).
- Release guardrail enforcing tag/version equality before publish (`E_RELEASE_TAG_VERSION_MISMATCH`).

### Changed

- Runtime provider support expanded to `github`, `gitlab`, and `bitbucket`.
- Provider registry and public exports now include Bitbucket surfaces.
- Provider contract manifest and schema validation now include GitHub + GitLab + Bitbucket fixture coverage.
- Action wrapper now supports non-GitHub provider tokens through `provider-token`.
- Release prep scripts added: `release:verify` and `release:rc:prepare`.

### Notes

- This is a release candidate milestone focused on trust rollout tooling, provider hardening, and multi-provider expansion.
