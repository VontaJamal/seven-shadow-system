import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  DEFAULT_POLICY_OVERRIDE_CONSTRAINTS,
  buildPolicyBundleTemplate,
  mergePoliciesWithConstraints,
  parsePolicyBundle,
  parsePolicyTrustStore,
  sha256Hex,
  signPolicyBundle,
  signPolicyBundleKeyless,
  toReplayComparable,
  verifyPolicyBundle,
  verifyPolicyBundleWithTrustStore,
  type PolicyBundleV2,
  type SigstoreAdapter
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

test("policy bundle v2 keyless signature verification enforces exact issuer and identity URI", async () => {
  const schemaDigest = sha256Hex('{"$id":"policy-v2.schema"}');
  const unsignedBundle = buildPolicyBundleTemplate({
    schemaVersion: 2,
    policy: {
      version: 2,
      enforcement: "block"
    },
    policySchemaPath: "schemas/policy-v2.schema.json",
    policySchemaSha256: schemaDigest,
    requiredSignatures: 1,
    createdAt: "2026-02-21T00:00:00.000Z"
  }) as PolicyBundleV2;

  const signAdapter: SigstoreAdapter = {
    sign: async () => ({ fake: "bundle" }),
    verify: async () => {}
  };

  const signed = await signPolicyBundleKeyless(unsignedBundle, "release-keyless", {}, signAdapter);
  const trustStore = parsePolicyTrustStore({
    schemaVersion: 1,
    signers: [
      {
        id: "release-keyless",
        type: "sigstore-keyless",
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityURI:
          "https://github.com/VontaJamal/seven-shadow-system/.github/workflows/release.yml@refs/tags/v0.2.0"
      }
    ]
  });

  const verifyAdapter: SigstoreAdapter = {
    sign: async () => ({ fake: "bundle" }),
    verify: async (_bundle, _payload, options) => {
      assert.equal(options.certificateIssuer, "https://token.actions.githubusercontent.com");
      assert.equal(
        options.certificateIdentityURI,
        "https://github.com/VontaJamal/seven-shadow-system/.github/workflows/release.yml@refs/tags/v0.2.0"
      );
    }
  };

  const result = await verifyPolicyBundleWithTrustStore(signed, trustStore, schemaDigest, verifyAdapter);
  assert.deepEqual(result.validSignatures, ["release-keyless"]);
});

test("malformed keyless signatures fail closed during bundle parsing", () => {
  assert.throws(
    () =>
      parsePolicyBundle({
        schemaVersion: 2,
        createdAt: "2026-02-21T00:00:00.000Z",
        policySchemaPath: "schemas/policy-v2.schema.json",
        policySchemaSha256: "b".repeat(64),
        policySha256: "a".repeat(64),
        requiredSignatures: 1,
        policy: {
          version: 2
        },
        signatures: [
          {
            signatureType: "sigstore-keyless",
            signerId: "release-keyless",
            algorithm: "sigstore-keyless",
            bundle: "not-an-object"
          }
        ]
      }),
    /E_POLICY_BUNDLE_INVALID/
  );
});

test("mixed RSA + keyless bundle quorum verifies through trust store", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const schemaDigest = sha256Hex('{"$id":"policy-v2.schema"}');

  const unsignedBundle = buildPolicyBundleTemplate({
    schemaVersion: 2,
    policy: {
      version: 2,
      enforcement: "block"
    },
    policySchemaPath: "schemas/policy-v2.schema.json",
    policySchemaSha256: schemaDigest,
    requiredSignatures: 2,
    createdAt: "2026-02-21T00:00:00.000Z"
  });

  const rsaSigned = signPolicyBundle(unsignedBundle, "maintainer", privateKey.export({ type: "pkcs1", format: "pem" }).toString());

  const keylessSigned = await signPolicyBundleKeyless(
    rsaSigned as PolicyBundleV2,
    "release-keyless",
    {},
    {
      sign: async () => ({ fake: "bundle" }),
      verify: async () => {}
    }
  );

  const trustStore = parsePolicyTrustStore({
    schemaVersion: 1,
    signers: [
      {
        id: "maintainer-rsa",
        type: "rsa-key",
        keyId: "maintainer",
        publicKeyPem: publicKey.export({ type: "pkcs1", format: "pem" }).toString()
      },
      {
        id: "release-keyless",
        type: "sigstore-keyless",
        certificateIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityURI:
          "https://github.com/VontaJamal/seven-shadow-system/.github/workflows/release.yml@refs/tags/v0.2.0"
      }
    ]
  });

  const result = await verifyPolicyBundleWithTrustStore(keylessSigned, trustStore, schemaDigest, {
    sign: async () => ({ fake: "bundle" }),
    verify: async () => {}
  });

  assert.deepEqual(result.validSignatures.sort(), ["maintainer-rsa", "release-keyless"]);
});

test("trust store rejects malformed definitions", () => {
  assert.throws(
    () =>
      parsePolicyTrustStore({
        schemaVersion: 1,
        signers: [
          {
            id: "release-keyless",
            type: "sigstore-keyless",
            certificateIssuer: 123,
            certificateIdentityURI: "https://example.com/workflow"
          }
        ]
      }),
    /E_POLICY_TRUST_STORE_INVALID/
  );
});

test("trust store lifecycle rejects signatures outside validity window", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const schemaDigest = sha256Hex('{"$id":"policy-v2.schema"}');

  const unsignedBundle = buildPolicyBundleTemplate({
    schemaVersion: 2,
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

  const trustStore = parsePolicyTrustStore({
    schemaVersion: 2,
    signers: [
      {
        id: "maintainer-rsa",
        type: "rsa-key",
        keyId: "maintainer",
        publicKeyPem: publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
        state: "active",
        validFrom: "2026-03-01T00:00:00.000Z"
      }
    ]
  });

  await assert.rejects(
    () => verifyPolicyBundleWithTrustStore(signedBundle, trustStore, schemaDigest),
    /E_POLICY_TRUST_SIGNER_OUTSIDE_VALIDITY/
  );
});

test("revoked signer signatures fail closed retroactively", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const schemaDigest = sha256Hex('{"$id":"policy-v2.schema"}');

  const unsignedBundle = buildPolicyBundleTemplate({
    schemaVersion: 2,
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

  const trustStore = parsePolicyTrustStore({
    schemaVersion: 2,
    signers: [
      {
        id: "maintainer-rsa",
        type: "rsa-key",
        keyId: "maintainer",
        publicKeyPem: publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
        state: "revoked"
      }
    ]
  });

  await assert.rejects(() => verifyPolicyBundleWithTrustStore(signedBundle, trustStore, schemaDigest), /E_POLICY_TRUST_SIGNER_REVOKED/);
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
