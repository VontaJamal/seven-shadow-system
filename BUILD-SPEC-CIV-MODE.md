# BUILD SPEC: Civ Mode — Seven Shadow System

## Summary

Add `--civ` flag to Seven Shadow System. When active, all output uses plain professional language. Zero theming, zero lore. Same checks, same enforcement, different words.

---

## How to Activate

Priority order (highest wins):

1. **CLI flag:** `--civ`
2. **Repo config:** `.sovereign.json` → `{ "mode": "civ" }`
3. **Env var:** `SOVEREIGN_MODE=civ`
4. **Default:** lore mode (current behavior)

```bash
# Per-command
npm run guard:seven-shadow -- --civ --policy .seven-shadow/policy.json

# Per-repo (create .sovereign.json in repo root)
{ "mode": "civ" }

# Per-machine
export SOVEREIGN_MODE=civ
```

---

## Output: Lore vs Civ

### Lore (default — current behavior)

```
🛡️ Seven Shadow System — Gauntlet Results

Shadow 1: Security .................. ✅ Pass
Shadow 2: Accessibility ............. ✅ Pass
Shadow 3: Testing ................... ⚠️ Warning — no new tests added
Shadow 4: Execution ................. ✅ Pass
Shadow 5: Scales .................... ✅ Pass
Shadow 6: Value ..................... ✅ Pass
Shadow 7: Aesthetics ................ ❌ Fail — console.log left in component

Doctrine: references/seven-shadow-doctrine.md
Verdict: BLOCKED — 1 shadow violated
```

### Civ

```
PR Quality Gate — Results

1. Security ......................... ✅ Pass
2. Accessibility .................... ✅ Pass
3. Testing .......................... ⚠️ Warning — no new tests added
4. Execution ........................ ✅ Pass
5. Scalability ...................... ✅ Pass
6. Value ............................ ✅ Pass
7. Aesthetics ....................... ❌ Fail — console.log left in component

Policy: .seven-shadow/policy.json
Verdict: BLOCKED — 1 check failed
```

### Full Mapping

| Element | Lore | Civ |
|---------|------|-----|
| Header | "🛡️ Seven Shadow System — Gauntlet Results" | "PR Quality Gate — Results" |
| Domain prefix | "Shadow 1: Security" | "1. Security" |
| "Scales" label | "Scales" | "Scalability" |
| Reference | "Doctrine: references/..." | "Policy: .seven-shadow/..." |
| Block verdict | "BLOCKED — 1 shadow violated" | "BLOCKED — 1 check failed" |
| Pass verdict | "ALL SHADOWS SATISFIED" | "ALL CHECKS PASSED" |
| Warning verdict | "PASSED — 1 shadow warned" | "PASSED — 1 warning" |
| Emoji | 🛡️ ⚔️ headers | None in headers. Keep ✅❌⚠️ for check results only. |

### CI Comment (GitHub PR)

**Lore:**
```
### 🛡️ Seven Shadow System

7/7 shadows satisfied. This PR may pass.
```

**Civ:**
```
### PR Quality Gate

7/7 checks passed. This PR may merge.
```

---

## Badge Variants

The README should provide both. Users copy the one they want.

### Lore Badge

```markdown
## Protected by the [Seven Shadows](https://github.com/VontaJamal/seven-shadow-system)
```

### Civ Badge

```markdown
## PR Quality · [Seven Shadow System](https://github.com/VontaJamal/seven-shadow-system)

Pull requests are validated against 7 quality domains: Security, Accessibility, Testing, Execution, Scalability, Value, and Aesthetics.
```

---

## Agent-Readable Doctrine

Create `agent-doctrine.yml` at repo root. This is the contract AI agents read before writing code for a protected repo.

```yaml
# agent-doctrine.yml
# Structured instructions for AI coding agents.
# Read this before writing any PR for this repository.

version: 1
mode: civ  # or lore — agents don't care, they read the rules

domains:
  security:
    before_writing:
      - Never hardcode secrets, API keys, or tokens
      - Sanitize all user input before use
      - Use parameterized queries for database access
      - Check for path traversal in file operations
    before_submitting:
      - Run secret detection scan
      - Verify no new dependencies with known CVEs
      - Confirm auth/authz on any new endpoints

  accessibility:
    before_writing:
      - All interactive elements must be keyboard-accessible
      - Use semantic HTML (button, nav, main — not div for everything)
      - Color must not be the only indicator of state
      - All images need alt text
    before_submitting:
      - Run a11y scan on changed components
      - Verify tab order is logical

  testing:
    before_writing:
      - New features require at least one integration test
      - Bug fixes require a regression test
      - No unit tests for trivial getters/setters
    before_submitting:
      - All existing tests pass
      - New tests test behavior, not implementation

  execution:
    before_writing:
      - One PR per feature/fix
      - Branch name follows repo convention
      - Commits are atomic and descriptive
    before_submitting:
      - No console.logs or debug statements
      - No commented-out code
      - Clean git history

  scalability:
    before_writing:
      - Start simple — don't over-engineer
      - No premature optimization
      - Justify any new dependency
    before_submitting:
      - No unnecessary abstractions
      - Consider bundle size impact

  value:
    before_writing:
      - Change must serve a user need or business goal
      - Refactors must document why they matter
    before_submitting:
      - PR description explains the "why" not just "what"

  aesthetics:
    before_writing:
      - Follow existing code style and patterns
      - UI changes consistent with existing design
    before_submitting:
      - Linting passes
      - No style regressions
```

### How Agents Use It

1. Agent sees badge on repo README → clicks through to Seven Shadow System
2. Agent fetches `agent-doctrine.yml` from the repo it's contributing to
3. Reads `before_writing` rules for all 7 domains
4. Writes code following every rule
5. Runs all `before_submitting` checks before creating PR
6. Seven Shadow CI validates independently — double gate

Repos can customize `agent-doctrine.yml` with their own rules per domain. The template above is the default.

---

## Implementation

### Files to Create/Modify

- [ ] `src/formatter.js` (or equivalent) — output formatter that switches on mode
  - `formatLore(results)` — current behavior, extract to function
  - `formatCiv(results)` — new civilian formatter
  - `getMode()` — reads CLI flag > .sovereign.json > env var > default
- [ ] `src/cli.js` — add `--civ` flag to argument parser
- [ ] `templates/agent-doctrine.yml` — default doctrine template
- [ ] `templates/badge-lore.md` — copy-paste lore badge
- [ ] `templates/badge-civ.md` — copy-paste civ badge
- [ ] `README.md` — add "Civ Mode" section with usage examples and both badges
- [ ] `.sovereign.json` schema documented

### Config Reader (new utility)

```js
function getMode(cliArgs) {
  // 1. CLI flag
  if (cliArgs.civ) return 'civ'
  
  // 2. Repo config (.sovereign.json in cwd or parents)
  const repoConfig = findUp('.sovereign.json')
  if (repoConfig?.mode) return repoConfig.mode
  
  // 3. Env var
  if (process.env.SOVEREIGN_MODE === 'civ') return 'civ'
  
  // 4. Default
  return 'lore'
}
```

This same `getMode()` pattern will be reused by every Sovereign tool later. Write it clean — it'll get extracted into a shared package eventually.

---

## Test Criteria

1. Same policy + same event → lore output has "Shadow", civ output does not
2. `--civ` flag overrides `.sovereign.json` setting
3. `.sovereign.json` with `"mode": "civ"` works without any flags
4. `SOVEREIGN_MODE=civ` env var works without any flags
5. No "Shadow", "Gauntlet", "Doctrine", or 🛡️/⚔️ in ANY civ output
6. All 7 checks execute identically in both modes — same pass/fail results
7. CI comment on GitHub PR respects mode setting
8. `agent-doctrine.yml` parses cleanly and covers all 7 domains

---

## What This Does NOT Change

- Check logic — identical in both modes
- Policy format — same `.seven-shadow/policy.json`
- CI workflow — same YAML, mode is cosmetic
- Submodule path — stays `governance/seven-shadow-system`
- Pass/fail criteria — unchanged

---

*The civilians see a quality gate. The Court sees the Seven Shadows. Same enforcement. Two languages.*
