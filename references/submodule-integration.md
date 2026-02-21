# Submodule Integration

Seven Shadow System is designed for idempotent submodule-first integration.

## Standard Layout

- `governance/seven-shadow-system` (submodule)
- `.seven-shadow/policy.json` (consumer policy)
- `.seven-shadow/policy.bundle.json` (optional signed policy bundle)
- `.seven-shadow/policy-trust-store.json` (optional trust store for bundle verification)
- `.github/workflows/seven-shadow-system.yml` (consumer enforcement workflow)

## Install

```bash
./scripts/wire-submodule.sh /absolute/path/to/consumer-repo
```

Optional bundle/trust scaffold:

```bash
./scripts/wire-submodule.sh --with-bundle-trust --trust-store-version 2 /absolute/path/to/consumer-repo
```

Optional overwrite of existing workflow template:

```bash
./scripts/wire-submodule.sh --force /absolute/path/to/consumer-repo
```

## Consumer Workflow Trigger

Recommended events:

- `pull_request_review`
- `pull_request_review_comment`
- `issue_comment` (PR-only)

## Local Run in Consumer Repo

```bash
node governance/seven-shadow-system/dist/src/sevenShadowSystem.js \
  --policy .seven-shadow/policy.json \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME" \
  --report .seven-shadow/reports/github-report \
  --report-format all \
  --redact
```

Bundle mode (optional):

```bash
node governance/seven-shadow-system/dist/src/sevenShadowSystem.js \
  --policy-bundle .seven-shadow/policy.bundle.json \
  --policy-schema governance/seven-shadow-system/schemas/policy-v2.schema.json \
  --policy-trust-store .seven-shadow/policy-trust-store.json \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME" \
  --report .seven-shadow/reports/github-report \
  --report-format all \
  --redact
```

Scaffolded trust files (when `--with-bundle-trust` is used):

- `.seven-shadow/policy-trust-store.json`
- `.seven-shadow/policy.bundle.template.json`
- `.seven-shadow/policy-bundle-quickstart.md`
