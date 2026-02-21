# Changelog

All notable changes to Seven Shadow System are documented in this file.

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
