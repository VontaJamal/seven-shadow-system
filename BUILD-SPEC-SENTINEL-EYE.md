# BUILD SPEC: Sentinel Eye — Agent PR Intelligence

## Origin
Jarred Sumner (@jarredsumner, Bun creator) publicly requested these exact capabilities for `gh` CLI (Feb 21, 2026 — 182 likes, 8.8K views). We build it into Seven Shadow System instead.

## What It Does
Extends the Seven Shadow System guard from "detect and block" to "detect, block, and tell the agent exactly how to fix it." Three new capabilities:

### 1. Unresolved PR Review Comments (`sss comments`)
Pull unresolved review comments from a PR as structured, agent-readable output.

**Input:** `sss comments --pr <number> [--repo <owner/repo>] [--format md|xml|json]`

**Output (markdown, default):**
```markdown
## Unresolved Comments (3)

### src/providers/github.ts:42
**@reviewer** (2h ago)
> This doesn't handle the case where the token is missing. Should fall back to block.

### src/sevenShadowSystem.ts:118
**@reviewer** (2h ago)  
> Nit: this log line leaks the policy path. Strip it in production.

### test/conformance.test.ts:7
**@reviewer** (1h ago)
> Missing edge case: what happens when the event payload is empty?
```

**Output (json):**
```json
[
  {
    "file": "src/providers/github.ts",
    "line": 42,
    "author": "reviewer",
    "age": "2h",
    "body": "This doesn't handle the case where the token is missing. Should fall back to block.",
    "resolved": false,
    "url": "https://github.com/..."
  }
]
```

**Behavior:**
- Uses GitHub/GitLab/Bitbucket provider (same provider registry SSS already has)
- Only shows UNRESOLVED comments (skip resolved/outdated)
- `file:line` is mandatory in output — agents need exact locations
- Sort by file path, then line number
- If no `--repo`, detect from `.git/config` remote
- If no `--pr`, find the open PR for current branch

### 2. Failing CI Log Extraction (`sss failures`)
Pull failing GitHub Action (or GitLab CI / Bitbucket Pipeline) logs, filtered to the actual error.

**Input:** `sss failures [--pr <number>] [--run <id>] [--repo <owner/repo>] [--format md|json]`

**Output (markdown):**
```markdown
## Failing Checks (2)

### ci.yml — "Run tests" (failed)
```
FAIL test/conformance.test.ts
  ● conformance suite > should block on unverified approval
    Expected: "block"
    Received: "warn"
    at test/conformance.test.ts:47:5
```

### supply-chain.yml — "Audit dependencies" (failed)
```
npm audit found 2 vulnerabilities
  high: prototype-pollution in lodash (>=4.17.0 <4.17.21)
  Fix: npm audit fix --force
```
```

**Behavior:**
- Fetch failed check runs for the PR (or latest push)
- For each failed run, download the log
- **CRITICAL: Filter aggressively.** Strip setup steps, dependency installs, boilerplate. Only show:
  - Lines containing `FAIL`, `ERROR`, `error:`, `Error:`, `WARN` (configurable)
  - 5 lines of context before/after each match
  - The step name that failed
- Cap output at 200 lines per run (agents have context limits)
- If `--run` specified, show that specific run only
- Group by workflow file, then by step

### 3. Lint Error Extraction (`sss lint`)
Parse lint/type-check/test output from CI into structured format.

**Input:** `sss lint [--pr <number>] [--run <id>] [--format md|json]`

**Output (json):**
```json
[
  {
    "type": "lint",
    "tool": "eslint",
    "file": "src/index.ts",
    "line": 23,
    "column": 5,
    "severity": "error",
    "rule": "no-unused-vars",
    "message": "'oldConfig' is defined but never used."
  },
  {
    "type": "typecheck",
    "tool": "tsc",
    "file": "src/providers/registry.ts",
    "line": 8,
    "column": 10,
    "severity": "error",
    "message": "Property 'verify' does not exist on type 'Provider'."
  }
]
```

**Behavior:**
- Reuses `sss failures` log fetching under the hood
- Parses known tool output formats:
  - ESLint: `file:line:col: severity rule message`
  - TypeScript: `file(line,col): error TSxxxx: message`
  - Jest: `FAIL file` + assertion blocks
  - Vitest: same as Jest
  - Python (pytest, flake8, mypy): their standard formats
- Unknown formats: fall back to raw error line extraction (same as `sss failures`)
- Deduplicate: same file+line+message = one entry
- Sort by file, then line

## Architecture

### Where It Lives
```
src/
  commands/
    comments.ts    # sss comments
    failures.ts    # sss failures  
    lint.ts        # sss lint
  parsers/
    eslint.ts
    typescript.ts
    jest.ts
    pytest.ts
    generic.ts     # fallback line-match parser
  providers/       # already exists — reuse for API calls
```

### CLI Integration
Add to existing CLI entry point. These are NEW subcommands alongside the existing guard:

```bash
# Existing
sss guard --event ... --event-name ...

# New
sss comments [--pr N] [--format md|xml|json]
sss failures [--pr N] [--format md|json]  
sss lint [--pr N] [--format md|json]
```

### Auth
Reuse existing provider token pattern:
- `GITHUB_TOKEN` for GitHub
- `GITLAB_TOKEN` for GitLab  
- `BITBUCKET_TOKEN` for Bitbucket

No new auth mechanism needed.

### Dependencies
- GitHub REST API (`/repos/{owner}/{repo}/pulls/{pr}/comments`, `/actions/runs/{id}/logs`)
- GitLab equivalent endpoints
- Bitbucket equivalent endpoints
- zip extraction for GH action log archives (they come as zip)

## Test Criteria

### sss comments
- [ ] Returns unresolved comments with correct file:line
- [ ] Skips resolved comments
- [ ] Auto-detects repo from git config
- [ ] Auto-detects PR from current branch
- [ ] All 3 formats work (md, xml, json)
- [ ] Works with GitHub, GitLab, Bitbucket providers
- [ ] Empty state: "No unresolved comments" (not an error)

### sss failures
- [ ] Fetches failed check runs only (skip passing)
- [ ] Filters logs to error context (not full 10K line dump)
- [ ] Respects 200-line cap per run
- [ ] Groups by workflow → step
- [ ] Works when no CI has run yet (clean message)

### sss lint
- [ ] Parses ESLint output correctly
- [ ] Parses TypeScript errors correctly
- [ ] Parses Jest failures correctly
- [ ] Falls back to generic parser for unknown tools
- [ ] Deduplicates same-location errors
- [ ] JSON output is valid and parseable

## Style Guide
- Follow existing SSS patterns (provider registry, policy config structure)
- TypeScript, strict mode
- No new dependencies unless absolutely necessary (prefer built-in fetch, built-in zip)
- Error messages should be actionable, not cryptic
- Every command works with `--help`

## What NOT To Build
- Don't build a full CI dashboard — just the agent-relevant extraction
- Don't build comment reply/resolve — read-only for now
- Don't build notification/webhook listeners — this is pull-based CLI
- Don't touch the existing guard logic — these are parallel commands

## 4. Shadow of Testing — Behavioral Test Quality (`sss test-quality`)

Inspired by @nnennahacks (Feb 21, 2026) — she made Claude Code produce behavioral tests that read as specifications, removed 11 redundant tests, deleted 293 lines, and MAINTAINED 100% coverage. Fewer, better tests.

This extends the Shadow of Testing from "do tests pass" to "are the tests worth having."

**Input:** `sss test-quality [--path <test-dir>] [--format md|json]`

**Output (markdown):**
```markdown
## Test Quality Report

### Non-Behavioral Test Names (7 flagged)
These test names don't describe behavior — they describe implementation:

- `test/utils.test.ts:12` — `test_helper_1` → Should describe what behavior is being verified
- `test/auth.test.ts:45` — `test_it_works` → What works? Be specific.
- `test/api.test.ts:8` — `testPost` → What about the POST? What's the expected behavior?

### Behavioral Tests (Good Examples)
- `test_boolean_literals_are_flipped`
- `test_comparison_operators_are_swapped`
- `test_kill_rate_rounds_to_4_decimal_places`

### Coverage vs Test Count
- Tests added this PR: +12
- Tests removed this PR: -3
- Net lines of test code: -45 (good — consolidation)
- Coverage delta: 0% (maintained)
- Verdict: ✅ Fewer tests, same coverage = quality improvement

### Inflation Warning
⚠️ Flagged when: tests added > 2x code lines added with no coverage improvement.
This usually means padding, not testing.
```

**Behavior:**
- Parse test files in the repo (detect framework: Jest, Vitest, pytest, Go test, etc.)
- Extract all test names/descriptions
- Flag non-behavioral names using heuristics:
  - Names shorter than 5 words (e.g., `test1`, `testPost`, `it works`)
  - Names that reference function names instead of behaviors (e.g., `test_calculateTotal` vs `test_total_includes_tax_when_applicable`)
  - Names with no assertion-style language (no "should", "when", "returns", "throws", "given", etc.)
- Compare test count and coverage between base and head (if PR context available)
- Flag test inflation: many tests added but coverage unchanged = padding
- Flag test deletion that maintains coverage as POSITIVE (Nnenna's pattern)

**Test criteria:**
- [ ] Detects non-behavioral test names across Jest, pytest, Go test
- [ ] Provides good/bad examples from the actual codebase
- [ ] Calculates test-to-code ratio for PRs
- [ ] Flags inflation (many tests, no coverage gain)
- [ ] Praises consolidation (fewer tests, same coverage)
- [ ] JSON output is structured and parseable

**Philosophy (encode this):**
- "Test names are specifications. If you can't understand the system guarantees by reading test names alone, the tests are wrong."
- "100 tests at 80% coverage is worse than 38 tests at 100% coverage."
- "Removing tests that maintain coverage is an improvement, not a regression."

## Priority
Ship `sss comments` first — it's the simplest and highest value. Then `sss failures`. Then `sss lint` (which builds on failures). Then `sss test-quality` (Shadow of Testing upgrade).
