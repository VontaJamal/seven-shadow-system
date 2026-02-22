# Policy Governance Controls

This document covers advanced governance controls layered on top of core Seven Shadow scoring.

It is the reference for signed bundles, trust stores, lifecycle operations, replay controls, and rollout safeguards.

## 1) Signed Policy Bundles (v1 + v2)

Signed bundles make policy distribution tamper-evident.

Common bundle fields:

- `schemaVersion`
- `createdAt`
- `policySchemaPath`
- `policySchemaSha256`
- `policySha256`
- `requiredSignatures`
- `policy`
- `signatures[]`

Signature formats:

- Bundle `schemaVersion=1`: `signatures[]` entries are RSA (`keyId`, `algorithm=rsa-sha256`, `signature`).
- Bundle `schemaVersion=2`: `signatures[]` is a union:
  - RSA: `signatureType=rsa`, `keyId`, `algorithm=rsa-sha256`, `signature`
  - Keyless: `signatureType=sigstore-keyless`, `signerId`, `algorithm=sigstore-keyless`, `bundle`

Bundle CLI:

- `create` supports `--schema-version 1|2` (default `1`).
- `sign` adds RSA signatures.
- `sign-keyless` adds embedded Sigstore keyless signatures (v2 bundles only).
- `verify` supports either `--public-key keyId=path` (legacy) or `--trust-store <path>`.

## 2) Trust Store (v1 + v2)

Trust stores define exactly which signers are allowed to satisfy bundle quorum.

Runtime flags:

- `--policy-bundle <path>`
- `--policy-schema <path>`
- `--provider github|gitlab|bitbucket`
- One of:
  - `--policy-public-key <keyId=path>` (legacy RSA path)
  - `--policy-trust-store <path>` (recommended)

Provider approval token environment variables:

- `github`: `GITHUB_TOKEN`
- `gitlab`: `GITLAB_TOKEN`
- `bitbucket`: `BITBUCKET_TOKEN`

GitLab provider notes:

- Supported webhook event names are exact: `Merge Request Hook`, `Note Hook`.
- Recommended token scope is read-only API scope (`read_api`).
- The approvals endpoint may be unavailable depending on plan/tier/self-managed configuration; this fails closed via `GUARD_APPROVALS_UNVERIFIED` when required approvals cannot be verified.

Trust store schemas:

- `schemas/policy-trust-store-v1.schema.json`
- `schemas/policy-trust-store-v2.schema.json`

Sample configs:

- `config/policy-trust-store.sample.json`
- `config/policy-trust-store.v2.sample.json`

Identity matching for keyless signers is exact:

- `certificateIssuer` must match exactly
- `certificateIdentityURI` must match exactly

If quorum is not met, verification fails closed with `E_POLICY_BUNDLE_SIGNATURES_INVALID`.

## 3) Rotation + Revocation Lifecycle (Trust Store v2)

Trust store v2 adds signer lifecycle controls:

- `state`: `active | retired | revoked`
- `validFrom` / `validUntil`
- `replaces` / `replacedBy` (audit linkage)

Semantics:

- Revoked signers are **retroactively blocked** (`E_POLICY_TRUST_SIGNER_REVOKED`).
- Signatures outside lifecycle windows fail (`E_POLICY_TRUST_SIGNER_OUTSIDE_VALIDITY`).
- Invalid lifecycle metadata fails closed (`E_POLICY_TRUST_STORE_INVALID_LIFECYCLE`).

Migration guide:

- `docs/migrations/policy-trust-store-v1-to-v2.md`

Trust-store operations CLI:

- `lint --trust-store <path> [--format text|json]`
- `rotate-rsa --trust-store <path> --old-signer <id> --new-signer <id> --new-key-id <keyId> --new-public-key <pemPath> --effective-at <ISO8601> --output <path>`
- `revoke --trust-store <path> --signer <id> --output <path>`
- `./scripts/bootstrap-trust-rollout.sh [--force] [--trust-store-version 1|2] [--submodule-path <path>] <target-repo>`
- `node dist/scripts/org-trust-rollout.js --targets <path> [--trust-store-version 1|2] [--submodule-path <path>] [--force] [--report <path>] [--format text|json]`

Bootstrap rollout output (in consumer repos):

- `.seven-shadow/trust-rollout/trust-lint.json`
- `.seven-shadow/trust-rollout/pr-template.md`
- `.seven-shadow/trust-rollout/last-known-good/policy-trust-store.json`
- `.seven-shadow/trust-rollout/last-known-good/trust-lint.json`

Org rollout targets file (schema v1):

- `config/trust-rollout-targets.sample.json`
- `schemas/trust-rollout-targets-v1.schema.json`

Org rollout status output:

- each target is reported as `pending`, `passing`, or `blocked`
- blocked targets preserve deterministic bootstrap error codes when available (`E_TRUST_ROLLOUT_*`)

Rollback and recovery guidance:

- `docs/runbooks/trust-store-rollback.md`

Deterministic trust-tool error codes:

- `E_POLICY_TRUST_TOOL_ARG_REQUIRED`
- `E_POLICY_TRUST_TOOL_VERSION_REQUIRED`
- `E_POLICY_TRUST_TOOL_SIGNER_NOT_FOUND`
- `E_POLICY_TRUST_TOOL_SIGNER_EXISTS`
- `E_POLICY_TRUST_TOOL_KEYID_EXISTS`
- `E_POLICY_TRUST_TOOL_EFFECTIVE_AT_INVALID`

## 4) Org Policy with Constrained Local Overrides

This mode lets organizations publish a central policy while allowing bounded local tuning.

Runtime flags:

- `--org-policy <path>`
- `--local-policy <path>` (optional; defaults to `--policy` path)
- `--override-constraints <path>` (optional)

Default constraints file:

- `config/policy-override-constraints.json`

Forbidden override paths return `E_POLICY_OVERRIDE_FORBIDDEN`.

## 5) Deterministic Replay Gate

Replay mode compares current output against a baseline report after removing volatile fields.

Runtime flag:

- `--replay-report <path>`

On mismatch runtime emits:

- `GUARD_REPLAY_MISMATCH` (severity: `block`)

## 6) Provider Contract Tests

Provider adapters are validated through a reusable contract harness and fixture pack:

- `test/providerContractHarness.ts`
- `test/providers.contract.test.ts`
- `conformance/provider-contract/manifest.json`
- `conformance/provider-contract/providers/*.json`

Current contract checks include:

- extraction determinism
- malformed payload behavior
- pull-context extraction
- approval counting semantics

Current fixture coverage:

- `github`
- `gitlab`
- `bitbucket`

## 7) Accessibility Snapshot Gate

Accessibility is treated as a release gate for output surfaces:

- JSON report snapshot
- Markdown summary snapshot
- SARIF snapshot

Snapshot files:

- `test/accessibility.snapshot.test.ts`
- `test/snapshots/accessibility-report.snapshot.json`

## 8) RC Soak Replay Gate

Release candidates are expected to pass deterministic replay soak checks:

- script: `npm run soak:rc -- --iterations 72 --report rc-soak-report.json`
- workflow: `.github/workflows/rc-soak.yml`

The soak gate verifies:

- replay output hash stability across GitHub/GitLab/Bitbucket fixtures
- fail-closed provider approval behavior under missing token conditions (`GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_TOKEN`)
