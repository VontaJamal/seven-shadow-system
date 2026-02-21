import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  DEFAULT_POLICY_OVERRIDE_CONSTRAINTS,
  buildPolicyBundleTemplate,
  mergePoliciesWithConstraints,
  sha256Hex,
  signPolicyBundle,
  toReplayComparable,
  verifyPolicyBundle
} from "../src/policyGovernance";

test("policy bundle signing and verification requires trusted signatures", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const schemaDigest = sha256Hex('{"$id":"policy-v2.schema"}');

  const unsignedBundle = buildPolicyBundleTemplate({
    policy: {
      version: 2,
      enforcement: "block"
    },
    policySchemaPath: "schemas/policy-v2.schema.json",
    policySchemaSha256: schemaDigest,
    requiredSignatures: 1,
    createdAt: "2026-02-21T00:00:00.000Z"
  });

  const signedBundle = signPolicyBundle(unsignedBundle, "maintainer", privateKey.export({ type: "pkcs1", format: "pem" }).toString());
  const result = verifyPolicyBundle(
    signedBundle,
    {
      maintainer: publicKey.export({ type: "pkcs1", format: "pem" }).toString()
    },
    schemaDigest
  );

  assert.deepEqual(result.validSignatures, ["maintainer"]);
});

test("org policy override merge blocks forbidden path changes", () => {
  const orgPolicy = {
    version: 2,
    runtime: {
      failOnMalformedPayload: true,
      maxTargets: 25
    }
  };

  const localPolicy = {
    runtime: {
      failOnMalformedPayload: false
    }
  };

  assert.throws(
    () => mergePoliciesWithConstraints(orgPolicy, localPolicy, DEFAULT_POLICY_OVERRIDE_CONSTRAINTS),
    /E_POLICY_OVERRIDE_FORBIDDEN/
  );
});

test("org policy override merge allows approved override paths", () => {
  const orgPolicy = {
    version: 2,
    runtime: {
      failOnMalformedPayload: true,
      maxTargets: 25
    }
  };

  const localPolicy = {
    runtime: {
      maxTargets: 50
    }
  };

  const merged = mergePoliciesWithConstraints(orgPolicy, localPolicy, DEFAULT_POLICY_OVERRIDE_CONSTRAINTS);
  assert.equal((merged.runtime as { maxTargets: number }).maxTargets, 50);
  assert.equal((merged.runtime as { failOnMalformedPayload: boolean }).failOnMalformedPayload, true);
});

test("replay comparable format ignores volatile report fields", () => {
  const first = toReplayComparable({
    schemaVersion: 2,
    timestamp: "2026-02-21T00:00:00.000Z",
    provider: "github",
    eventName: "pull_request_review",
    policyPath: "config/a.json",
    policyVersion: 2,
    enforcement: "block",
    decision: "pass",
    targetsScanned: 2,
    highestAiScore: 0.1,
    humanApprovals: { required: 0, actual: null, checked: false },
    findings: [],
    targets: [],
    evidenceHashes: {},
    accessibilitySummary: {
      plainLanguageDecision: "Pass: ok",
      statusWords: { pass: "Pass", warn: "Warn", block: "Block" },
      nonColorStatusSignals: true,
      screenReaderFriendly: true,
      cognitiveLoad: "low"
    },
    generatedReports: ["/tmp/a.json"]
  });

  const second = toReplayComparable({
    schemaVersion: 2,
    timestamp: "2026-02-22T00:00:00.000Z",
    provider: "github",
    eventName: "pull_request_review",
    policyPath: "config/a.json",
    policyVersion: 2,
    enforcement: "block",
    decision: "pass",
    targetsScanned: 2,
    highestAiScore: 0.1,
    humanApprovals: { required: 0, actual: null, checked: false },
    findings: [],
    targets: [],
    evidenceHashes: {},
    accessibilitySummary: {
      plainLanguageDecision: "Pass: ok",
      statusWords: { pass: "Pass", warn: "Warn", block: "Block" },
      nonColorStatusSignals: true,
      screenReaderFriendly: true,
      cognitiveLoad: "low"
    },
    generatedReports: ["/tmp/b.json"]
  });

  assert.equal(first, second);
});
