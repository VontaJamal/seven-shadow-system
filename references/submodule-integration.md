# Submodule Integration

Seven Shadow System is designed for idempotent submodule-first integration.

## Standard Layout

- `governance/seven-shadow-system` (submodule)
- `.seven-shadow/policy.json` (consumer policy)
- `.github/workflows/seven-shadow-system.yml` (consumer enforcement workflow)

## Install

```bash
./scripts/wire-submodule.sh /absolute/path/to/consumer-repo
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
