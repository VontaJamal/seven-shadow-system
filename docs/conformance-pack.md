# Conformance Pack

Seven Shadow System ships deterministic conformance assets so downstream adapters can prove parity with the canonical runtime.

Use this document to locate fixtures, run conformance checks, and validate provider contract parity.

## Layout

Core conformance pack:

- `conformance/manifest.json`: case index
- `conformance/cases/*.json`: case expectations
- `conformance/events/*.json`: input fixtures
- `conformance/policies/*.json`: policy fixtures

Case runners:

- default `guard` runner
- optional `shadow-gate` runner for doctrine-grade v3 evaluation

Provider contract fixtures:

- `conformance/provider-contract/manifest.json`: provider fixture index
- `conformance/provider-contract/providers/*.json`: versioned provider contract fixtures

## Run Conformance Locally

```bash
npm run conformance
```

The runner executes each case through the same runtime entrypoint and fails on:

- decision drift (`pass|warn|block` mismatch)
- missing expected finding codes
- missing remediation text in findings
- expected runtime errors not observed

## Provider Contract Fixtures

```bash
npm run test:provider-contract
```

Provider fixture schema:

- `schemas/provider-contract-fixtures-v1.schema.json`

The provider contract tests load fixture JSON from `conformance/provider-contract` and execute the shared harness.

Current provider fixtures:

- `conformance/provider-contract/providers/github.v1.json`
- `conformance/provider-contract/providers/gitlab.v1.json`
- `conformance/provider-contract/providers/bitbucket.v1.json`

## Baseline Cases

- `pass`
- `warn`
- `block`
- `malformed`
- `unsupported-event`
- `oversized-event`
- `approval-unverified`
- `regex-unsafe-policy`
- `shadow-access-block`
- `shadow-testing-whisper-warn`

## Release Distribution

Releases attach both:

- `seven-shadow-conformance-bundle.zip`
- `seven-shadow-provider-contract-fixtures-v<packageVersion>.zip`

This allows downstream systems to validate runtime behavior and provider adapter compatibility without cloning source history.
