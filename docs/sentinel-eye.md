# Sentinel Eye Commands

Sentinel Eye extends Seven Shadow System with deterministic, agent-readable PR intelligence.

## Commands

### `7s comments`

List unresolved PR review comments with deterministic `file:line` locations.

```bash
7s comments --pr 123 --repo owner/repo --format md
```

Flags:

- `--pr <number>`: pull request number (optional; auto-detected from current branch when omitted)
- `--repo <owner/repo>`: repository slug (optional; detected from `origin` remote when omitted)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--format md|xml|json`: output format (default: `md`)

### `7s failures`

Extract failing CI logs and keep only high-signal error context.

```bash
7s failures --pr 123 --repo owner/repo --format md
```

Flags:

- `--pr <number>`: pull request number (optional; auto-detected unless `--run` is supplied)
- `--run <id>`: specific CI run id
- `--repo <owner/repo>`: repository slug (optional)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--format md|json`: output format (default: `md`)
- `--context-lines <n>`: context before/after each match (default: `5`)
- `--max-lines-per-run <n>`: output cap per run (default: `200`)
- `--max-runs <n>`: max failing runs to inspect (default: `10`)
- `--max-log-bytes <n>`: max bytes to process per job log (default: `5000000`)
- `--match <token,token,...>`: match tokens for high-signal filtering

### `7s lint`

Parse lint/type/test failures from CI logs into structured findings.

```bash
7s lint --pr 123 --repo owner/repo --format json
```

Flags are the same as `7s failures`, with `--format` defaulting to `json`.

Supported parser families:

- ESLint
- TypeScript (`tsc`)
- Jest
- Vitest
- Python (`pytest`, `flake8`, `mypy`)
- Generic fallback parser

### `7s test-quality`

Evaluate test naming quality and basic inflation/consolidation signals.

```bash
7s test-quality --path test --format md
```

Flags:

- `--path <dir>`: root test directory (default: `test`)
- `--format md|json`: output format (default: `md`)
- `--base-ref <ref>` / `--head-ref <ref>`: optional git refs for diff-based metrics
- `--provider github|gitlab|bitbucket`: accepted for CLI parity (default: `github`)
- `--repo <owner/repo>` / `--pr <number>`: accepted for CLI parity

### `7s patterns`

Cluster open pull requests by path-area, title fingerprint, and failure signatures.

```bash
7s patterns --repo owner/repo --limit 20 --format md
```

Flags:

- `--repo <owner/repo>`: repository slug (optional)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--limit <n>`: max clusters to return (default: `20`)
- `--format md|json`: output format (default: `md`)
- `--config <path>`: optional path to Sentinel Eye config

### `7s inbox`

Rank pull-request notifications by deterministic triage score.

```bash
7s inbox --repo owner/repo --limit 20 --format md
```

Flags:

- `--repo <owner/repo>`: repository slug (optional)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--limit <n>`: max ranked PRs to return (default: `20`)
- `--all`: include read notifications
- `--format md|json`: output format (default: `md`)
- `--config <path>`: optional path to Sentinel Eye config

### `7s score`

Compute trust/priority scores for a PR or the open PR queue.

```bash
7s score --repo owner/repo --format md
7s score --repo owner/repo --pr 42 --format json
```

Flags:

- `--pr <number>`: score a specific pull request
- `--repo <owner/repo>`: repository slug (optional)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--limit <n>`: max ranked PRs to return when scoring multiple PRs (default: `20`)
- `--format md|json`: output format (default: `md`)
- `--config <path>`: optional path to Sentinel Eye config

### `7s digest`

Emit a maintainer digest: top-priority PRs plus top pattern clusters.

```bash
7s digest --repo owner/repo --limit 20 --format md
```

Flags:

- `--repo <owner/repo>`: repository slug (optional)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--limit <n>`: max items per digest section (default: `20`)
- `--all`: include read notifications
- `--format md|json`: output format (default: `md`)
- `--config <path>`: optional path to Sentinel Eye config

### `7s dashboard`

Run a local maintainer dashboard GUI backed by deterministic Sentinel Eye data.

```bash
7s dashboard --repo owner/repo --limit 20
```

Flags:

- `--repo <owner/repo>`: repository slug (optional)
- `--provider github|gitlab|bitbucket`: provider name (default: `github`)
- `--limit <n>`: max ranked items per section (default: `20`)
- `--config <path>`: optional path to Sentinel Eye config
- `--host 127.0.0.1|0.0.0.0`: bind host (default: `127.0.0.1`)
- `--port <n>`: bind port (default: `7777`)
- `--refresh-sec <n>`: base auto-refresh interval in seconds (default: `120`)
- `--open`: force browser auto-open even outside interactive mode
- `--no-open`: disable browser auto-open

Runtime API endpoints exposed by the dashboard server:

- `GET /healthz`
- `GET /api/v1/dashboard/status`
- `GET /api/v1/dashboard/snapshot`
- `POST /api/v1/dashboard/refresh`

## Sentinel Eye Config

Default config path:

- `.seven-shadow/sentinel-eye.json`

Schema:

- `schemas/sentinel-eye-v1.schema.json`

Sample:

- `config/sentinel-eye.sample.json`

If the default config file does not exist, deterministic built-in defaults are used.

## Provider Support in This Phase

- GitHub: implemented
- GitLab: returns deterministic `E_SENTINEL_PROVIDER_NOT_IMPLEMENTED`
- Bitbucket: returns deterministic `E_SENTINEL_PROVIDER_NOT_IMPLEMENTED`

## Authentication

Sentinel commands reuse existing provider token conventions:

- `GITHUB_TOKEN` for GitHub
- `GITLAB_TOKEN` for GitLab
- `BITBUCKET_TOKEN` for Bitbucket

Dashboard GitHub auth resolution order:

1. `GITHUB_TOKEN`
2. `gh auth token`
3. interactive `gh auth login --web --hostname github.com --scopes repo,read:org,notifications`

`7s inbox` fails closed by default if notification scope is missing.

## Compatibility

Guard mode is unchanged:

- `seven-shadow-system --policy ...` still runs guard mode
- `7s guard --policy ...` runs the same guard mode through subcommand dispatch

Script aliases are additive:

- existing `sentinel:*` npm scripts remain supported
- new `eye:*` aliases mirror Sentinel commands
- `sentinel:dashboard` / `eye:dashboard` launch the GUI after asset build
