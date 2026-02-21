# Seven Shadow System

Seven Shadow System is an open-source governance baseline for AI-influenced pull request review quality.

It gives maintainers deterministic controls to detect, block, and audit low-trust AI review patterns.

## Quick Start

```bash
npm install
npm test
npm run guard:seven-shadow -- --event examples/pr_review_event.json --event-name pull_request_review
```

If `approvals.minHumanApprovals > 0` and `GITHUB_TOKEN` is not available, the guard will intentionally return `block`.

## Decisions

Each run returns one decision:

1. `pass` - no policy findings
2. `warn` - findings exist but enforcement allows warnings
3. `block` - policy violations or runtime trust failures

## Policy v2 Defaults (Fail-Closed)

- Unsupported events can block (`runtime.failOnUnsupportedEvent`)
- Malformed payloads can block (`runtime.failOnMalformedPayload`)
- Oversized review bodies and target floods are bounded
- Human approval verification is required when configured
- Reports are redacted by default (`report.includeBodies=false`, hash evidence)

Default policy file: `config/seven-shadow-system.policy.json`

## CLI

```bash
node dist/src/sevenShadowSystem.js \
  --policy config/seven-shadow-system.policy.json \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME" \
  --provider github \
  --report .seven-shadow/reports/github-report \
  --report-format all \
  --redact
```

### Useful Flags

- `--provider github`
- `--report-format json|markdown|sarif|all`
- `--fail-on-unsupported-event [true|false]`
- `--max-body-chars <int>`
- `--max-event-bytes <int>`
- `--redact`
- `--policy-bundle <path>`
- `--policy-schema <path>`
- `--policy-public-key <keyId=path>` (repeatable)
- `--policy-trust-store <path>`
- `--org-policy <path>`
- `--local-policy <path>`
- `--override-constraints <path>`
- `--replay-report <path>`

## Governance Modes

### Signed Policy Bundle

Use signed policy bundles for tamper-evident policy delivery:

```bash
node dist/src/sevenShadowSystem.js \
  --policy-bundle .seven-shadow/policy.bundle.json \
  --policy-schema schemas/policy-v2.schema.json \
  --policy-trust-store .seven-shadow/policy-trust-store.json \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME"
```

Bundle tool commands:

- `npm run policy-bundle:create -- --schema-version 2 --policy config/seven-shadow-system.policy.json --schema schemas/policy-v2.schema.json --required-signatures 1 --output .seven-shadow/policy.bundle.json`
- `npm run policy-bundle:sign -- --bundle .seven-shadow/policy.bundle.json --key-id maintainer --private-key keys/maintainer.pem`
- `npm run policy-bundle:sign-keyless -- --bundle .seven-shadow/policy.bundle.json --signer-id release-keyless`
- `npm run policy-bundle:verify -- --bundle .seven-shadow/policy.bundle.json --schema schemas/policy-v2.schema.json --trust-store config/policy-trust-store.sample.json`

Trust store files:

- `config/policy-trust-store.sample.json` (schema v1)
- `config/policy-trust-store.v2.sample.json` (schema v2 with lifecycle metadata)
- `schemas/policy-trust-store-v1.schema.json`
- `schemas/policy-trust-store-v2.schema.json`

### Org Policy + Local Overrides

Apply a central org policy with constrained local tuning:

```bash
node dist/src/sevenShadowSystem.js \
  --org-policy .seven-shadow/org-policy.json \
  --local-policy .seven-shadow/local-policy.json \
  --override-constraints config/policy-override-constraints.json \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME"
```

Forbidden local override paths fail closed.

### Deterministic Replay

Replay mode compares current output to a stored baseline and blocks on drift:

```bash
node dist/src/sevenShadowSystem.js \
  --policy config/seven-shadow-system.policy.json \
  --event "$GITHUB_EVENT_PATH" \
  --event-name "$GITHUB_EVENT_NAME" \
  --replay-report .seven-shadow/baseline-report.json
```

## Report Outputs

- JSON (`GuardReportV2`) for automation and auditing
- Markdown for human-readable review board summaries
- SARIF for security and code-scanning pipelines

All reports include stable finding codes and remediation text.

## Advanced Hardening Scripts

- `npm run security:scorecard` evaluates Scorecard JSON output against `config/security-gates.json`.
- `npm run test:property` runs deterministic property checks.
- `npm run test:fuzz` runs targeted event mutation fuzzing (seed override: `FAST_CHECK_SEED`).
- `npm run conformance` runs the in-repo conformance fixture pack.
- `npm run test:provider-contract` runs provider adapter contract tests.
- `npm run provider-fixtures:bundle` builds `seven-shadow-provider-contract-fixtures-v<packageVersion>.zip`.
- `npm run test:accessibility` enforces accessibility snapshot stability.
- `npm run validate:security-gates` ensures dependency-review severity and `config/security-gates.json` stay aligned.
- `npm run sbom:generate -- --output sbom.cdx.json` generates CycloneDX SBOM output.

## Submodule Integration

```bash
./scripts/wire-submodule.sh /absolute/path/to/consumer-repo
```

This installs:

- `governance/seven-shadow-system` (submodule)
- `.seven-shadow/policy.json` (consumer policy)
- `.github/workflows/seven-shadow-system.yml` (guard workflow)

Use `--force` only when you intentionally want to overwrite an existing workflow template.

## GitHub Action Wrapper

This repo also provides a wrapper action (`action.yml`) for consumers already using the submodule layout:

```yaml
- uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332
  with:
    submodules: recursive

- uses: VontaJamal/seven-shadow-system@main
```

## Migration (v1 -> v2)

```bash
npm run migrate:policy -- path/to/policy-v1.json path/to/policy-v2.json
```

Migration guide: `docs/migrations/policy-v1-to-v2.md`

Trust-store migration guide: `docs/migrations/policy-trust-store-v1-to-v2.md`

## Open Governance

- Contributor process: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Governance model: `GOVERNANCE.md`
- Accessibility contract: `docs/accessibility-contract.md`
- Policy governance + replay controls: `docs/policy-governance.md`
- Branch protection guidance: `docs/branch-protection.md`
- Conformance pack guide: `docs/conformance-pack.md`
- Release trust chain: `docs/release-trust-chain.md`

Release safety workflow:

- `Release Dry Run / dry-run` validates release mechanics before tag-based publish.

## License

MIT (`LICENSE`)
