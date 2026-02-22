# Trust Rollout Bootstrap PR

Generated at: `{{GENERATED_AT}}`  
Target repository: `{{TARGET_REPO}}`  
Submodule path: `{{SUBMODULE_PATH}}`

Use this template to keep trust rollout changes reviewable and auditable.

## Summary

This PR scaffolds trust rollout assets for Seven Shadow System in an opt-in, fail-safe mode.

- Trust store schema version: `{{TRUST_STORE_VERSION}}`
- Trust store path: `{{TRUST_STORE_PATH}}`
- Bundle template path: `{{POLICY_BUNDLE_TEMPLATE_PATH}}`
- Trust lint snapshot: `{{LINT_SNAPSHOT_PATH}}`

## Changes Included

- Added/updated governance submodule wiring.
- Added trust-store scaffold for bundle verification mode.
- Added policy bundle template and quickstart runbook.
- Captured deterministic trust-store lint output for review.

## Reviewer Checklist

- [ ] Confirm trust-store signer set and lifecycle state are expected.
- [ ] Confirm trust lint snapshot is valid JSON and includes expected signers.
- [ ] Confirm no active policy bundle mode was auto-enabled.
- [ ] Confirm workflow changes are intentional for this repository.

## Follow-up Steps

1. Create and sign `.seven-shadow/policy.bundle.json` from template when rollout is approved.
2. Enable bundle verification mode in workflow after trust review.
3. Keep trust-store lifecycle changes auditable with `trust:rotate-rsa` and `trust:revoke`.
