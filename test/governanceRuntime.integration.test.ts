import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildPolicyBundleTemplate, sha256Hex, signPolicyBundle } from "../src/policyGovernance";
import { runSevenShadowSystem } from "../src/sevenShadowSystem";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-governance-"));
}

function basePolicy(): Record<string, unknown> {
  return {
    version: 2,
    enforcement: "block",
    blockBotAuthors: true,
    blockedAuthors: [],
    allowedAuthors: [],
    scanPrBody: true,
    scanReviewBody: true,
    scanCommentBody: true,
    maxAiScore: 0.75,
    disclosureTag: "[AI-ASSISTED]",
    disclosureRequiredScore: 0.45,
    runtime: {
      failOnUnsupportedEvent: true,
      failOnMalformedPayload: true,
      maxBodyChars: 12000,
      maxTargets: 25,
      maxEventBytes: 1000000
    },
    report: {
      includeBodies: false,
      redactionMode: "hash"
    },
    approvals: {
      minHumanApprovals: 0,
      fetchTimeoutMs: 10000,
      maxPages: 10,
      retry: {
        enabled: true,
        maxAttempts: 3,
        baseDelayMs: 250,
        maxDelayMs: 2500,
        jitterRatio: 0,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      }
    },
    rules: [
      {
        name: "explicit-disclaimer",
        pattern: "\\bas an ai language model\\b",
        action: "block"
      },
      {
        name: "template",
        pattern: "\\bgreat work\\b",
        action: "score",
        weight: 0.2
      }
    ]
  };
}

function baseEvent(): Record<string, unknown> {
  return {
    repository: { full_name: "acme/repo" },
    pull_request: {
      number: 9,
      body: "PR body",
      user: { login: "owner", type: "User" }
    },
    review: {
      id: 22,
      body: "Looks good to me",
      user: { login: "reviewer", type: "User" }
    }
  };
}

test("runSevenShadowSystem loads policy from verified signed bundle", async () => {
  const tempDir = await makeTempDir();

  try {
    const bundlePath = path.join(tempDir, "policy.bundle.json");
    const privateKeyPath = path.join(tempDir, "policy-private.pem");
    const publicKeyPath = path.join(tempDir, "policy-public.pem");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");
    const schemaPath = path.join(process.cwd(), "schemas", "policy-v2.schema.json");

    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    await fs.writeFile(privateKeyPath, privateKey.export({ type: "pkcs1", format: "pem" }).toString(), "utf8");
    await fs.writeFile(publicKeyPath, publicKey.export({ type: "pkcs1", format: "pem" }).toString(), "utf8");

    const schemaRaw = await fs.readFile(schemaPath, "utf8");
    const unsignedBundle = buildPolicyBundleTemplate({
      policy: basePolicy(),
      policySchemaPath: schemaPath,
      policySchemaSha256: sha256Hex(schemaRaw),
      requiredSignatures: 1,
      createdAt: "2026-02-21T00:00:00.000Z"
    });
    const signedBundle = signPolicyBundle(
      unsignedBundle,
      "maintainer",
      privateKey.export({ type: "pkcs1", format: "pem" }).toString()
    );

    await fs.writeFile(bundlePath, `${JSON.stringify(signedBundle, null, 2)}\n`, "utf8");
    await fs.writeFile(eventPath, `${JSON.stringify(baseEvent(), null, 2)}\n`, "utf8");

    const exitCode = await runSevenShadowSystem(
      [
        "--policy-bundle",
        bundlePath,
        "--policy-schema",
        schemaPath,
        "--policy-public-key",
        `maintainer=${publicKeyPath}`,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { decision: string; policyPath: string };
    assert.equal(exitCode, 0);
    assert.equal(report.decision, "pass");
    assert.equal(report.policyPath, bundlePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem loads policy from trust-store verified bundle", async () => {
  const tempDir = await makeTempDir();

  try {
    const bundlePath = path.join(tempDir, "policy.bundle.json");
    const trustStorePath = path.join(tempDir, "trust-store.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");
    const schemaPath = path.join(process.cwd(), "schemas", "policy-v2.schema.json");

    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

    const schemaRaw = await fs.readFile(schemaPath, "utf8");
    const unsignedBundle = buildPolicyBundleTemplate({
      schemaVersion: 2,
      policy: basePolicy(),
      policySchemaPath: schemaPath,
      policySchemaSha256: sha256Hex(schemaRaw),
      requiredSignatures: 1,
      createdAt: "2026-02-21T00:00:00.000Z"
    });
    const signedBundle = signPolicyBundle(
      unsignedBundle,
      "maintainer",
      privateKey.export({ type: "pkcs1", format: "pem" }).toString()
    );

    const trustStore = {
      schemaVersion: 2,
      signers: [
        {
          id: "maintainer-rsa",
          type: "rsa-key",
          keyId: "maintainer",
          publicKeyPem: publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
          state: "active"
        }
      ]
    };

    await fs.writeFile(bundlePath, `${JSON.stringify(signedBundle, null, 2)}\n`, "utf8");
    await fs.writeFile(trustStorePath, `${JSON.stringify(trustStore, null, 2)}\n`, "utf8");
    await fs.writeFile(eventPath, `${JSON.stringify(baseEvent(), null, 2)}\n`, "utf8");

    const exitCode = await runSevenShadowSystem(
      [
        "--policy-bundle",
        bundlePath,
        "--policy-schema",
        schemaPath,
        "--policy-trust-store",
        trustStorePath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { decision: string; policyPath: string };
    assert.equal(exitCode, 0);
    assert.equal(report.decision, "pass");
    assert.equal(report.policyPath, bundlePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem rejects conflicting bundle trust inputs", async () => {
  await assert.rejects(
    () =>
      runSevenShadowSystem(
        [
          "--policy-bundle",
          "bundle.json",
          "--policy-schema",
          "schema.json",
          "--policy-trust-store",
          "trust-store.json",
          "--policy-public-key",
          "maintainer=keys/maintainer.pub"
        ],
        process.env
      ),
    /E_ARG_CONFLICT: --policy-trust-store cannot be used with --policy-public-key/
  );
});

test("runSevenShadowSystem blocks bundles that include revoked signer signatures", async () => {
  const tempDir = await makeTempDir();

  try {
    const bundlePath = path.join(tempDir, "policy.bundle.json");
    const trustStorePath = path.join(tempDir, "trust-store.json");
    const eventPath = path.join(tempDir, "event.json");
    const schemaPath = path.join(process.cwd(), "schemas", "policy-v2.schema.json");

    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

    const schemaRaw = await fs.readFile(schemaPath, "utf8");
    const unsignedBundle = buildPolicyBundleTemplate({
      schemaVersion: 2,
      policy: basePolicy(),
      policySchemaPath: schemaPath,
      policySchemaSha256: sha256Hex(schemaRaw),
      requiredSignatures: 1,
      createdAt: "2026-02-21T00:00:00.000Z"
    });
    const signedBundle = signPolicyBundle(
      unsignedBundle,
      "maintainer",
      privateKey.export({ type: "pkcs1", format: "pem" }).toString()
    );

    const trustStore = {
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
    };

    await fs.writeFile(bundlePath, `${JSON.stringify(signedBundle, null, 2)}\n`, "utf8");
    await fs.writeFile(trustStorePath, `${JSON.stringify(trustStore, null, 2)}\n`, "utf8");
    await fs.writeFile(eventPath, `${JSON.stringify(baseEvent(), null, 2)}\n`, "utf8");

    await assert.rejects(
      () =>
        runSevenShadowSystem(
          [
            "--policy-bundle",
            bundlePath,
            "--policy-schema",
            schemaPath,
            "--policy-trust-store",
            trustStorePath,
            "--event",
            eventPath,
            "--event-name",
            "pull_request_review"
          ],
          process.env
        ),
      /E_POLICY_TRUST_SIGNER_REVOKED/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem merges org policy with local overrides and blocks forbidden overrides", async () => {
  const tempDir = await makeTempDir();

  try {
    const orgPolicyPath = path.join(tempDir, "org-policy.json");
    const localPolicyPath = path.join(tempDir, "local-policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");
    const constraintsPath = path.join(process.cwd(), "config", "policy-override-constraints.json");

    await fs.writeFile(orgPolicyPath, `${JSON.stringify(basePolicy(), null, 2)}\n`, "utf8");
    await fs.writeFile(
      localPolicyPath,
      `${JSON.stringify(
        {
          runtime: {
            maxTargets: 30
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await fs.writeFile(eventPath, `${JSON.stringify(baseEvent(), null, 2)}\n`, "utf8");

    const passCode = await runSevenShadowSystem(
      [
        "--org-policy",
        orgPolicyPath,
        "--local-policy",
        localPolicyPath,
        "--override-constraints",
        constraintsPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      process.env
    );

    assert.equal(passCode, 0);

    await fs.writeFile(
      localPolicyPath,
      `${JSON.stringify(
        {
          runtime: {
            failOnMalformedPayload: false
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await assert.rejects(
      () =>
        runSevenShadowSystem(
          [
            "--org-policy",
            orgPolicyPath,
            "--local-policy",
            localPolicyPath,
            "--override-constraints",
            constraintsPath,
            "--event",
            eventPath,
            "--event-name",
            "pull_request_review"
          ],
          process.env
        ),
      /E_POLICY_OVERRIDE_FORBIDDEN/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem replay mode detects baseline drift with deterministic mismatch finding", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const baselinePath = path.join(tempDir, "baseline.json");
    const reportPath = path.join(tempDir, "report.json");

    await fs.writeFile(policyPath, `${JSON.stringify(basePolicy(), null, 2)}\n`, "utf8");
    await fs.writeFile(eventPath, `${JSON.stringify(baseEvent(), null, 2)}\n`, "utf8");

    const baselineCode = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        baselinePath
      ],
      process.env
    );
    assert.equal(baselineCode, 0);

    const matchCode = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath,
        "--replay-report",
        baselinePath
      ],
      process.env
    );

    let report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };
    assert.equal(matchCode, 0);
    assert.equal(report.findings.some((item) => item.code === "GUARD_REPLAY_MISMATCH"), false);

    const tampered = JSON.parse(await fs.readFile(baselinePath, "utf8")) as Record<string, unknown>;
    tampered.decision = "block";
    await fs.writeFile(baselinePath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const mismatchCode = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath,
        "--replay-report",
        baselinePath
      ],
      process.env
    );

    report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };
    assert.equal(mismatchCode, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_REPLAY_MISMATCH"), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
