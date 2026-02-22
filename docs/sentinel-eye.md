# Sentinel Eye Commands

Sentinel Eye extends Seven Shadow System with agent-readable PR intelligence.

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

## Provider Support in This Phase

- GitHub: implemented
- GitLab: returns deterministic `E_SENTINEL_PROVIDER_NOT_IMPLEMENTED`
- Bitbucket: returns deterministic `E_SENTINEL_PROVIDER_NOT_IMPLEMENTED`

## Authentication

Sentinel commands reuse existing provider token conventions:

- `GITHUB_TOKEN` for GitHub
- `GITLAB_TOKEN` for GitLab
- `BITBUCKET_TOKEN` for Bitbucket

## Compatibility

Guard mode is unchanged:

- `seven-shadow-system --policy ...` still runs guard mode
- `7s guard --policy ...` runs the same guard mode through subcommand dispatch
