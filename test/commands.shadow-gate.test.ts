import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseShadowGateArgs } from "../src/commands/shadowGate";
import { evaluateShadowGate } from "../src/shadows/engine";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadJson(relativePath: string): Promise<unknown> {
  const absolutePath = path.join(process.cwd(), relativePath);
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw) as unknown;
}

test("parseShadowGateArgs applies defaults", () => {
  const parsed = parseShadowGateArgs([]);
  assert.equal(parsed.policyPath, "config/seven-shadow-system.policy.v3.sample.json");
  assert.equal(parsed.doctrinePath, "config/shadow-doctrine.sample.json");
  assert.equal(parsed.providerName, "github");
  assert.equal(parsed.format, "md");
});

test("parseShadowGateArgs rejects unknown flags", () => {
  assert.throws(() => {
    parseShadowGateArgs(["--unknown"]);
  }, /E_SHADOW_ARG_UNKNOWN/);
});

test("stage behavior: whisper warns while throne blocks for same high-severity finding", async () => {
  const policyRaw = (await loadJson("config/seven-shadow-system.policy.v3.sample.json")) as Record<string, unknown>;
  const doctrineRaw = await loadJson("config/shadow-doctrine.sample.json");

  const eventPayload = {
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 99,
      title: "UI update",
      body: "UI adjustment with missing alt text and missing aria label.",
      changed_files: 4,
      additions: 60,
      deletions: 10,
      user: {
        login: "repo-owner",
        type: "User"
      }
    },
    review: {
      id: 18,
      body: "This is keyboard inaccessible and has insufficient color contrast.",
      user: {
        login: "reviewer",
        type: "User"
      }
    }
  };

  const whisperPolicy = clone(policyRaw);
  whisperPolicy.enforcementStage = "whisper";
  (whisperPolicy.coveragePolicy as { sizeBands: { small: { domains: number } }; tieBreakOrder: string[] }).sizeBands.small.domains = 1;
  (whisperPolicy.coveragePolicy as { tieBreakOrder: string[] }).tieBreakOrder = [
    "Access",
    "Security",
    "Testing",
    "Execution",
    "Scales",
    "Value",
    "Aesthetics"
  ];

  const thronePolicy = clone(whisperPolicy);
  thronePolicy.enforcementStage = "throne";

  const whisper = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw: whisperPolicy,
    doctrineRaw
  }).report;

  const throne = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw: thronePolicy,
    doctrineRaw
  }).report;

  assert.equal(whisper.decision, "warn");
  assert.equal(throne.decision, "block");
});

test("risk-ranked selection is deterministic across identical input", async () => {
  const policyRaw = (await loadJson("config/seven-shadow-system.policy.v3.sample.json")) as Record<string, unknown>;
  const doctrineRaw = await loadJson("config/shadow-doctrine.sample.json");

  const eventPayload = {
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 100,
      title: "Refactor runtime",
      body: "Behavior change with no tests added and potential auth boundary drift.",
      changed_files: 14,
      additions: 500,
      deletions: 100,
      user: {
        login: "repo-owner",
        type: "User"
      }
    },
    review: {
      id: 20,
      body: "No tests added for this behavior change and missing auth check on protected route.",
      user: {
        login: "reviewer-two",
        type: "User"
      }
    }
  };

  const first = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw,
    doctrineRaw
  }).report;

  const second = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw,
    doctrineRaw
  }).report;

  assert.deepEqual(first.selectedDomains, second.selectedDomains);
});

test("exception expiry toggles finding suppression deterministically", async () => {
  const policyRaw = (await loadJson("config/seven-shadow-system.policy.v3.sample.json")) as Record<string, unknown>;
  const doctrineRaw = await loadJson("config/shadow-doctrine.sample.json");

  const tunedPolicy = clone(policyRaw);
  tunedPolicy.enforcementStage = "throne";
  (tunedPolicy.coveragePolicy as { sizeBands: { small: { domains: number } }; tieBreakOrder: string[] }).sizeBands.small.domains = 1;
  (tunedPolicy.coveragePolicy as { tieBreakOrder: string[] }).tieBreakOrder = [
    "Access",
    "Security",
    "Testing",
    "Execution",
    "Scales",
    "Value",
    "Aesthetics"
  ];
  (tunedPolicy.shadowThresholds as Record<string, { warnAt: number; blockAt: number }>).Access = {
    warnAt: 100,
    blockAt: 100
  };
  const shadowRules = tunedPolicy.shadowRules as Record<string, { enabled: boolean; checkSeverities: Record<string, string> }>;
  shadowRules.Security.enabled = false;
  shadowRules.Testing.enabled = false;
  shadowRules.Execution.enabled = false;
  shadowRules.Scales.enabled = false;
  shadowRules.Value.enabled = false;
  shadowRules.Aesthetics.enabled = false;

  const eventPayload = {
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 101,
      title: "Accessibility update",
      body: "missing alt text and missing aria label",
      changed_files: 2,
      additions: 30,
      deletions: 2,
      user: {
        login: "repo-owner",
        type: "User"
      }
    },
    review: {
      id: 21,
      body: "keyboard inaccessible",
      user: {
        login: "reviewer-three",
        type: "User"
      }
    }
  };

  const active = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw: tunedPolicy,
    doctrineRaw,
    exceptionsRaw: [
      {
        check: "SHADOW_ACCESS_KEYBOARD_INACCESSIBLE",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_MISSING_ALT_TEXT",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_MISSING_ARIA_LABEL",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_CONTRAST_FAIL",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_FOCUS_VISIBILITY",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_ADVISORY_GAPS",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_A11Y_EVIDENCE_MISSING",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_RISK_WARN_THRESHOLD",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      },
      {
        check: "SHADOW_ACCESS_RISK_BLOCK_THRESHOLD",
        reason: "Temporary accessibility exception",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    ]
  }).report;

  const expired = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw: tunedPolicy,
    doctrineRaw,
    exceptionsRaw: [
      {
        check: "SHADOW_ACCESS_KEYBOARD_INACCESSIBLE",
        reason: "Expired exception",
        expiresAt: "2020-01-01T00:00:00.000Z"
      }
    ]
  }).report;

  assert.equal(active.decision, "pass");
  assert.equal(expired.decision, "block");
});

test("access findings are mapped to Access domain (not readability category)", async () => {
  const policyRaw = (await loadJson("config/seven-shadow-system.policy.v3.sample.json")) as Record<string, unknown>;
  const doctrineRaw = await loadJson("config/shadow-doctrine.sample.json");

  const tunedPolicy = clone(policyRaw);
  tunedPolicy.enforcementStage = "throne";
  (tunedPolicy.coveragePolicy as { sizeBands: { small: { domains: number } }; tieBreakOrder: string[] }).sizeBands.small.domains = 1;
  (tunedPolicy.coveragePolicy as { tieBreakOrder: string[] }).tieBreakOrder = [
    "Access",
    "Security",
    "Testing",
    "Execution",
    "Scales",
    "Value",
    "Aesthetics"
  ];

  const eventPayload = {
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 102,
      title: "Accessibility fixes",
      body: "missing alt text and keyboard inaccessible",
      changed_files: 1,
      additions: 20,
      deletions: 2,
      user: {
        login: "repo-owner",
        type: "User"
      }
    },
    review: {
      id: 22,
      body: "insufficient color contrast",
      user: {
        login: "reviewer-four",
        type: "User"
      }
    }
  };

  const report = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw: tunedPolicy,
    doctrineRaw
  }).report;

  assert.equal(report.selectedDomains[0], "Access");
  assert.equal(report.findings.every((finding) => finding.domain === "Access"), true);
});

test("v2 compatibility: shadow gate runs unchanged v2 policy files", async () => {
  const policyRaw = (await loadJson("config/seven-shadow-system.policy.json")) as Record<string, unknown>;
  const doctrineRaw = await loadJson("config/shadow-doctrine.sample.json");

  const eventPayload = {
    repository: {
      full_name: "acme/repo"
    },
    pull_request: {
      number: 103,
      title: "Small docs cleanup",
      body: "Documentation polish with no risk keywords.",
      changed_files: 1,
      additions: 8,
      deletions: 2,
      user: {
        login: "repo-owner",
        type: "User"
      }
    },
    review: {
      id: 23,
      body: "Looks good with clear rationale and user impact.",
      user: {
        login: "reviewer-five",
        type: "User"
      }
    }
  };

  const report = evaluateShadowGate({
    providerName: "github",
    eventName: "pull_request_review",
    eventPayload,
    policyRaw,
    doctrineRaw
  }).report;

  assert.equal(report.policyVersion, 2);
  assert.equal(report.enforcementStage, "whisper");
});
