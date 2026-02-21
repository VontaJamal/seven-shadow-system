# Accessibility Contract

Accessibility is a release gate for Seven Shadow System output surfaces.

## Scope

- CLI output and error messages.
- JSON report schema and field naming clarity.
- Markdown summary report readability.
- SARIF result descriptions and remediation text.
- Governance docs and setup instructions.

## Required Checks

- Every decision has plain-language explanation (`pass`, `warn`, `block`).
- Status must be encoded in text, not color.
- Finding messages must include concise remediation guidance.
- JSON keys and values must avoid ambiguous abbreviations.
- Markdown report structure must use semantic headings and flat lists.

## Cognitive Load Guardrails

- Favor short, explicit sentences over jargon.
- Keep top-level decision and risk summary within first section.
- Keep remediation directly attached to each finding.

## Verification

- Unit tests assert plain-language decision summaries.
- Snapshot checks validate report structure for JSON/Markdown/SARIF (`test/accessibility.snapshot.test.ts`).
- PR review checklist must include accessibility review line item.
