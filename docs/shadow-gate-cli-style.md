# Shadow Gate CLI Style Guide

This guide defines deterministic output styling for `7s shadow-gate`.

## Output Structure

1. Fixed header: `# Seven Shadows Gate`
2. Stage badge: `[WHISPER] | [OATH] | [THRONE]`
3. Global decision badge: `[PASS] | [WARN] | [BLOCK]`
4. Per-domain status rows in deterministic order
5. Findings section with remediation immediately attached
6. Exceptions section (when any are active)

## Status Signaling Rules

- Text labels are mandatory for all statuses.
- Color is optional enhancement only.
- `--no-color` and non-TTY contexts must render fully readable output.

## Spacing and Determinism

- Domain labels are padded to fixed width.
- Per-domain rows preserve tie-break ordering from policy coverage config.
- Findings are sorted by domain order before rendering.

## Accessibility Requirements

- No color-only meaning.
- Remediation text appears directly under each finding.
- Plain-language summary remains available in report JSON (`accessibilitySummary`).
