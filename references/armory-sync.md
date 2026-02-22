# Armory Sync Staging

This file stages external reference payloads that should be copied into the separate Armory repository.

Use it as the deterministic handoff log for cross-repo idea synchronization.

## Sync Rule

- Source repo: `seven-shadow-system`
- Destination repo: Armory (external)
- This file is the deterministic handoff payload. Do not mutate source wording during copy.

## Entries

### 2026-02-21 — Jarred Sumner request (Sentinel Eye)

- Source: public post by Jarred Sumner (`@jarredsumner`) requesting unresolved PR comment context, failing CI extraction, and lint extraction for agent workflows.
- Product mapping in this repo:
  - `7s comments`
  - `7s failures`
  - `7s lint`
- Local reference: `BUILD-SPEC-SENTINEL-EYE.md`
- Classification: `agentic-engineering`, `pr-governance`, `ci-intelligence`

### 2026-02-21 — Nnenna test quality philosophy

- Source: public post from Nnenna on behavioral test naming and consolidation (fewer tests, clearer specs, maintained coverage).
- Product mapping in this repo:
  - `7s test-quality`
- Local reference: `BUILD-SPEC-SENTINEL-EYE.md`
- Classification: `testing-doctrine`, `behavioral-specs`, `quality-over-quantity`

## Copy Payload Template (Armory)

Use this JSON payload when creating/updating an Armory entry:

```json
{
  "sourceRepo": "seven-shadow-system",
  "capturedAt": "2026-02-21",
  "domain": "agentic-engineering",
  "topics": [
    "pr-intelligence",
    "ci-failure-extraction",
    "lint-structuring",
    "behavioral-test-quality"
  ],
  "artifacts": [
    "BUILD-SPEC-SENTINEL-EYE.md",
    "docs/sentinel-eye.md"
  ],
  "notes": "Sentinel Eye command family and behavioral test-quality checks were derived from public signal and mapped to deterministic CLI surfaces."
}
```
