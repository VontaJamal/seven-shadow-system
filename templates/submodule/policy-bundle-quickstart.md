# Policy Bundle Quickstart

This file is scaffolded by `wire-submodule.sh --with-bundle-trust`.

## 1) Create an unsigned schema v2 bundle

```bash
npm run policy-bundle:create -- \
  --schema-version 2 \
  --policy .seven-shadow/policy.json \
  --schema governance/seven-shadow-system/schemas/policy-v2.schema.json \
  --required-signatures 1 \
  --output .seven-shadow/policy.bundle.json
```

## 2) Sign the bundle

RSA signer:

```bash
npm run policy-bundle:sign -- \
  --bundle .seven-shadow/policy.bundle.json \
  --key-id maintainer \
  --private-key keys/maintainer.pem
```

Keyless signer:

```bash
npm run policy-bundle:sign-keyless -- \
  --bundle .seven-shadow/policy.bundle.json \
  --signer-id release-keyless
```

## 3) Verify bundle trust

```bash
npm run policy-bundle:verify -- \
  --bundle .seven-shadow/policy.bundle.json \
  --schema governance/seven-shadow-system/schemas/policy-v2.schema.json \
  --trust-store .seven-shadow/policy-trust-store.json
```

## 4) Enable runtime bundle mode

Use these runtime flags:

```bash
--policy-bundle .seven-shadow/policy.bundle.json \
--policy-schema governance/seven-shadow-system/schemas/policy-v2.schema.json \
--policy-trust-store .seven-shadow/policy-trust-store.json
```
