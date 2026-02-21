# Policy Migration: v1 to v2

Policy v2 adds runtime, report, and approvals blocks for explicit fail-closed behavior.

## Automated Migration

```bash
npm run migrate:policy -- path/to/policy-v1.json path/to/policy-v2.json
```

If output path is omitted, the script writes `<input-name>.v2.json` next to the input.

## Key Changes

- `version`: `1` -> `2`
- `minHumanApprovals` moved to `approvals.minHumanApprovals`
- New `runtime` block:
  - `failOnUnsupportedEvent`
  - `failOnMalformedPayload`
  - `maxBodyChars`
  - `maxTargets`
  - `maxEventBytes`
- New `report` block:
  - `includeBodies`
  - `redactionMode`
- New approvals controls:
  - `approvals.fetchTimeoutMs`
  - `approvals.maxPages`
  - `approvals.retry.enabled`
  - `approvals.retry.maxAttempts`
  - `approvals.retry.baseDelayMs`
  - `approvals.retry.maxDelayMs`
  - `approvals.retry.jitterRatio`
  - `approvals.retry.retryableStatusCodes`

## Compatibility

- Runtime still accepts v1 files in legacy mode.
- New deployments should use v2 files for hardened defaults.
