# Branch Protection Guidance

Use these settings for `main` to enforce baseline quality:

- Require pull request before merge.
- Require approvals from CODEOWNERS.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Require signed commits where organization policy allows.

## Required Checks

- `CI / dco`
- `CI / test (20)`
- `CI / test (22)`
- `CI / schema`
- `CI / fuzz`
- `CI / conformance`
- `CI / provider-contract`
- `CI / accessibility`
- `Supply Chain / dependency-review`
- `Supply Chain / scorecard`
- `Release Dry Run / dry-run`

## Review Controls

- Enable stale review dismissal on new commits.
- Require conversation resolution before merge.
- Enforce DCO sign-off in contribution policy.
