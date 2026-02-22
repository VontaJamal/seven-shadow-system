# Security Policy

Seven Shadow System is a governance control surface, so we treat security issues as high priority.

## Quick Summary

- Report vulnerabilities privately and include reproducible artifacts.
- Security controls are fail-closed by default.
- Runtime processing and telemetry boundaries are explicitly constrained.

## Supported Versions

Only actively maintained minor releases receive fixes. See `ROADMAP.md` for release windows.

## Reporting a Vulnerability

- Email: security@rinshari.com
- Include reproduction steps, affected versions, and impact.
- If possible, include a minimal event payload and policy file.

Please do not disclose publicly until maintainers confirm a fix and advisory window.

## Security Baselines

- Fail-closed defaults for malformed and unsupported events.
- Deterministic policy parsing and stable finding codes.
- Regex safety gate to reject unsafe patterns.
- Least-privilege workflow permissions.
- Supply-chain gates for dependency review + OpenSSF Scorecard thresholds.
- Secret detection CI gate (`.github/workflows/secret-scan.yml`) to block committed credentials.
- Signed SBOM/checksum release artifacts with Sigstore.
- No telemetry in core runtime by default.
- Redacted reports by default (body hashes, not raw review content).
- Sentinel log extraction is bounded (`max-runs`, `max-log-bytes`, `max-lines-per-run`) to prevent unbounded CI log processing.

## Data Boundary

Seven Shadow System does not transmit data to external telemetry services. Provider API calls are only for required governance checks (for example, approval verification via GitHub API when enabled).
