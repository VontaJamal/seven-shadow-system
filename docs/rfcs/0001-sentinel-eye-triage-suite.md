# RFC 0001: Sentinel Eye Triage Suite

## Problem Statement
Sentinel Eye currently surfaces comments/failures/lint/test-quality but lacks deterministic maintainer triage ranking for high-volume PR streams.

## Goals
- Add deterministic `7s patterns`, `7s inbox`, `7s score`, `7s digest` commands.
- Keep fail-closed behavior under missing auth/scope/malformed upstream payloads.
- Preserve backward compatibility with existing Sentinel command surface.
- Keep provider rollout GitHub-first with deterministic not-implemented behavior for others.

## Non-goals
- No dashboard or web UI.
- No auto-triage write actions (close/reply/label).
- No change to guard-mode enforcement semantics.

## Proposed Design
- Introduce `.seven-shadow/sentinel-eye.json` config with schema validation and bounded limits.
- Extend `SentinelProviderAdapter` with notifications/open PR/PR summary/PR files reads.
- Add shared triage engine:
  - deterministic signal enrichment per PR
  - bounded weighted scoring
  - pattern cluster extraction across path/title/failure signatures
- Add new CLI commands:
  - `7s patterns`
  - `7s inbox`
  - `7s score`
  - `7s digest`

## Alternatives Considered
- Heuristic-only no-config scoring: rejected for auditability and repo-specific tuning.
- AI-assisted scoring: rejected for deterministic baseline release.
- Renaming Sentinel Eye command family: rejected to preserve compatibility.

## Migration and Compatibility
- Existing Sentinel commands are unchanged.
- New `eye:*` npm aliases are additive.
- Existing `sentinel:*` scripts remain valid.

## Rollout and Rollback Plan
- Roll out as RC milestone with docs/changelog.
- Rollback path: disable new command usage and pin to previous RC tag.

## Security and Accessibility Impact
- Security: fail-closed notification scope enforcement and strict bounded API retrieval.
- Accessibility: markdown outputs remain heading-based with flat lists and explicit signal wording.
