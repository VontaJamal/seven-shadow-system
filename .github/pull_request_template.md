## Summary

- What changed:
- Why this change is valuable:
- Risk level (low/medium/high):

## Seven Shadows Checklist

- [ ] Security: No secrets/tokens added, auth and input boundaries reviewed.
- [ ] Access: CLI/docs/output changes preserve plain-language and readable structure.
- [ ] Testing: New behavior has tests; regressions are covered.
- [ ] Execution: Scope is coherent, no debug leftovers/commented-out code.
- [ ] Scales: Runtime/output bounds considered (size, loops, memory, CI volume).
- [ ] Value: PR explains user/business outcome, not only implementation detail.
- [ ] Aesthetics: Naming/output/style align with repo conventions.

## Validation

- [ ] `npm test`
- [ ] `npm run validate:schemas`
- [ ] `npm run validate:security-gates`
- [ ] Additional checks run (if any):

## Security and Access Impact

- Security impact:
- Access impact:

## Rollout / Rollback

- Rollout plan:
- Rollback plan:
