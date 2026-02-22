# BUILD SPEC: Civilian Mode for Seven Shadow System

## Quick Summary

- Civilian mode changes presentation language, not enforcement behavior.
- Teams can adopt it through CLI flag, config, or environment variable.
- The goal is enterprise-friendly wording with identical policy outcomes.

## Overview

Seven Shadow System includes themed terminology in standard output. Civilian mode provides plain professional wording for teams that want neutral presentation.

Functionality remains identical. Only output language changes.

---

## Flag: `--civilian` / `--mode civilian`

### CLI Usage

```bash
# Lore mode (default)
npm run guard:seven-shadow -- --policy .seven-shadow/policy.json --event event.json

# Civilian mode
npm run guard:seven-shadow -- --civilian --policy .seven-shadow/policy.json --event event.json
```

### Config-based (in `.seven-shadow/policy.json`)

```json
{
  "mode": "civilian",
  ...
}
```

If `mode` is set in the policy file, it applies to all runs unless overridden by CLI flag. Repos can permanently set civilian mode without passing the flag every time.

### Environment Variable

```bash
SEVEN_SHADOW_MODE=civilian
```

Priority: CLI flag > env var > policy.json > default (lore)

---

## Output Differences

### Lore Mode (default)

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

### Civilian Mode

```
PR Quality Gate — Results

1. Security ......................... ✅ Pass
2. Accessibility .................... ✅ Pass
3. Testing .......................... ⚠️ Warning — no new tests added
4. Execution ........................ ✅ Pass
5. Scales ........................... ✅ Pass
6. Value ............................ ✅ Pass
7. Aesthetics ....................... ❌ Fail — console.log left in component

Policy: .seven-shadow/policy.json
Verdict: BLOCKED — 1 check failed
```

### Key Differences

| Element | Lore | Civilian |
|---------|------|----------|
| Header | "Seven Shadow System — Gauntlet Results" | "PR Quality Gate — Results" |
| Domain labels | "Shadow 1: Security" | "1. Security" |
| Reference file | "Doctrine" | "Policy" |
| Verdict language | "shadow violated" | "check failed" |
| Emoji | 🛡️ shields, ⚔️ swords | None, or minimal ✅❌⚠️ only |
| Badge text | "Protected by the Seven Shadows" | "PR quality enforced" |

---

## README Badge Variants

The repo should provide two copy-paste badge snippets:

### Lore Badge (for Sovereign repos, anime devs, people who get it)

```markdown
## Protected by the [Seven Shadows](https://github.com/VontaJamal/seven-shadow-system)
```

### Civilian Badge (for enterprise, corporate, external repos)

```markdown
## PR Quality · [Seven Shadow System](https://github.com/VontaJamal/seven-shadow-system)

All pull requests are checked against 7 quality domains: Security, Accessibility, Testing, Execution, Scalability, Value, and Aesthetics.
```

Both link to the same repo. The civilian version explains what it does. The lore version lets the curious click through and discover the world.

---

## Agent-Readable Doctrine

This is the real product differentiator. The doctrine file needs TWO sections:

### For Humans (already exists)
Prose descriptions of what each shadow means, philosophy, examples.

### For Agents (NEW — `agent-instructions` block)
A structured, machine-parseable section that AI coding agents can read before writing a PR. Each shadow gets:

```yaml
# In seven-shadow-doctrine.md or a separate agent-doctrine.yml

agent_instructions:
  security:
    before_writing:
      - Never hardcode secrets, API keys, or tokens
      - All user input must be sanitized before use
      - Use parameterized queries for any database access
      - Check for path traversal in file operations
    before_submitting:
      - Run secret detection scan (e.g., `gitleaks`, `trufflehog`)
      - Verify no new dependencies with known CVEs
      - Confirm auth/authz on any new endpoints

  accessibility:
    before_writing:
      - All interactive elements must be keyboard-accessible
      - Use semantic HTML elements (button, nav, main, not div for everything)
      - Color must not be the only indicator of state
      - All images need alt text
    before_submitting:
      - Run axe-core or similar a11y scan on changed components
      - Verify tab order makes sense

  testing:
    before_writing:
      - New features require at least one integration test
      - Bug fixes require a regression test
      - Don't write unit tests for trivial getters/setters
    before_submitting:
      - All existing tests must pass
      - New tests must actually test behavior, not implementation details

  execution:
    before_writing:
      - One PR per feature/fix — no mega PRs
      - Branch name follows convention
      - Commits are atomic and descriptive
    before_submitting:
      - No console.logs or debug statements
      - No commented-out code
      - Clean git history (squash if needed)

  scales:
    before_writing:
      - Don't over-engineer. Start simple.
      - No premature optimization
      - If adding a dependency, justify it
    before_submitting:
      - No unnecessary abstractions
      - Bundle size impact considered

  value:
    before_writing:
      - This change must serve a user need or business goal
      - If it's a refactor, document why it matters
    before_submitting:
      - PR description explains the "why" not just the "what"

  aesthetics:
    before_writing:
      - Follow existing code style and patterns in the repo
      - UI changes should be consistent with existing design language
    before_submitting:
      - Linting passes
      - No style regressions
```

### How Agents Use This

1. Agent sees "Protected by the Seven Shadows" badge on repo README
2. Agent fetches `references/seven-shadow-doctrine.md` or `agent-doctrine.yml`
3. Agent reads the `agent_instructions` for each shadow
4. Agent writes code following all `before_writing` rules
5. Agent runs all `before_submitting` checks before creating the PR
6. Seven Shadow CI validates independently — agent's self-check + CI verification = double gate

The doctrine becomes a **contract between the repo and any agent that touches it.** The agent doesn't need to understand "shadows" or "gauntlets" — it just reads structured YAML and follows instructions.

---

## Implementation Checklist

- [ ] Add `--civilian` flag to CLI parser
- [ ] Add `mode` field to policy.json schema
- [ ] Add `SEVEN_SHADOW_MODE` env var support
- [ ] Create output formatter that switches on mode (lore vs civilian)
- [ ] Write civilian badge snippet in main README under "Installation" or "Usage"
- [ ] Create `agent-doctrine.yml` template with structured instructions
- [ ] Update README to explain both modes
- [ ] Add civilian mode to CI workflow template (so teams can set it in their `.github/`)
- [ ] Test: same policy, same event, lore output vs civilian output — functionality identical

---

## Success Criteria

1. A Fortune 500 engineering team can install this without anyone asking "why is it called Seven Shadows"
2. An AI coding agent (Claude, Copilot, Cursor) can read the doctrine and produce a PR that passes all 7 checks on first submission
3. A Sovereign repo maintainer sees the themed output and feels at home
4. Switching modes changes ZERO functionality — only presentation

---

*The civilians see a quality gate. The Court sees the Seven Shadows. Same system. Two faces.*
