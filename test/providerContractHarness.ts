import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderAdapter, ProviderPolicyContext, PullContext } from "../src/providers/types";

export interface ExtractionContractCase {
  name: string;
  eventName: string;
  payload: unknown;
  expectedSources: Array<"pr_body" | "review" | "comment">;
  expectedMalformedReasons?: string[];
}

export interface PullContextContractCase {
  name: string;
  eventName: string;
  payload: unknown;
  expected: PullContext | null;
}

export interface ApprovalContractCase {
  name: string;
  context: PullContext;
  allowedAuthors: Set<string>;
  expectedApprovals: number;
  fetchTimeoutMs: number;
  maxPages: number;
  fetchImpl: typeof fetch;
}

export interface ProviderApprovalPageFixture {
  page: number;
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface ProviderApprovalFixtureCase {
  name: string;
  context: PullContext;
  allowedAuthors: string[];
  expectedApprovals: number;
  fetchTimeoutMs: number;
  maxPages: number;
  pages: ProviderApprovalPageFixture[];
  defaultStatus?: number;
  defaultBody?: unknown;
  defaultHeaders?: Record<string, string>;
}

export interface ProviderContractFixture {
  schemaVersion: 1;
  providerName: string;
  policyContext: ProviderPolicyContext;
  extractionCases: ExtractionContractCase[];
  malformedCase: ExtractionContractCase;
  pullContextCases: PullContextContractCase[];
  approvalCase: ProviderApprovalFixtureCase;
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

export function buildPagedFetchStub(options: {
  pages: ProviderApprovalPageFixture[];
  defaultStatus?: number;
  defaultBody?: unknown;
  defaultHeaders?: Record<string, string>;
}): typeof fetch {
  const pagesByNumber = new Map<number, ProviderApprovalPageFixture>();
  for (const page of options.pages) {
    pagesByNumber.set(page.page, page);
  }

  const defaultStatus = options.defaultStatus ?? 200;
  const defaultBody = options.defaultBody ?? [];
  const defaultHeaders = options.defaultHeaders ?? {
    "content-type": "application/json"
  };

  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const parsed = new URL(url);
    const pageNumber = Number.parseInt(parsed.searchParams.get("page") ?? "1", 10);

    const fixture = pagesByNumber.get(Number.isInteger(pageNumber) ? pageNumber : 1);
    const status = fixture?.status ?? defaultStatus;
    const body = fixture?.body ?? defaultBody;
    const headers = fixture?.headers ?? defaultHeaders;

    return new Response(JSON.stringify(body), {
      status,
      headers
    });
  };
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
