import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildPolicyBundleTemplate,
  parsePolicyTrustStore,
  sha256Hex,
  signPolicyBundle,
  verifyPolicyBundleWithTrustStore
} from "../src/policyGovernance";

const execFileAsync = promisify(execFile);

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function basePolicy(): Record<string, unknown> {
  return {
    version: 2,
    enforcement: "block",
    rules: [
      {
        name: "placeholder",
        pattern: "x",
        action: "score",
        weight: 0
      }
    ]
  };
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-trust-tool-"));
}

async function runTrustTool(args: string[]): Promise<CommandResult> {
  const command = [path.join(process.cwd(), "dist", "scripts", "policy-trust-store.js"), ...args];

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, command, {
      cwd: process.cwd()
    });

    return {
      code: 0,
      stdout,
      stderr
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? ""
    };
  }
}

test("policy trust-store lint emits deterministic sorted signer summary", async () => {
  const tempDir = await makeTempDir();

  try {
    const trustStorePath = path.join(tempDir, "trust-store-v2.json");
    await fs.writeFile(
      trustStorePath,
      `${JSON.stringify(
        {
          schemaVersion: 2,
          signers: [
            {
              id: "zeta",
              type: "rsa-key",
              keyId: "zeta-key",
              publicKeyPem: "zeta-public",
              state: "active"
            },
            {
              id: "alpha",
              type: "sigstore-keyless",
              certificateIssuer: "https://token.actions.githubusercontent.com",
              certificateIdentityURI: "https://github.com/acme/repo/.github/workflows/release.yml@refs/tags/v0.1.0",
              state: "active"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const result = await runTrustTool(["lint", "--trust-store", trustStorePath, "--format", "json"]);
    assert.equal(result.code, 0, result.stderr);

    const summary = JSON.parse(result.stdout) as { signers: Array<{ id: string }>; schemaVersion: number };
    assert.equal(summary.schemaVersion, 2);
    assert.deepEqual(
      summary.signers.map((signer) => signer.id),
      ["alpha", "zeta"]
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("policy trust-store rotate-rsa and revoke operations preserve lifecycle semantics", async () => {
  const tempDir = await makeTempDir();

  try {
    const trustStorePath = path.join(tempDir, "trust-store.json");
    const rotatedPath = path.join(tempDir, "trust-store-rotated.json");
    const revokedPath = path.join(tempDir, "trust-store-revoked.json");
    const newPublicKeyPath = path.join(tempDir, "new-public.pem");

    const oldKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const newKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const schemaDigest = sha256Hex('{"$id":"policy-v2.schema"}');

    await fs.writeFile(newPublicKeyPath, newKeys.publicKey.export({ type: "pkcs1", format: "pem" }).toString(), "utf8");
    await fs.writeFile(
      trustStorePath,
      `${JSON.stringify(
        {
          schemaVersion: 2,
          signers: [
            {
              id: "maintainer-old",
              type: "rsa-key",
              keyId: "maintainer-old",
              publicKeyPem: oldKeys.publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
              state: "active"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const rotateResult = await runTrustTool([
      "rotate-rsa",
      "--trust-store",
      trustStorePath,
      "--old-signer",
      "maintainer-old",
      "--new-signer",
      "maintainer-new",
      "--new-key-id",
      "maintainer-new",
      "--new-public-key",
      newPublicKeyPath,
      "--effective-at",
      "2026-03-01T00:00:00.000Z",
      "--output",
      rotatedPath
    ]);
    assert.equal(rotateResult.code, 0, rotateResult.stderr);

    const rotated = parsePolicyTrustStore(JSON.parse(await fs.readFile(rotatedPath, "utf8")) as unknown);
    assert.equal(rotated.schemaVersion, 2);

    const oldSigner = rotated.signers.find((item) => item.id === "maintainer-old");
    const newSigner = rotated.signers.find((item) => item.id === "maintainer-new");

    assert.ok(oldSigner && oldSigner.type === "rsa-key");
    assert.ok(newSigner && newSigner.type === "rsa-key");
    assert.equal(oldSigner.state, "retired");
    assert.equal(oldSigner.validUntil, "2026-03-01T00:00:00.000Z");
    assert.equal(oldSigner.replacedBy, "maintainer-new");
    assert.equal(newSigner.state, "active");
    assert.equal(newSigner.validFrom, "2026-03-01T00:00:00.000Z");
    assert.equal(newSigner.replaces, "maintainer-old");

    const unsignedBundle = buildPolicyBundleTemplate({
      schemaVersion: 2,
      policy: basePolicy(),
      policySchemaPath: "schemas/policy-v2.schema.json",
      policySchemaSha256: schemaDigest,
      requiredSignatures: 1,
      createdAt: "2026-02-21T00:00:00.000Z"
    });
    const signedBundle = signPolicyBundle(
      unsignedBundle,
      "maintainer-old",
      oldKeys.privateKey.export({ type: "pkcs1", format: "pem" }).toString()
    );

    await verifyPolicyBundleWithTrustStore(signedBundle, rotated, schemaDigest);

    const revokeResult = await runTrustTool([
      "revoke",
      "--trust-store",
      rotatedPath,
      "--signer",
      "maintainer-old",
      "--output",
      revokedPath
    ]);
    assert.equal(revokeResult.code, 0, revokeResult.stderr);

    const revoked = parsePolicyTrustStore(JSON.parse(await fs.readFile(revokedPath, "utf8")) as unknown);
    await assert.rejects(
      () => verifyPolicyBundleWithTrustStore(signedBundle, revoked, schemaDigest),
      /E_POLICY_TRUST_SIGNER_REVOKED/
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("policy trust-store tool emits deterministic error codes", async () => {
  const tempDir = await makeTempDir();

  try {
    const v1StorePath = path.join(tempDir, "trust-store-v1.json");
    const v2StorePath = path.join(tempDir, "trust-store-v2.json");
    const outputPath = path.join(tempDir, "out.json");
    const publicKeyPath = path.join(tempDir, "public.pem");

    const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

    await fs.writeFile(publicKeyPath, keys.publicKey.export({ type: "pkcs1", format: "pem" }).toString(), "utf8");
    await fs.writeFile(
      v1StorePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          signers: [
            {
              id: "maintainer",
              type: "rsa-key",
              keyId: "maintainer",
              publicKeyPem: keys.publicKey.export({ type: "pkcs1", format: "pem" }).toString()
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await fs.writeFile(
      v2StorePath,
      `${JSON.stringify(
        {
          schemaVersion: 2,
          signers: [
            {
              id: "maintainer",
              type: "rsa-key",
              keyId: "maintainer",
              publicKeyPem: keys.publicKey.export({ type: "pkcs1", format: "pem" }).toString(),
              state: "active"
            }
          ]
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const missingArgError = await runTrustTool(["lint"]);
    assert.equal(missingArgError.code, 1);
    assert.match(missingArgError.stderr, /E_POLICY_TRUST_TOOL_ARG_REQUIRED/);

    const versionError = await runTrustTool([
      "rotate-rsa",
      "--trust-store",
      v1StorePath,
      "--old-signer",
      "maintainer",
      "--new-signer",
      "new",
      "--new-key-id",
      "new",
      "--new-public-key",
      publicKeyPath,
      "--effective-at",
      "2026-03-01T00:00:00.000Z",
      "--output",
      outputPath
    ]);
    assert.equal(versionError.code, 1);
    assert.match(versionError.stderr, /E_POLICY_TRUST_TOOL_VERSION_REQUIRED/);

    const missingSignerError = await runTrustTool([
      "rotate-rsa",
      "--trust-store",
      v2StorePath,
      "--old-signer",
      "missing",
      "--new-signer",
      "new",
      "--new-key-id",
      "new",
      "--new-public-key",
      publicKeyPath,
      "--effective-at",
      "2026-03-01T00:00:00.000Z",
      "--output",
      outputPath
    ]);
    assert.equal(missingSignerError.code, 1);
    assert.match(missingSignerError.stderr, /E_POLICY_TRUST_TOOL_SIGNER_NOT_FOUND/);

    const duplicateSignerError = await runTrustTool([
      "rotate-rsa",
      "--trust-store",
      v2StorePath,
      "--old-signer",
      "maintainer",
      "--new-signer",
      "maintainer",
      "--new-key-id",
      "new",
      "--new-public-key",
      publicKeyPath,
      "--effective-at",
      "2026-03-01T00:00:00.000Z",
      "--output",
      outputPath
    ]);
    assert.equal(duplicateSignerError.code, 1);
    assert.match(duplicateSignerError.stderr, /E_POLICY_TRUST_TOOL_SIGNER_EXISTS/);

    const duplicateKeyIdError = await runTrustTool([
      "rotate-rsa",
      "--trust-store",
      v2StorePath,
      "--old-signer",
      "maintainer",
      "--new-signer",
      "maintainer-new",
      "--new-key-id",
      "maintainer",
      "--new-public-key",
      publicKeyPath,
      "--effective-at",
      "2026-03-01T00:00:00.000Z",
      "--output",
      outputPath
    ]);
    assert.equal(duplicateKeyIdError.code, 1);
    assert.match(duplicateKeyIdError.stderr, /E_POLICY_TRUST_TOOL_KEYID_EXISTS/);

    const invalidDateError = await runTrustTool([
      "rotate-rsa",
      "--trust-store",
      v2StorePath,
      "--old-signer",
      "maintainer",
      "--new-signer",
      "maintainer-new",
      "--new-key-id",
      "maintainer-new",
      "--new-public-key",
      publicKeyPath,
      "--effective-at",
      "not-a-date",
      "--output",
      outputPath
    ]);
    assert.equal(invalidDateError.code, 1);
    assert.match(invalidDateError.stderr, /E_POLICY_TRUST_TOOL_EFFECTIVE_AT_INVALID/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
