import fs from "node:fs/promises";
import path from "node:path";

import {
  parsePolicyTrustStore,
  type PolicyTrustSignerV1,
  type PolicyTrustSignerV2,
  type PolicyTrustStore,
  type PolicyTrustStoreV2
} from "../src/policyGovernance";

type Command = "lint" | "rotate-rsa" | "revoke";
type OutputFormat = "text" | "json";

interface ParsedCli {
  command: Command;
  options: Map<string, string[]>;
}

interface TrustStoreSummarySigner {
  id: string;
  type: "rsa-key" | "sigstore-keyless";
  keyId?: string;
  certificateIssuer?: string;
  certificateIdentityURI?: string;
  state?: "active" | "retired" | "revoked";
  validFrom?: string;
  validUntil?: string;
  replaces?: string;
  replacedBy?: string;
}

interface TrustStoreSummary {
  schemaVersion: 1 | 2;
  signerCount: number;
  signers: TrustStoreSummarySigner[];
}

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0];
  if (command !== "lint" && command !== "rotate-rsa" && command !== "revoke") {
    throw new Error("Usage: policy-trust-store <lint|rotate-rsa|revoke> [options]");
  }

  const options = new Map<string, string[]>();
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`E_POLICY_TRUST_TOOL_ARG_REQUIRED: unexpected token '${token}'`);
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`E_POLICY_TRUST_TOOL_ARG_REQUIRED: ${token}`);
    }

    const existing = options.get(token) ?? [];
    existing.push(value);
    options.set(token, existing);
    i += 1;
  }

  return {
    command,
    options
  };
}

function requireOption(options: Map<string, string[]>, key: string): string {
  const value = options.get(key)?.[0];
  if (!value) {
    throw new Error(`E_POLICY_TRUST_TOOL_ARG_REQUIRED: ${key}`);
  }

  return value;
}

function parseFormat(value: string): OutputFormat {
  if (value === "text" || value === "json") {
    return value;
  }

  throw new Error("E_POLICY_TRUST_TOOL_ARG_REQUIRED: --format must be text|json");
}

function parseIsoDateStrict(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`E_POLICY_TRUST_TOOL_EFFECTIVE_AT_INVALID: '${value}' is not a valid ISO8601 timestamp`);
  }

  const normalized = new Date(parsed).toISOString();
  if (normalized !== value) {
    throw new Error(
      `E_POLICY_TRUST_TOOL_EFFECTIVE_AT_INVALID: '${value}' must be canonical ISO8601 (example: ${normalized})`
    );
  }

  return normalized;
}

async function loadJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sortSigners<T extends { id: string }>(signers: T[]): T[] {
  return [...signers].sort((a, b) => a.id.localeCompare(b.id));
}

function summarizeSigner(signer: PolicyTrustSignerV1 | PolicyTrustSignerV2): TrustStoreSummarySigner {
  if (signer.type === "rsa-key") {
    return {
      id: signer.id,
      type: signer.type,
      keyId: signer.keyId,
      ...("state" in signer ? { state: signer.state } : {}),
      ...("validFrom" in signer && signer.validFrom ? { validFrom: signer.validFrom } : {}),
      ...("validUntil" in signer && signer.validUntil ? { validUntil: signer.validUntil } : {}),
      ...("replaces" in signer && signer.replaces ? { replaces: signer.replaces } : {}),
      ...("replacedBy" in signer && signer.replacedBy ? { replacedBy: signer.replacedBy } : {})
    };
  }

  return {
    id: signer.id,
    type: signer.type,
    certificateIssuer: signer.certificateIssuer,
    certificateIdentityURI: signer.certificateIdentityURI,
    ...("state" in signer ? { state: signer.state } : {}),
    ...("validFrom" in signer && signer.validFrom ? { validFrom: signer.validFrom } : {}),
    ...("validUntil" in signer && signer.validUntil ? { validUntil: signer.validUntil } : {}),
    ...("replaces" in signer && signer.replaces ? { replaces: signer.replaces } : {}),
    ...("replacedBy" in signer && signer.replacedBy ? { replacedBy: signer.replacedBy } : {})
  };
}

function buildSummary(trustStore: PolicyTrustStore): TrustStoreSummary {
  const signers = sortSigners(trustStore.signers).map((signer) => summarizeSigner(signer));
  return {
    schemaVersion: trustStore.schemaVersion,
    signerCount: signers.length,
    signers
  };
}

function parseTrustStoreV2(raw: unknown): PolicyTrustStoreV2 {
  const trustStore = parsePolicyTrustStore(raw);
  if (trustStore.schemaVersion !== 2) {
    throw new Error("E_POLICY_TRUST_TOOL_VERSION_REQUIRED: operation requires schemaVersion=2 trust store");
  }

  return trustStore;
}

function ensureSignerExists(signers: PolicyTrustSignerV2[], signerId: string): PolicyTrustSignerV2 {
  const signer = signers.find((item) => item.id === signerId);
  if (!signer) {
    throw new Error(`E_POLICY_TRUST_TOOL_SIGNER_NOT_FOUND: signer '${signerId}'`);
  }

  return signer;
}

function ensureSignerMissing(signers: PolicyTrustSignerV2[], signerId: string): void {
  if (signers.some((item) => item.id === signerId)) {
    throw new Error(`E_POLICY_TRUST_TOOL_SIGNER_EXISTS: signer '${signerId}'`);
  }
}

function ensureRsaKeyIdMissing(signers: PolicyTrustSignerV2[], keyId: string): void {
  const exists = signers.some((item) => item.type === "rsa-key" && item.keyId === keyId);
  if (exists) {
    throw new Error(`E_POLICY_TRUST_TOOL_KEYID_EXISTS: keyId '${keyId}'`);
  }
}

async function commandLint(options: Map<string, string[]>): Promise<void> {
  const trustStorePath = requireOption(options, "--trust-store");
  const format = parseFormat(options.get("--format")?.[0] ?? "text");

  const trustStore = parsePolicyTrustStore(await loadJson(trustStorePath));
  const summary = buildSummary(trustStore);

  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Trust store valid: schemaVersion=${summary.schemaVersion} signerCount=${summary.signerCount}`);
  for (const signer of summary.signers) {
    const fields: string[] = [`id=${signer.id}`, `type=${signer.type}`];

    if (signer.keyId) {
      fields.push(`keyId=${signer.keyId}`);
    }

    if (signer.certificateIssuer) {
      fields.push(`certificateIssuer=${signer.certificateIssuer}`);
    }

    if (signer.certificateIdentityURI) {
      fields.push(`certificateIdentityURI=${signer.certificateIdentityURI}`);
    }

    if (signer.state) {
      fields.push(`state=${signer.state}`);
    }

    if (signer.validFrom) {
      fields.push(`validFrom=${signer.validFrom}`);
    }

    if (signer.validUntil) {
      fields.push(`validUntil=${signer.validUntil}`);
    }

    if (signer.replaces) {
      fields.push(`replaces=${signer.replaces}`);
    }

    if (signer.replacedBy) {
      fields.push(`replacedBy=${signer.replacedBy}`);
    }

    console.log(`- ${fields.join(" ")}`);
  }
}

async function commandRotateRsa(options: Map<string, string[]>): Promise<void> {
  const trustStorePath = requireOption(options, "--trust-store");
  const outputPath = requireOption(options, "--output");
  const oldSignerId = requireOption(options, "--old-signer");
  const newSignerId = requireOption(options, "--new-signer");
  const newKeyId = requireOption(options, "--new-key-id");
  const newPublicKeyPath = requireOption(options, "--new-public-key");
  const effectiveAt = parseIsoDateStrict(requireOption(options, "--effective-at"));

  const trustStore = parseTrustStoreV2(await loadJson(trustStorePath));
  const oldSigner = ensureSignerExists(trustStore.signers, oldSignerId);

  if (oldSigner.type !== "rsa-key") {
    throw new Error(`E_POLICY_TRUST_TOOL_SIGNER_NOT_FOUND: signer '${oldSignerId}' is not an rsa-key signer`);
  }

  ensureSignerMissing(trustStore.signers, newSignerId);
  ensureRsaKeyIdMissing(trustStore.signers, newKeyId);

  const newPublicKeyPem = await fs.readFile(newPublicKeyPath, "utf8");

  const updatedSigners: PolicyTrustSignerV2[] = trustStore.signers.map((signer) => {
    if (signer.id !== oldSignerId) {
      return signer;
    }

    return {
      ...signer,
      state: "retired",
      validUntil: effectiveAt,
      replacedBy: newSignerId
    };
  });

  updatedSigners.push({
    id: newSignerId,
    type: "rsa-key",
    keyId: newKeyId,
    publicKeyPem: newPublicKeyPem,
    state: "active",
    validFrom: effectiveAt,
    replaces: oldSignerId
  });

  const output = parsePolicyTrustStore({
    schemaVersion: 2,
    signers: sortSigners(updatedSigners)
  });

  await writeJson(outputPath, output);
  console.log(`Rotated RSA signer '${oldSignerId}' -> '${newSignerId}' at ${effectiveAt}`);
}

async function commandRevoke(options: Map<string, string[]>): Promise<void> {
  const trustStorePath = requireOption(options, "--trust-store");
  const outputPath = requireOption(options, "--output");
  const signerId = requireOption(options, "--signer");

  const trustStore = parseTrustStoreV2(await loadJson(trustStorePath));
  ensureSignerExists(trustStore.signers, signerId);

  const updatedSigners: PolicyTrustSignerV2[] = trustStore.signers.map((signer) => {
    if (signer.id !== signerId) {
      return signer;
    }

    return {
      ...signer,
      state: "revoked"
    };
  });

  const output = parsePolicyTrustStore({
    schemaVersion: 2,
    signers: sortSigners(updatedSigners)
  });

  await writeJson(outputPath, output);
  console.log(`Revoked signer '${signerId}'`);
}

async function run(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.command === "lint") {
    await commandLint(parsed.options);
    return;
  }

  if (parsed.command === "rotate-rsa") {
    await commandRotateRsa(parsed.options);
    return;
  }

  await commandRevoke(parsed.options);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Policy trust-store command failed: ${message}`);
  process.exit(1);
});
