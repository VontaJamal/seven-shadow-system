import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderAdapter, ProviderPolicyContext, PullContext } from "../src/providers/types";

interface ExtractionContractCase {
  name: string;
  eventName: string;
  payload: unknown;
  expectedSources: Array<"pr_body" | "review" | "comment">;
  expectedMalformedReasons?: string[];
}

interface PullContextContractCase {
  name: string;
  eventName: string;
  payload: unknown;
  expected: PullContext | null;
}

interface ApprovalContractCase {
  name: string;
  context: PullContext;
  allowedAuthors: Set<string>;
  expectedApprovals: number;
  fetchTimeoutMs: number;
  maxPages: number;
  fetchImpl: typeof fetch;
}

export interface ProviderContractSuiteOptions {
  providerName: string;
  provider: ProviderAdapter;
  policyContext: ProviderPolicyContext;
  extractionCases: ExtractionContractCase[];
  malformedCase: ExtractionContractCase;
  pullContextCases: PullContextContractCase[];
  approvalCase: ApprovalContractCase;
}

export function runProviderContractSuite(options: ProviderContractSuiteOptions): void {
  test(`${options.providerName} contract: supported events are declared`, () => {
    assert.ok(options.provider.supportedEvents.size > 0);
  });

  for (const extractionCase of options.extractionCases) {
    test(`${options.providerName} contract: ${extractionCase.name}`, () => {
      const result = options.provider.extractTargets(extractionCase.eventName, extractionCase.payload, options.policyContext);
      const sources = result.targets.map((item) => item.source);

      assert.deepEqual(sources, extractionCase.expectedSources);
      assert.deepEqual(result.malformedReasons, extractionCase.expectedMalformedReasons ?? []);
    });
  }

  test(`${options.providerName} contract: malformed payload reasons are deterministic`, () => {
    const result = options.provider.extractTargets(
      options.malformedCase.eventName,
      options.malformedCase.payload,
      options.policyContext
    );
    const expectedReasons = options.malformedCase.expectedMalformedReasons ?? [];
    const expectedSources = options.malformedCase.expectedSources;

    assert.deepEqual(result.targets.map((item) => item.source), expectedSources);
    assert.deepEqual(result.malformedReasons, expectedReasons);
  });

  for (const pullContextCase of options.pullContextCases) {
    test(`${options.providerName} contract: ${pullContextCase.name}`, () => {
      const actual = options.provider.extractPullContext(pullContextCase.eventName, pullContextCase.payload);
      assert.deepEqual(actual, pullContextCase.expected);
    });
  }

  test(`${options.providerName} contract: ${options.approvalCase.name}`, async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = options.approvalCase.fetchImpl;
      const approvals = await options.provider.fetchHumanApprovalCount(options.approvalCase.context, {
        githubToken: "token",
        allowedAuthors: options.approvalCase.allowedAuthors,
        fetchTimeoutMs: options.approvalCase.fetchTimeoutMs,
        maxPages: options.approvalCase.maxPages,
        retry: {
          enabled: true,
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 2,
          jitterRatio: 0,
          retryableStatusCodes: [429, 500, 502, 503, 504]
        }
      });

      assert.equal(approvals, options.approvalCase.expectedApprovals);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
