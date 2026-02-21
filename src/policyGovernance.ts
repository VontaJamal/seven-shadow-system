import crypto from "node:crypto";

import { sign as sigstoreSign, verify as sigstoreVerify } from "sigstore";

export interface PolicyBundleSignature {
  keyId: string;
  algorithm: "rsa-sha256";
  signature: string;
}

export interface PolicyBundleSignatureRsaV2 {
  signatureType: "rsa";
  keyId: string;
  algorithm: "rsa-sha256";
  signature: string;
}

export interface PolicyBundleSignatureKeylessV2 {
  signatureType: "sigstore-keyless";
  signerId: string;
  algorithm: "sigstore-keyless";
  bundle: Record<string, unknown>;
}

export type PolicyBundleSignatureV2 = PolicyBundleSignatureRsaV2 | PolicyBundleSignatureKeylessV2;

export interface PolicyBundleV1 {
  schemaVersion: 1;
  createdAt: string;
  policySchemaPath: string;
  policySchemaSha256: string;
  policySha256: string;
  requiredSignatures: number;
  policy: Record<string, unknown>;
  signatures: PolicyBundleSignature[];
}

export interface PolicyBundleV2 {
  schemaVersion: 2;
  createdAt: string;
  policySchemaPath: string;
  policySchemaSha256: string;
  policySha256: string;
  requiredSignatures: number;
  policy: Record<string, unknown>;
  signatures: PolicyBundleSignatureV2[];
}

export type PolicyBundle = PolicyBundleV1 | PolicyBundleV2;

export interface PolicyTrustSignerRsaV1 {
  id: string;
  type: "rsa-key";
  keyId: string;
  publicKeyPem: string;
}

export interface PolicyTrustSignerKeylessV1 {
  id: string;
  type: "sigstore-keyless";
  certificateIssuer: string;
  certificateIdentityURI: string;
}

export type PolicyTrustSignerV1 = PolicyTrustSignerRsaV1 | PolicyTrustSignerKeylessV1;

export interface PolicyTrustStoreV1 {
  schemaVersion: 1;
  signers: PolicyTrustSignerV1[];
}

export interface PolicyTrustSignerLifecycle {
  state: "active" | "retired" | "revoked";
  validFrom?: string;
  validUntil?: string;
  replaces?: string;
  replacedBy?: string;
}

export interface PolicyTrustSignerRsaV2 extends PolicyTrustSignerRsaV1, PolicyTrustSignerLifecycle {}

export interface PolicyTrustSignerKeylessV2 extends PolicyTrustSignerKeylessV1, PolicyTrustSignerLifecycle {}

export type PolicyTrustSignerV2 = PolicyTrustSignerRsaV2 | PolicyTrustSignerKeylessV2;

export interface PolicyTrustStoreV2 {
  schemaVersion: 2;
  signers: PolicyTrustSignerV2[];
}

export type PolicyTrustStore = PolicyTrustStoreV1 | PolicyTrustStoreV2;

export interface SigstoreAdapter {
  sign(payload: Buffer, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  verify(bundle: Record<string, unknown>, payload: Buffer, options: Record<string, unknown>): Promise<void>;
}

const DEFAULT_SIGSTORE_ADAPTER: SigstoreAdapter = {
  sign: async (payload, options = {}) => {
    const generated = (await sigstoreSign(payload, options as never)) as unknown;
    if (!isRecord(generated)) {
      throw new Error("E_SIGSTORE_INVALID_BUNDLE: keyless signing result was not an object");
    }
    return generated;
  },
  verify: async (bundle, payload, options) => {
    await sigstoreVerify(bundle as never, payload, options as never);
  }
};

export interface PolicyOverrideConstraints {
  schemaVersion: 1;
  allowedOverridePaths: string[];
  forbiddenOverridePaths: string[];
}

export const DEFAULT_POLICY_OVERRIDE_CONSTRAINTS: PolicyOverrideConstraints = {
  schemaVersion: 1,
  allowedOverridePaths: [
    "blockedAuthors",
    "allowedAuthors",
    "scanPrBody",
    "scanReviewBody",
    "scanCommentBody",
    "runtime.maxBodyChars",
    "runtime.maxTargets",
    "runtime.maxEventBytes",
    "report.includeBodies",
    "report.redactionMode",
    "approvals.minHumanApprovals",
    "approvals.fetchTimeoutMs",
    "approvals.maxPages",
    "approvals.retry",
    "rules"
  ],
  forbiddenOverridePaths: [
    "version",
    "enforcement",
    "blockBotAuthors",
    "maxAiScore",
    "disclosureTag",
    "disclosureRequiredScore",
    "runtime.failOnUnsupportedEvent",
    "runtime.failOnMalformedPayload"
  ]
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableCompare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([keyA], [keyB]) => stableCompare(keyA, keyB));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashJson(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

function assertString(
  value: unknown,
  field: string,
  codePrefix: "E_POLICY_BUNDLE_INVALID" | "E_POLICY_TRUST_STORE_INVALID" = "E_POLICY_BUNDLE_INVALID"
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${codePrefix}: '${field}' must be a non-empty string`);
  }

  return value;
}

function assertNumber(
  value: unknown,
  field: string,
  codePrefix: "E_POLICY_BUNDLE_INVALID" | "E_POLICY_TRUST_STORE_INVALID" = "E_POLICY_BUNDLE_INVALID"
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${codePrefix}: '${field}' must be numeric`);
  }

  return value;
}

function assertHex64(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`E_POLICY_BUNDLE_INVALID: '${field}' must be a 64-char lowercase hex digest`);
  }

  return value;
}

function assertIsoDate(value: string, field: string, codePrefix: "E_POLICY_BUNDLE_INVALID" | "E_POLICY_TRUST_STORE_INVALID"): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${codePrefix}: '${field}' must be an ISO-8601 timestamp`);
  }

  return value;
}

function assertNoExtraKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
  field: string,
  codePrefix: "E_POLICY_BUNDLE_INVALID" | "E_POLICY_TRUST_STORE_INVALID"
): void {
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${codePrefix}: '${field}' contains unknown field(s): ${unknown.sort(stableCompare).join(", ")}`);
  }
}

function parsePolicyBundleV1(raw: Record<string, unknown>): PolicyBundleV1 {
  const createdAt = assertString(raw.createdAt, "createdAt");
  const policySchemaPath = assertString(raw.policySchemaPath, "policySchemaPath");
  const policySchemaSha256 = assertHex64(assertString(raw.policySchemaSha256, "policySchemaSha256"), "policySchemaSha256");
  const policySha256 = assertHex64(assertString(raw.policySha256, "policySha256"), "policySha256");
  const requiredSignatures = assertNumber(raw.requiredSignatures, "requiredSignatures");

  if (!Number.isInteger(requiredSignatures) || requiredSignatures < 1) {
    throw new Error("E_POLICY_BUNDLE_INVALID: requiredSignatures must be an integer >= 1");
  }

  if (!isRecord(raw.policy)) {
    throw new Error("E_POLICY_BUNDLE_INVALID: policy must be an object");
  }

  if (!Array.isArray(raw.signatures)) {
    throw new Error("E_POLICY_BUNDLE_INVALID: signatures must be an array");
  }

  const signatures: PolicyBundleSignature[] = raw.signatures.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`E_POLICY_BUNDLE_INVALID: signatures[${index}] must be an object`);
    }

    const keyId = assertString(item.keyId, `signatures[${index}].keyId`);
    const algorithm = assertString(item.algorithm, `signatures[${index}].algorithm`);
    const signature = assertString(item.signature, `signatures[${index}].signature`);

    if (algorithm !== "rsa-sha256") {
      throw new Error(`E_POLICY_BUNDLE_INVALID: unsupported signature algorithm '${algorithm}'`);
    }

    return {
      keyId,
      algorithm: "rsa-sha256",
      signature
    };
  });

  return {
    schemaVersion: 1,
    createdAt,
    policySchemaPath,
    policySchemaSha256,
    policySha256,
    requiredSignatures,
    policy: raw.policy,
    signatures
  };
}

function parsePolicyBundleV2(raw: Record<string, unknown>): PolicyBundleV2 {
  const createdAt = assertString(raw.createdAt, "createdAt");
  const policySchemaPath = assertString(raw.policySchemaPath, "policySchemaPath");
  const policySchemaSha256 = assertHex64(assertString(raw.policySchemaSha256, "policySchemaSha256"), "policySchemaSha256");
  const policySha256 = assertHex64(assertString(raw.policySha256, "policySha256"), "policySha256");
  const requiredSignatures = assertNumber(raw.requiredSignatures, "requiredSignatures");

  if (!Number.isInteger(requiredSignatures) || requiredSignatures < 1) {
    throw new Error("E_POLICY_BUNDLE_INVALID: requiredSignatures must be an integer >= 1");
  }

  if (!isRecord(raw.policy)) {
    throw new Error("E_POLICY_BUNDLE_INVALID: policy must be an object");
  }

  if (!Array.isArray(raw.signatures)) {
    throw new Error("E_POLICY_BUNDLE_INVALID: signatures must be an array");
  }

  const signatures: PolicyBundleSignatureV2[] = raw.signatures.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`E_POLICY_BUNDLE_INVALID: signatures[${index}] must be an object`);
    }

    const signatureType = assertString(item.signatureType, `signatures[${index}].signatureType`);

    if (signatureType === "rsa") {
      const keyId = assertString(item.keyId, `signatures[${index}].keyId`);
      const algorithm = assertString(item.algorithm, `signatures[${index}].algorithm`);
      const signature = assertString(item.signature, `signatures[${index}].signature`);

      if (algorithm !== "rsa-sha256") {
        throw new Error(`E_POLICY_BUNDLE_INVALID: unsupported signature algorithm '${algorithm}'`);
      }

      return {
        signatureType: "rsa",
        keyId,
        algorithm: "rsa-sha256",
        signature
      };
    }

    if (signatureType === "sigstore-keyless") {
      const signerId = assertString(item.signerId, `signatures[${index}].signerId`);
      const algorithm = assertString(item.algorithm, `signatures[${index}].algorithm`);

      if (algorithm !== "sigstore-keyless") {
        throw new Error(`E_POLICY_BUNDLE_INVALID: unsupported signature algorithm '${algorithm}'`);
      }

      if (!isRecord(item.bundle)) {
        throw new Error(`E_POLICY_BUNDLE_INVALID: signatures[${index}].bundle must be an object`);
      }

      return {
        signatureType: "sigstore-keyless",
        signerId,
        algorithm: "sigstore-keyless",
        bundle: item.bundle
      };
    }

    throw new Error(`E_POLICY_BUNDLE_INVALID: unsupported signatureType '${signatureType}'`);
  });

  return {
    schemaVersion: 2,
    createdAt,
    policySchemaPath,
    policySchemaSha256,
    policySha256,
    requiredSignatures,
    policy: raw.policy,
    signatures
  };
}

export function parsePolicyBundle(raw: unknown): PolicyBundle {
  if (!isRecord(raw)) {
    throw new Error("E_POLICY_BUNDLE_INVALID: bundle payload must be an object");
  }

  const schemaVersion = assertNumber(raw.schemaVersion, "schemaVersion", "E_POLICY_TRUST_STORE_INVALID");
  if (schemaVersion === 1) {
    return parsePolicyBundleV1(raw);
  }

  if (schemaVersion === 2) {
    return parsePolicyBundleV2(raw);
  }

  throw new Error(`E_POLICY_BUNDLE_INVALID: unsupported schemaVersion '${String(schemaVersion)}'`);
}

function parseSignerV1(raw: unknown, index: number, allowLifecycleFields = false): PolicyTrustSignerV1 {
  if (!isRecord(raw)) {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}] must be an object`);
  }

  const id = assertString(raw.id, `signers[${index}].id`, "E_POLICY_TRUST_STORE_INVALID");
  const type = assertString(raw.type, `signers[${index}].type`, "E_POLICY_TRUST_STORE_INVALID");

  if (type === "rsa-key") {
    assertNoExtraKeys(
      raw,
      allowLifecycleFields
        ? ["id", "type", "keyId", "publicKeyPem", "state", "validFrom", "validUntil", "replaces", "replacedBy"]
        : ["id", "type", "keyId", "publicKeyPem"],
      `signers[${index}]`,
      "E_POLICY_TRUST_STORE_INVALID"
    );

    return {
      id,
      type: "rsa-key",
      keyId: assertString(raw.keyId, `signers[${index}].keyId`, "E_POLICY_TRUST_STORE_INVALID"),
      publicKeyPem: assertString(raw.publicKeyPem, `signers[${index}].publicKeyPem`, "E_POLICY_TRUST_STORE_INVALID")
    };
  }

  if (type === "sigstore-keyless") {
    assertNoExtraKeys(
      raw,
      allowLifecycleFields
        ? ["id", "type", "certificateIssuer", "certificateIdentityURI", "state", "validFrom", "validUntil", "replaces", "replacedBy"]
        : ["id", "type", "certificateIssuer", "certificateIdentityURI"],
      `signers[${index}]`,
      "E_POLICY_TRUST_STORE_INVALID"
    );

    return {
      id,
      type: "sigstore-keyless",
      certificateIssuer: assertString(
        raw.certificateIssuer,
        `signers[${index}].certificateIssuer`,
        "E_POLICY_TRUST_STORE_INVALID"
      ),
      certificateIdentityURI: assertString(
        raw.certificateIdentityURI,
        `signers[${index}].certificateIdentityURI`,
        "E_POLICY_TRUST_STORE_INVALID"
      )
    };
  }

  throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}] has unsupported type '${type}'`);
}

function parseSignerV2(raw: unknown, index: number): PolicyTrustSignerV2 {
  if (!isRecord(raw)) {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}] must be an object`);
  }

  const lifecycle = {
    state: assertString(raw.state, `signers[${index}].state`, "E_POLICY_TRUST_STORE_INVALID"),
    validFrom: raw.validFrom,
    validUntil: raw.validUntil,
    replaces: raw.replaces,
    replacedBy: raw.replacedBy
  };

  if (lifecycle.state !== "active" && lifecycle.state !== "retired" && lifecycle.state !== "revoked") {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}].state must be active|retired|revoked`);
  }

  if (lifecycle.validFrom !== undefined && typeof lifecycle.validFrom !== "string") {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}].validFrom must be a string`);
  }

  if (lifecycle.validUntil !== undefined && typeof lifecycle.validUntil !== "string") {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}].validUntil must be a string`);
  }

  if (lifecycle.replaces !== undefined && typeof lifecycle.replaces !== "string") {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}].replaces must be a string`);
  }

  if (lifecycle.replacedBy !== undefined && typeof lifecycle.replacedBy !== "string") {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID: signers[${index}].replacedBy must be a string`);
  }

  if (lifecycle.validFrom) {
    assertIsoDate(lifecycle.validFrom, `signers[${index}].validFrom`, "E_POLICY_TRUST_STORE_INVALID");
  }

  if (lifecycle.validUntil) {
    assertIsoDate(lifecycle.validUntil, `signers[${index}].validUntil`, "E_POLICY_TRUST_STORE_INVALID");
  }

  if (lifecycle.validFrom && lifecycle.validUntil && Date.parse(lifecycle.validFrom) > Date.parse(lifecycle.validUntil)) {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID_LIFECYCLE: signers[${index}] validFrom must be <= validUntil`);
  }

  if (lifecycle.state === "retired" && !lifecycle.validUntil) {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID_LIFECYCLE: signers[${index}] retired signers must set validUntil`);
  }

  const base = parseSignerV1(raw, index, true);

  if (base.type === "rsa-key") {
    assertNoExtraKeys(
      raw,
      ["id", "type", "keyId", "publicKeyPem", "state", "validFrom", "validUntil", "replaces", "replacedBy"],
      `signers[${index}]`,
      "E_POLICY_TRUST_STORE_INVALID"
    );

    return {
      ...base,
      state: lifecycle.state,
      ...(lifecycle.validFrom ? { validFrom: lifecycle.validFrom } : {}),
      ...(lifecycle.validUntil ? { validUntil: lifecycle.validUntil } : {}),
      ...(lifecycle.replaces ? { replaces: lifecycle.replaces } : {}),
      ...(lifecycle.replacedBy ? { replacedBy: lifecycle.replacedBy } : {})
    };
  }

  assertNoExtraKeys(
    raw,
    ["id", "type", "certificateIssuer", "certificateIdentityURI", "state", "validFrom", "validUntil", "replaces", "replacedBy"],
    `signers[${index}]`,
    "E_POLICY_TRUST_STORE_INVALID"
  );

  return {
    ...base,
    state: lifecycle.state,
    ...(lifecycle.validFrom ? { validFrom: lifecycle.validFrom } : {}),
    ...(lifecycle.validUntil ? { validUntil: lifecycle.validUntil } : {}),
    ...(lifecycle.replaces ? { replaces: lifecycle.replaces } : {}),
    ...(lifecycle.replacedBy ? { replacedBy: lifecycle.replacedBy } : {})
  };
}

function validateTrustStoreSigners(
  signers: Array<PolicyTrustSignerV1 | PolicyTrustSignerV2>,
  schemaVersion: 1 | 2
): void {
  const signerIds = new Set<string>();
  const rsaKeyIds = new Set<string>();

  for (const signer of signers) {
    if (signerIds.has(signer.id)) {
      throw new Error(`E_POLICY_TRUST_STORE_INVALID: duplicate signer id '${signer.id}'`);
    }
    signerIds.add(signer.id);

    if (signer.type === "rsa-key") {
      if (rsaKeyIds.has(signer.keyId)) {
        throw new Error(`E_POLICY_TRUST_STORE_INVALID: duplicate rsa keyId '${signer.keyId}'`);
      }
      rsaKeyIds.add(signer.keyId);
    }
  }

  if (schemaVersion === 2) {
    for (const signer of signers as PolicyTrustSignerV2[]) {
      if (signer.replaces && !signerIds.has(signer.replaces)) {
        throw new Error(
          `E_POLICY_TRUST_STORE_INVALID_LIFECYCLE: signer '${signer.id}' replaces unknown signer '${signer.replaces}'`
        );
      }

      if (signer.replacedBy && !signerIds.has(signer.replacedBy)) {
        throw new Error(
          `E_POLICY_TRUST_STORE_INVALID_LIFECYCLE: signer '${signer.id}' replacedBy unknown signer '${signer.replacedBy}'`
        );
      }

      if (signer.replaces && signer.replacedBy && signer.replaces === signer.replacedBy) {
        throw new Error(
          `E_POLICY_TRUST_STORE_INVALID_LIFECYCLE: signer '${signer.id}' cannot replace and be replacedBy the same signer`
        );
      }
    }
  }
}

export function parsePolicyTrustStore(raw: unknown): PolicyTrustStore {
  if (!isRecord(raw)) {
    throw new Error("E_POLICY_TRUST_STORE_INVALID: trust store payload must be an object");
  }

  const schemaVersion = assertNumber(raw.schemaVersion, "schemaVersion");

  if (!Array.isArray(raw.signers) || raw.signers.length === 0) {
    throw new Error("E_POLICY_TRUST_STORE_INVALID: signers must be a non-empty array");
  }

  if (schemaVersion === 1) {
    assertNoExtraKeys(raw, ["schemaVersion", "signers"], "trustStore", "E_POLICY_TRUST_STORE_INVALID");

    const signers = raw.signers.map((item, index) => parseSignerV1(item, index));
    validateTrustStoreSigners(signers, 1);

    return {
      schemaVersion: 1,
      signers
    };
  }

  if (schemaVersion === 2) {
    assertNoExtraKeys(raw, ["schemaVersion", "signers"], "trustStore", "E_POLICY_TRUST_STORE_INVALID");

    const signers = raw.signers.map((item, index) => parseSignerV2(item, index));
    validateTrustStoreSigners(signers, 2);

    return {
      schemaVersion: 2,
      signers
    };
  }

  throw new Error(`E_POLICY_TRUST_STORE_INVALID: unsupported schemaVersion '${String(schemaVersion)}'`);
}

export function buildBundleSigningPayload(bundle: PolicyBundle): string {
  return stableStringify({
    schemaVersion: bundle.schemaVersion,
    createdAt: bundle.createdAt,
    policySchemaPath: bundle.policySchemaPath,
    policySchemaSha256: bundle.policySchemaSha256,
    policySha256: bundle.policySha256,
    requiredSignatures: bundle.requiredSignatures
  });
}

export function signPolicyBundle(bundle: PolicyBundle, keyId: string, privateKeyPem: string): PolicyBundle {
  const signer = crypto.createSign("sha256");
  signer.update(buildBundleSigningPayload(bundle), "utf8");
  signer.end();

  const signature = signer.sign(privateKeyPem).toString("base64");

  if (bundle.schemaVersion === 1) {
    const filtered = bundle.signatures.filter((item) => item.keyId !== keyId);
    return {
      ...bundle,
      signatures: [
        ...filtered,
        {
          keyId,
          algorithm: "rsa-sha256",
          signature
        }
      ]
    };
  }

  const filtered = bundle.signatures.filter((item) => !(item.signatureType === "rsa" && item.keyId === keyId));
  return {
    ...bundle,
    signatures: [
      ...filtered,
      {
        signatureType: "rsa",
        keyId,
        algorithm: "rsa-sha256",
        signature
      }
    ]
  };
}

export async function signPolicyBundleKeyless(
  bundle: PolicyBundleV2,
  signerId: string,
  options: Record<string, unknown> = {},
  sigstoreAdapter: SigstoreAdapter = DEFAULT_SIGSTORE_ADAPTER
): Promise<PolicyBundleV2> {
  const payload = Buffer.from(buildBundleSigningPayload(bundle), "utf8");
  const generatedBundle = await sigstoreAdapter.sign(payload, options);

  const filtered = bundle.signatures.filter(
    (item) => !(item.signatureType === "sigstore-keyless" && item.signerId === signerId)
  );

  return {
    ...bundle,
    signatures: [
      ...filtered,
      {
        signatureType: "sigstore-keyless",
        signerId,
        algorithm: "sigstore-keyless",
        bundle: generatedBundle
      }
    ]
  };
}

function verifyBundleHashes(bundle: PolicyBundle, expectedSchemaSha256: string): void {
  const expectedPolicyHash = hashJson(bundle.policy);
  if (expectedPolicyHash !== bundle.policySha256) {
    throw new Error("E_POLICY_BUNDLE_POLICY_HASH_MISMATCH: policy hash does not match bundle digest");
  }

  if (bundle.policySchemaSha256 !== expectedSchemaSha256) {
    throw new Error("E_POLICY_BUNDLE_SCHEMA_HASH_MISMATCH: schema hash does not match expected digest");
  }
}

function verifyRsaSignature(signingPayload: string, signatureBase64: string, publicKeyPem: string): boolean {
  const verifier = crypto.createVerify("sha256");
  verifier.update(signingPayload, "utf8");
  verifier.end();

  return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
}

function buildSignerIndexes(trustStore: PolicyTrustStore): {
  signersById: Map<string, PolicyTrustSignerV1 | PolicyTrustSignerV2>;
  rsaSignersByKeyId: Map<string, PolicyTrustSignerRsaV1 | PolicyTrustSignerRsaV2>;
} {
  const signersById = new Map<string, PolicyTrustSignerV1 | PolicyTrustSignerV2>();
  const rsaSignersByKeyId = new Map<string, PolicyTrustSignerRsaV1 | PolicyTrustSignerRsaV2>();

  for (const signer of trustStore.signers) {
    signersById.set(signer.id, signer);

    if (signer.type === "rsa-key") {
      rsaSignersByKeyId.set(signer.keyId, signer);
    }
  }

  return {
    signersById,
    rsaSignersByKeyId
  };
}

function parseBundleCreatedAt(bundle: PolicyBundle): number {
  assertIsoDate(bundle.createdAt, "createdAt", "E_POLICY_BUNDLE_INVALID");
  return Date.parse(bundle.createdAt);
}

function assertSignerLifecycleEligible(
  signer: PolicyTrustSignerV1 | PolicyTrustSignerV2,
  bundleCreatedAtMs: number
): void {
  if (!("state" in signer)) {
    return;
  }

  if (signer.state === "revoked") {
    throw new Error(`E_POLICY_TRUST_SIGNER_REVOKED: signer '${signer.id}' is revoked`);
  }

  const validFromMs = signer.validFrom ? Date.parse(signer.validFrom) : null;
  const validUntilMs = signer.validUntil ? Date.parse(signer.validUntil) : null;

  if (validFromMs !== null && bundleCreatedAtMs < validFromMs) {
    throw new Error(
      `E_POLICY_TRUST_SIGNER_OUTSIDE_VALIDITY: signer '${signer.id}' is not valid before ${signer.validFrom}`
    );
  }

  if (validUntilMs !== null && bundleCreatedAtMs > validUntilMs) {
    throw new Error(
      `E_POLICY_TRUST_SIGNER_OUTSIDE_VALIDITY: signer '${signer.id}' expired at ${signer.validUntil}`
    );
  }

  if (signer.state === "retired" && validUntilMs === null) {
    throw new Error(`E_POLICY_TRUST_STORE_INVALID_LIFECYCLE: signer '${signer.id}' is retired but missing validUntil`);
  }
}

export function verifyPolicyBundle(
  bundle: PolicyBundle,
  trustedPublicKeys: Record<string, string>,
  expectedSchemaSha256: string
): { validSignatures: string[] } {
  verifyBundleHashes(bundle, expectedSchemaSha256);

  const signingPayload = buildBundleSigningPayload(bundle);
  const validSignatures: string[] = [];

  if (bundle.schemaVersion === 1) {
    for (const signature of bundle.signatures) {
      const publicKey = trustedPublicKeys[signature.keyId];
      if (!publicKey) {
        continue;
      }

      if (verifyRsaSignature(signingPayload, signature.signature, publicKey)) {
        validSignatures.push(signature.keyId);
      }
    }
  } else {
    for (const signature of bundle.signatures) {
      if (signature.signatureType !== "rsa") {
        continue;
      }

      const publicKey = trustedPublicKeys[signature.keyId];
      if (!publicKey) {
        continue;
      }

      if (verifyRsaSignature(signingPayload, signature.signature, publicKey)) {
        validSignatures.push(signature.keyId);
      }
    }
  }

  const uniqueValid = Array.from(new Set(validSignatures));
  if (uniqueValid.length < bundle.requiredSignatures) {
    throw new Error(
      `E_POLICY_BUNDLE_SIGNATURES_INVALID: valid=${uniqueValid.length} required=${bundle.requiredSignatures}`
    );
  }

  return {
    validSignatures: uniqueValid
  };
}

export async function verifyPolicyBundleWithTrustStore(
  bundle: PolicyBundle,
  trustStore: PolicyTrustStore,
  expectedSchemaSha256: string,
  sigstoreAdapter: SigstoreAdapter = DEFAULT_SIGSTORE_ADAPTER
): Promise<{ validSignatures: string[] }> {
  verifyBundleHashes(bundle, expectedSchemaSha256);

  const bundleCreatedAtMs = parseBundleCreatedAt(bundle);
  const signingPayload = buildBundleSigningPayload(bundle);
  const signingPayloadBuffer = Buffer.from(signingPayload, "utf8");
  const { signersById, rsaSignersByKeyId } = buildSignerIndexes(trustStore);

  const validSignatures: string[] = [];

  if (bundle.schemaVersion === 1) {
    for (const signature of bundle.signatures) {
      const signer = rsaSignersByKeyId.get(signature.keyId);
      if (!signer) {
        continue;
      }

      assertSignerLifecycleEligible(signer, bundleCreatedAtMs);

      const isValid = verifyRsaSignature(signingPayload, signature.signature, signer.publicKeyPem);
      if (isValid) {
        validSignatures.push(signer.id);
      }
    }
  } else {
    for (const signature of bundle.signatures) {
      if (signature.signatureType === "rsa") {
        const signer = rsaSignersByKeyId.get(signature.keyId);
        if (!signer) {
          continue;
        }

        assertSignerLifecycleEligible(signer, bundleCreatedAtMs);

        const isValid = verifyRsaSignature(signingPayload, signature.signature, signer.publicKeyPem);
        if (isValid) {
          validSignatures.push(signer.id);
        }
        continue;
      }

      const signer = signersById.get(signature.signerId);
      if (!signer || signer.type !== "sigstore-keyless") {
        continue;
      }

      assertSignerLifecycleEligible(signer, bundleCreatedAtMs);

      try {
        await sigstoreAdapter.verify(signature.bundle, signingPayloadBuffer, {
          certificateIssuer: signer.certificateIssuer,
          certificateIdentityURI: signer.certificateIdentityURI
        });
        validSignatures.push(signer.id);
      } catch {
        // Invalid keyless signatures are treated as non-quorum; verifier remains fail-closed.
      }
    }
  }

  const uniqueValid = Array.from(new Set(validSignatures));
  if (uniqueValid.length < bundle.requiredSignatures) {
    throw new Error(
      `E_POLICY_BUNDLE_SIGNATURES_INVALID: valid=${uniqueValid.length} required=${bundle.requiredSignatures}`
    );
  }

  return {
    validSignatures: uniqueValid
  };
}

function normalizePath(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

function collectDiffPaths(base: unknown, override: unknown, prefix = ""): string[] {
  if (stableStringify(base) === stableStringify(override)) {
    return [];
  }

  if (!isRecord(base) || !isRecord(override)) {
    return prefix ? [prefix] : ["<root>"];
  }

  const paths: string[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const key of Array.from(keys).sort(stableCompare)) {
    const baseValue = base[key];
    const overrideValue = override[key];
    const pathKey = prefix ? `${prefix}.${key}` : key;

    if (!(key in override)) {
      continue;
    }

    if (!(key in base)) {
      paths.push(pathKey);
      continue;
    }

    paths.push(...collectDiffPaths(baseValue, overrideValue, pathKey));
  }

  return paths;
}

function isPathMatch(path: string, pattern: string): boolean {
  if (pattern === path) {
    return true;
  }

  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}.`);
  }

  return path.startsWith(`${pattern}.`);
}

function isAllowedPath(path: string, constraints: PolicyOverrideConstraints): boolean {
  const normalized = normalizePath(path);

  const forbidden = constraints.forbiddenOverridePaths.some((item) => isPathMatch(normalized, item));
  if (forbidden) {
    return false;
  }

  return constraints.allowedOverridePaths.some((item) => isPathMatch(normalized, item));
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!(key in base)) {
      result[key] = value;
      continue;
    }

    result[key] = deepMerge(base[key], value);
  }

  return result;
}

export function parseOverrideConstraints(raw: unknown): PolicyOverrideConstraints {
  if (!isRecord(raw)) {
    throw new Error("E_OVERRIDE_CONSTRAINTS_INVALID: constraints must be an object");
  }

  if (raw.schemaVersion !== 1) {
    throw new Error(`E_OVERRIDE_CONSTRAINTS_INVALID: unsupported schemaVersion '${String(raw.schemaVersion)}'`);
  }

  const allowed = raw.allowedOverridePaths;
  const forbidden = raw.forbiddenOverridePaths;

  if (!Array.isArray(allowed) || !allowed.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("E_OVERRIDE_CONSTRAINTS_INVALID: allowedOverridePaths must be string[]");
  }

  if (!Array.isArray(forbidden) || !forbidden.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("E_OVERRIDE_CONSTRAINTS_INVALID: forbiddenOverridePaths must be string[]");
  }

  return {
    schemaVersion: 1,
    allowedOverridePaths: allowed,
    forbiddenOverridePaths: forbidden
  };
}

export function mergePoliciesWithConstraints(
  orgPolicy: Record<string, unknown>,
  localPolicy: Record<string, unknown>,
  constraints: PolicyOverrideConstraints
): Record<string, unknown> {
  const diffPaths = collectDiffPaths(orgPolicy, localPolicy)
    .map((item) => normalizePath(item))
    .filter((item) => item !== "<root>");

  const disallowed = diffPaths.filter((item) => !isAllowedPath(item, constraints));
  if (disallowed.length > 0) {
    throw new Error(`E_POLICY_OVERRIDE_FORBIDDEN: ${Array.from(new Set(disallowed)).sort(stableCompare).join(", ")}`);
  }

  return deepMerge(orgPolicy, localPolicy) as Record<string, unknown>;
}

export function toReplayComparable(report: Record<string, unknown>): string {
  return stableStringify({
    schemaVersion: report.schemaVersion,
    provider: report.provider,
    eventName: report.eventName,
    policyVersion: report.policyVersion,
    enforcement: report.enforcement,
    decision: report.decision,
    targetsScanned: report.targetsScanned,
    highestAiScore: report.highestAiScore,
    humanApprovals: report.humanApprovals,
    findings: report.findings,
    targets: report.targets,
    evidenceHashes: report.evidenceHashes,
    accessibilitySummary: report.accessibilitySummary
  });
}

export function buildPolicyBundleTemplate(params: {
  policy: Record<string, unknown>;
  policySchemaPath: string;
  policySchemaSha256: string;
  requiredSignatures: number;
  createdAt?: string;
  schemaVersion?: 1 | 2;
}): PolicyBundle {
  const createdAt = params.createdAt ?? new Date().toISOString();
  const schemaVersion = params.schemaVersion ?? 1;

  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      createdAt,
      policySchemaPath: params.policySchemaPath,
      policySchemaSha256: params.policySchemaSha256,
      policySha256: hashJson(params.policy),
      requiredSignatures: params.requiredSignatures,
      policy: params.policy,
      signatures: []
    };
  }

  return {
    schemaVersion: 2,
    createdAt,
    policySchemaPath: params.policySchemaPath,
    policySchemaSha256: params.policySchemaSha256,
    policySha256: hashJson(params.policy),
    requiredSignatures: params.requiredSignatures,
    policy: params.policy,
    signatures: []
  };
}
