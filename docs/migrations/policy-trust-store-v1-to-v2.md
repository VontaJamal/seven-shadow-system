# Migration: Policy Trust Store v1 -> v2

This guide upgrades trust stores from schema v1 (signer identity only) to schema v2 (signer lifecycle + rotation metadata).

Use this migration when you need signer lifecycle controls and auditable key rotation metadata.

## Why Migrate

Trust store v2 adds auditable lifecycle controls:

- `state`: `active | retired | revoked`
- `validFrom` / `validUntil`
- `replaces` / `replacedBy`

It also enables deterministic lifecycle enforcement during policy bundle verification.

## Field Mapping

Start from existing v1 signer entries and add lifecycle fields.

### RSA signer example

v1:

```json
{
  "id": "maintainer-rsa",
  "type": "rsa-key",
  "keyId": "maintainer",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----..."
}
```

v2:

```json
{
  "id": "maintainer-rsa",
  "type": "rsa-key",
  "keyId": "maintainer",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----...",
  "state": "active",
  "validFrom": "2026-01-01T00:00:00.000Z"
}
```

### Keyless signer example

v1:

```json
{
  "id": "release-keyless",
  "type": "sigstore-keyless",
  "certificateIssuer": "https://token.actions.githubusercontent.com",
  "certificateIdentityURI": "https://github.com/ORG/REPO/.github/workflows/release.yml@refs/tags/v0.2.0"
}
```

v2:

```json
{
  "id": "release-keyless",
  "type": "sigstore-keyless",
  "certificateIssuer": "https://token.actions.githubusercontent.com",
  "certificateIdentityURI": "https://github.com/ORG/REPO/.github/workflows/release.yml@refs/tags/v0.2.0",
  "state": "active",
  "validFrom": "2026-01-01T00:00:00.000Z"
}
```

## Rotation Pattern

1. Add new signer as `active` with `validFrom`.
2. Keep old signer `active` during overlap.
3. Mark old signer `retired`, set `validUntil`, and link:
   - old signer `replacedBy: <new-id>`
   - new signer `replaces: <old-id>`

## Revocation Pattern

Set compromised signers to:

- `state: "revoked"`

Revocation is retroactive for verification (`E_POLICY_TRUST_SIGNER_REVOKED`).

## Validation

Schema files:

- `schemas/policy-trust-store-v1.schema.json`
- `schemas/policy-trust-store-v2.schema.json`

Check locally:

```bash
npm run validate:schemas
```
