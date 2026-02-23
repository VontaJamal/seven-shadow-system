import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { renderShadowGateMarkdown } from "../src/shadows/engine";
import type { ShadowGateReportV3 } from "../src/shadows/types";

interface ShadowGateSnapshot {
  markdown: string;
}

async function readSnapshot(): Promise<ShadowGateSnapshot> {
  const snapshotPath = path.join(process.cwd(), "test", "snapshots", "shadow-gate.snapshot.json");
  const raw = await fs.readFile(snapshotPath, "utf8");
  return JSON.parse(raw) as ShadowGateSnapshot;
}

test("shadow gate markdown output remains stable and readable without color", async () => {
  const report: ShadowGateReportV3 = {
    schemaVersion: 3,
    timestamp: "2026-02-23T10:00:00.000Z",
    provider: "github",
    eventName: "pull_request_review",
    policyVersion: 3,
    enforcementStage: "oath",
    decision: "block",
    selectedDomains: ["Security", "Access"],
    targetsScanned: 2,
    highestAiScore: 0.612,
    findings: [
      {
        code: "SHADOW_SECURITY_TRUST_BOUNDARY",
        domain: "Security",
        severity: "high",
        message: "Auth/trust-boundary regression signal detected.",
        remediation: "Enforce server-side authorization and explicit trust boundaries on sensitive routes.",
        effectiveDecision: "block"
      },
      {
        code: "SHADOW_ACCESS_MISSING_ARIA_LABEL",
        domain: "Access",
        severity: "high",
        message: "Accessibility issue: interactive controls appear unlabeled for assistive technology.",
        remediation: "Add appropriate accessible names (e.g., aria-label or linked label text) to interactive controls.",
        effectiveDecision: "block"
      }
    ],
    shadowDecisions: [
      {
        domain: "Security",
        score: 58,
        decision: "block",
        rationale: "Security evaluates secret hygiene, injection vectors, trust boundaries, and guard integrity signals.",
        findings: [
          {
            code: "SHADOW_SECURITY_TRUST_BOUNDARY",
            domain: "Security",
            severity: "high",
            message: "Auth/trust-boundary regression signal detected.",
            remediation: "Enforce server-side authorization and explicit trust boundaries on sensitive routes.",
            effectiveDecision: "block"
          }
        ]
      },
      {
        domain: "Access",
        score: 41,
        decision: "block",
        rationale: "Access evaluates user-facing accessibility fundamentals: semantic labeling, keyboard support, contrast, and assistive-tech readiness.",
        findings: [
          {
            code: "SHADOW_ACCESS_MISSING_ARIA_LABEL",
            domain: "Access",
            severity: "high",
            message: "Accessibility issue: interactive controls appear unlabeled for assistive technology.",
            remediation: "Add appropriate accessible names (e.g., aria-label or linked label text) to interactive controls.",
            effectiveDecision: "block"
          }
        ]
      }
    ],
    exceptionsApplied: [],
    accessibilitySummary: {
      plainLanguageDecision: "Block: 2 finding(s) require action at OATH stage before merge.",
      statusWords: {
        pass: "Pass",
        warn: "Warn",
        block: "Block"
      },
      nonColorStatusSignals: true,
      screenReaderFriendly: true,
      cognitiveLoad: "low"
    }
  };

  const markdown = renderShadowGateMarkdown(report, { useColor: false });
  assert.equal(/\u001b\[[0-9;]*m/.test(markdown), false);

  const expected = await readSnapshot();
  assert.deepEqual(
    {
      markdown
    },
    expected
  );
});
