# Trust Store Rollback Runbook

Use this runbook when policy bundle verification starts failing after a trust-store change (rotation/revocation/lifecycle update).

Follow these steps to restore verification safely while keeping evidence for audit review.

## Goals

1. Restore policy verification quickly using a known-good trust contract.
2. Preserve auditability of what changed and why.
3. Keep fail-closed behavior intact while restoring availability.

## Last-Known-Good (LKG) Convention

Bootstrap output now reserves:

- `.seven-shadow/trust-rollout/last-known-good/policy-trust-store.json`
- `.seven-shadow/trust-rollout/last-known-good/trust-lint.json`

Do not edit these files manually during incident response. Treat them as rollback baselines.

## Rollback Drill (No Production Mutation)

1. Validate current trust store:

```bash
npm run trust:lint -- --trust-store .seven-shadow/policy-trust-store.json --format json
```

2. Validate LKG trust store:

```bash
npm run trust:lint -- --trust-store .seven-shadow/trust-rollout/last-known-good/policy-trust-store.json --format json
```

3. Verify bundle with current trust store:

```bash
npm run policy-bundle:verify -- \
  --bundle .seven-shadow/policy.bundle.json \
  --schema governance/seven-shadow-system/schemas/policy-v2.schema.json \
  --trust-store .seven-shadow/policy-trust-store.json
```

4. Verify the same bundle with LKG trust store:

```bash
npm run policy-bundle:verify -- \
  --bundle .seven-shadow/policy.bundle.json \
  --schema governance/seven-shadow-system/schemas/policy-v2.schema.json \
  --trust-store .seven-shadow/trust-rollout/last-known-good/policy-trust-store.json
```

Interpretation:

- current fails + LKG passes: rollback candidate is validated.
- both fail: stop and escalate signer/bundle investigation.
- current passes: no rollback required.

## Incident Rollback Procedure

1. Create emergency branch in consumer repo.
2. Replace active trust store with LKG version.
3. Re-run trust lint + bundle verify + runtime guard check.
4. Merge emergency rollback PR with incident reference.
5. Open follow-up PR to correct lifecycle metadata and re-introduce intended signer changes.

## Evidence Checklist

- failing command output (current trust store)
- passing command output (LKG trust store, if applicable)
- trust-lint snapshots before/after
- emergency rollback PR link
- corrective follow-up PR link
