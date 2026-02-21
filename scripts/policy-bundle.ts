import fs from "node:fs/promises";
import path from "node:path";

import {
  buildPolicyBundleTemplate,
  parsePolicyBundle,
  parsePolicyTrustStore,
  sha256Hex,
  signPolicyBundle,
  signPolicyBundleKeyless,
  verifyPolicyBundle,
  verifyPolicyBundleWithTrustStore
} from "../src/policyGovernance";

type Command = "create" | "sign" | "sign-keyless" | "verify";

interface ParsedCli {
  command: Command;
  options: Map<string, string[]>;
}

function parseCli(argv: string[]): ParsedCli {
  const command = argv[0];
  if (command !== "create" && command !== "sign" && command !== "sign-keyless" && command !== "verify") {
    throw new Error("Usage: policy-bundle <create|sign|sign-keyless|verify> [options]");
  }

  const options = new Map<string, string[]>();

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) {
      throw new Error(`E_ARG_INVALID: unexpected token '${token}'`);
    }

    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`E_ARG_VALUE_REQUIRED: ${token}`);
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
    throw new Error(`E_ARG_REQUIRED: ${key}`);
  }

  return value;
}

function parsePositiveInt(value: string, key: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`E_ARG_INVALID_INT: ${key} must be an integer >= 1`);
  }

  return parsed;
}

function parseBooleanStrict(value: string, optionName: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`E_ARG_INVALID_BOOLEAN: ${optionName} must be true|false`);
}

function parseSchemaVersion(value: string): 1 | 2 {
  if (value === "1") {
    return 1;
  }

  if (value === "2") {
    return 2;
  }

  throw new Error("E_ARG_INVALID: --schema-version must be 1 or 2");
}

function parseKeySpec(value: string): { keyId: string; keyPath: string } {
  const index = value.indexOf("=");
  if (index <= 0 || index >= value.length - 1) {
    throw new Error(`E_KEY_SPEC_INVALID: expected keyId=path, received '${value}'`);
  }

  const keyId = value.slice(0, index).trim();
  const keyPath = value.slice(index + 1).trim();

  if (!keyId || !keyPath) {
    throw new Error(`E_KEY_SPEC_INVALID: expected keyId=path, received '${value}'`);
  }

  return {
    keyId,
    keyPath
  };
}

async function loadJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function loadJsonObject(filePath: string, label: string): Promise<Record<string, unknown>> {
  const raw = await loadJson(filePath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`E_JSON_OBJECT_REQUIRED: ${label} must be a JSON object`);
  }

  return raw as Record<string, unknown>;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function commandCreate(options: Map<string, string[]>): Promise<void> {
  const policyPath = requireOption(options, "--policy");
  const schemaPath = requireOption(options, "--schema");
  const outputPath = requireOption(options, "--output");
  const requiredSignatures = parsePositiveInt(requireOption(options, "--required-signatures"), "--required-signatures");
  const createdAt = options.get("--created-at")?.[0];
  const schemaVersion = parseSchemaVersion(options.get("--schema-version")?.[0] ?? "1");

  const policy = await loadJsonObject(policyPath, "--policy");
  const schemaRaw = await fs.readFile(schemaPath, "utf8");

  const bundle = buildPolicyBundleTemplate({
    policy,
    policySchemaPath: schemaPath,
    policySchemaSha256: sha256Hex(schemaRaw),
    requiredSignatures,
    schemaVersion,
    ...(createdAt ? { createdAt } : {})
  });

  await writeJson(outputPath, bundle);
  console.log(`Created unsigned policy bundle at ${outputPath}`);
}

async function commandSign(options: Map<string, string[]>): Promise<void> {
  const bundlePath = requireOption(options, "--bundle");
  const outputPath = options.get("--output")?.[0] ?? bundlePath;
  const keyId = requireOption(options, "--key-id");
  const privateKeyPath = requireOption(options, "--private-key");

  const bundle = parsePolicyBundle(await loadJson(bundlePath));
  const privateKey = await fs.readFile(privateKeyPath, "utf8");
  const signed = signPolicyBundle(bundle, keyId, privateKey);

  await writeJson(outputPath, signed);
  console.log(`Signed policy bundle written to ${outputPath}`);
}

async function commandSignKeyless(options: Map<string, string[]>): Promise<void> {
  const bundlePath = requireOption(options, "--bundle");
  const outputPath = options.get("--output")?.[0] ?? bundlePath;
  const signerId = requireOption(options, "--signer-id");

  const bundle = parsePolicyBundle(await loadJson(bundlePath));
  if (bundle.schemaVersion !== 2) {
    throw new Error("E_POLICY_BUNDLE_VERSION_REQUIRED: sign-keyless requires a schemaVersion=2 bundle");
  }

  const sigstoreOptions: Record<string, unknown> = {};
  const fulcioURL = options.get("--fulcio-url")?.[0];
  const rekorURL = options.get("--rekor-url")?.[0];
  const tsaServerURL = options.get("--tsa-url")?.[0];
  const tlogUploadValue = options.get("--tlog-upload")?.[0];
  const identityToken = options.get("--identity-token")?.[0];

  if (fulcioURL) {
    sigstoreOptions.fulcioURL = fulcioURL;
  }

  if (rekorURL) {
    sigstoreOptions.rekorURL = rekorURL;
  }

  if (tsaServerURL) {
    sigstoreOptions.tsaServerURL = tsaServerURL;
  }

  if (tlogUploadValue) {
    sigstoreOptions.tlogUpload = parseBooleanStrict(tlogUploadValue, "--tlog-upload");
  }

  if (identityToken) {
    sigstoreOptions.identityToken = identityToken;
  }

  const signed = await signPolicyBundleKeyless(bundle, signerId, sigstoreOptions);

  await writeJson(outputPath, signed);
  console.log(`Keyless-signed policy bundle written to ${outputPath}`);
}

async function commandVerify(options: Map<string, string[]>): Promise<void> {
  const bundlePath = requireOption(options, "--bundle");
  const schemaPath = requireOption(options, "--schema");
  const trustStorePath = options.get("--trust-store")?.[0];
  const publicKeySpecs = options.get("--public-key") ?? [];

  if (trustStorePath && publicKeySpecs.length > 0) {
    throw new Error("E_ARG_CONFLICT: --trust-store cannot be combined with --public-key");
  }

  const bundle = parsePolicyBundle(await loadJson(bundlePath));
  const schemaRaw = await fs.readFile(schemaPath, "utf8");

  if (trustStorePath) {
    const trustStore = parsePolicyTrustStore(await loadJson(trustStorePath));
    const verification = await verifyPolicyBundleWithTrustStore(bundle, trustStore, sha256Hex(schemaRaw));
    console.log(
      `Policy bundle verified with trust store. Valid signatures: ${verification.validSignatures.join(", ")} (required=${bundle.requiredSignatures})`
    );
    return;
  }

  if (publicKeySpecs.length === 0) {
    throw new Error("E_ARG_REQUIRED: provide either --trust-store <path> or at least one --public-key keyId=path");
  }

  const trustedPublicKeys: Record<string, string> = {};
  for (const spec of publicKeySpecs) {
    const parsed = parseKeySpec(spec);
    if (parsed.keyId in trustedPublicKeys) {
      throw new Error(`E_KEY_SPEC_DUPLICATE: duplicate keyId '${parsed.keyId}'`);
    }
    trustedPublicKeys[parsed.keyId] = await fs.readFile(parsed.keyPath, "utf8");
  }

  const verification = verifyPolicyBundle(bundle, trustedPublicKeys, sha256Hex(schemaRaw));

  console.log(
    `Policy bundle verified. Valid signatures: ${verification.validSignatures.join(", ")} (required=${bundle.requiredSignatures})`
  );
}

async function run(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));
  if (parsed.command === "create") {
    await commandCreate(parsed.options);
    return;
  }

  if (parsed.command === "sign") {
    await commandSign(parsed.options);
    return;
  }

  if (parsed.command === "sign-keyless") {
    await commandSignKeyless(parsed.options);
    return;
  }

  await commandVerify(parsed.options);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Policy bundle command failed: ${message}`);
  process.exit(1);
});
