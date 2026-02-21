import crypto from "node:crypto";

export interface PolicyBundleSignature {
  keyId: string;
  algorithm: "rsa-sha256";
  signature: string;
}

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

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`E_POLICY_BUNDLE_INVALID: '${field}' must be a non-empty string`);
  }

  return value;
}

function assertNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`E_POLICY_BUNDLE_INVALID: '${field}' must be numeric`);
  }

  return value;
}

function assertHex64(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`E_POLICY_BUNDLE_INVALID: '${field}' must be a 64-char lowercase hex digest`);
  }

  return value;
}

export function parsePolicyBundle(raw: unknown): PolicyBundleV1 {
  if (!isRecord(raw)) {
    throw new Error("E_POLICY_BUNDLE_INVALID: bundle payload must be an object");
  }

  const schemaVersion = assertNumber(raw.schemaVersion, "schemaVersion");
  if (schemaVersion !== 1) {
    throw new Error(`E_POLICY_BUNDLE_INVALID: unsupported schemaVersion '${String(schemaVersion)}'`);
  }

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

export function buildBundleSigningPayload(bundle: PolicyBundleV1): string {
  return stableStringify({
    schemaVersion: bundle.schemaVersion,
    createdAt: bundle.createdAt,
    policySchemaPath: bundle.policySchemaPath,
    policySchemaSha256: bundle.policySchemaSha256,
    policySha256: bundle.policySha256,
    requiredSignatures: bundle.requiredSignatures
  });
}

export function signPolicyBundle(bundle: PolicyBundleV1, keyId: string, privateKeyPem: string): PolicyBundleV1 {
  const signer = crypto.createSign("sha256");
  signer.update(buildBundleSigningPayload(bundle), "utf8");
  signer.end();

  const signature = signer.sign(privateKeyPem).toString("base64");

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

export function verifyPolicyBundle(
  bundle: PolicyBundleV1,
  trustedPublicKeys: Record<string, string>,
  expectedSchemaSha256: string
): { validSignatures: string[] } {
  const expectedPolicyHash = hashJson(bundle.policy);
  if (expectedPolicyHash !== bundle.policySha256) {
    throw new Error("E_POLICY_BUNDLE_POLICY_HASH_MISMATCH: policy hash does not match bundle digest");
  }

  if (bundle.policySchemaSha256 !== expectedSchemaSha256) {
    throw new Error("E_POLICY_BUNDLE_SCHEMA_HASH_MISMATCH: schema hash does not match expected digest");
  }

  const signingPayload = buildBundleSigningPayload(bundle);
  const validSignatures: string[] = [];

  for (const signature of bundle.signatures) {
    const publicKey = trustedPublicKeys[signature.keyId];
    if (!publicKey) {
      continue;
    }

    const verifier = crypto.createVerify("sha256");
    verifier.update(signingPayload, "utf8");
    verifier.end();

    const isValid = verifier.verify(publicKey, Buffer.from(signature.signature, "base64"));
    if (isValid) {
      validSignatures.push(signature.keyId);
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
}): PolicyBundleV1 {
  const createdAt = params.createdAt ?? new Date().toISOString();

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
