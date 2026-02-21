import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { getProviderByName, listProviderNames } from "../src/providers/registry";
import {
  buildPagedFetchStub,
  runProviderContractSuite,
  type ProviderContractFixture
} from "./providerContractHarness";

interface ProviderContractManifest {
  schemaVersion: 1;
  providers: string[];
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function parseManifest(raw: unknown): ProviderContractManifest {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));

  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  const providers = (raw as { providers?: unknown }).providers;

  assert.equal(schemaVersion, 1, "provider contract manifest must have schemaVersion=1");
  assert.ok(Array.isArray(providers) && providers.length > 0, "provider contract manifest must declare providers[]");

  for (const provider of providers) {
    assert.equal(typeof provider, "string");
    assert.ok(provider.length > 0);
  }

  return {
    schemaVersion: 1,
    providers: providers as string[]
  };
}

function parseFixture(raw: unknown, filePath: string): ProviderContractFixture {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw), `${filePath} must be an object`);
  const fixture = raw as ProviderContractFixture;

  assert.equal(fixture.schemaVersion, 1, `${filePath} schemaVersion must be 1`);
  assert.equal(typeof fixture.providerName, "string", `${filePath} providerName must be a string`);
  assert.ok(fixture.providerName.length > 0, `${filePath} providerName must be non-empty`);
  assert.ok(Array.isArray(fixture.extractionCases), `${filePath} extractionCases must be an array`);
  assert.ok(Array.isArray(fixture.pullContextCases), `${filePath} pullContextCases must be an array`);
  assert.ok(Array.isArray(fixture.approvalCase.pages), `${filePath} approvalCase.pages must be an array`);

  return fixture;
}

const fixturesRoot = path.join(process.cwd(), "conformance", "provider-contract");
const manifestPath = path.join(fixturesRoot, "manifest.json");
const manifest = parseManifest(readJson(manifestPath));

for (const relativeProviderPath of manifest.providers) {
  const fixturePath = path.join(fixturesRoot, relativeProviderPath);
  const fixture = parseFixture(readJson(fixturePath), fixturePath);
  const provider = getProviderByName(fixture.providerName);

  assert.ok(
    provider,
    `No provider adapter registered for fixture '${fixture.providerName}'. Available: ${listProviderNames().join(", ")}`
  );

  runProviderContractSuite({
    providerName: fixture.providerName,
    provider,
    policyContext: fixture.policyContext,
    extractionCases: fixture.extractionCases,
    malformedCase: fixture.malformedCase,
    pullContextCases: fixture.pullContextCases,
    approvalCase: {
      name: fixture.approvalCase.name,
      context: fixture.approvalCase.context,
      allowedAuthors: new Set(fixture.approvalCase.allowedAuthors.map((item) => item.trim().toLowerCase())),
      expectedApprovals: fixture.approvalCase.expectedApprovals,
      fetchTimeoutMs: fixture.approvalCase.fetchTimeoutMs,
      maxPages: fixture.approvalCase.maxPages,
      fetchImpl: buildPagedFetchStub({
        pages: fixture.approvalCase.pages,
        defaultStatus: fixture.approvalCase.defaultStatus,
        defaultBody: fixture.approvalCase.defaultBody,
        defaultHeaders: fixture.approvalCase.defaultHeaders
      })
    }
  });
}
