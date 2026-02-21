# Conformance Pack

Seven Shadow System ships a conformance fixture pack so downstream adapters can prove parity with the canonical runtime.

## Layout

- `conformance/manifest.json`: case index
- `conformance/cases/*.json`: case expectations
- `conformance/events/*.json`: input fixtures
- `conformance/policies/*.json`: policy fixtures

## Run Conformance Locally

```bash
npm run conformance
```

The runner executes each case through the same runtime entrypoint and fails on:

- decision drift (`pass|warn|block` mismatch)
- missing expected finding codes
- missing remediation text in findings
- expected runtime errors not observed

## Baseline Cases

- `pass`
- `warn`
- `block`
- `malformed`
- `unsupported-event`
- `oversized-event`
- `approval-unverified`
- `regex-unsafe-policy`

## Release Distribution

Releases attach `seven-shadow-conformance-bundle.zip` so downstream systems can validate integrations without cloning source history.
