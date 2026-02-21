# Policy Governance Controls

This document covers the advanced governance controls added on top of core seven-shadow scoring semantics.

## 1) Signed Policy Bundles

Signed bundles make policy distribution tamper-evident.

Bundle shape:

- `schemaVersion`
- `createdAt`
- `policySchemaPath`
- `policySchemaSha256`
- `policySha256`
- `requiredSignatures`
- `policy`
- `signatures[]` (`keyId`, `algorithm`, `signature`)

Verification in runtime:

- `--policy-bundle <path>`
- `--policy-schema <path>`
- `--policy-public-key <keyId=path>` (repeatable)

If signature quorum is not met, the run fails closed before evaluation.

## 2) Org Policy with Constrained Local Overrides

This mode lets organizations publish a central policy while allowing bounded local tuning.

Runtime flags:

- `--org-policy <path>`
- `--local-policy <path>` (optional; defaults to `--policy` path)
- `--override-constraints <path>` (optional)

Default constraints file:

- `config/policy-override-constraints.json`

Forbidden override paths return `E_POLICY_OVERRIDE_FORBIDDEN`.

## 3) Deterministic Replay Gate

Replay mode compares current output against a baseline report after removing volatile fields (for example timestamp and machine-specific paths).

Runtime flag:

- `--replay-report <path>`

On mismatch, runtime emits:

- `GUARD_REPLAY_MISMATCH` (severity: `block`)

This is designed for golden-report regression checks in CI.

## 4) Provider Contract Tests

Provider adapters are validated through a reusable contract harness:

- `test/providerContractHarness.ts`
- `test/providers.contract.test.ts`

Current contract checks include:

- extraction determinism
- malformed payload behavior
- pull-context extraction
- approval counting semantics

## 5) Accessibility Snapshot Gate

Accessibility is treated as a release gate for output surfaces:

- JSON report snapshot
- Markdown summary snapshot
- SARIF snapshot

Snapshot test files:

- `test/accessibility.snapshot.test.ts`
- `test/snapshots/accessibility-report.snapshot.json`

CI job:

- `CI / accessibility`
