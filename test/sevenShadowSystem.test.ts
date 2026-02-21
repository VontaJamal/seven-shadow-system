import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  GuardPolicySchema,
  evaluateTargets,
  extractTargetsFromEvent,
  runSevenShadowSystem
} from "../src/sevenShadowSystem";

const execFileAsync = promisify(execFile);

const basePolicy = GuardPolicySchema.parse({
  version: 2,
  enforcement: "block",
  blockBotAuthors: true,
  blockedAuthors: [],
  allowedAuthors: [],
  scanPrBody: true,
  scanReviewBody: true,
  scanCommentBody: true,
  maxAiScore: 0.5,
  disclosureTag: "[AI-ASSISTED]",
  disclosureRequiredScore: 0.3,
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
      jitterRatio: 0.2,
      retryableStatusCodes: [429, 500, 502, 503, 504]
    }
  },
  rules: [
    {
      name: "explicit",
      pattern: "as an ai language model",
      action: "block"
    },
    {
      name: "template",
      pattern: "great work",
      action: "score",
      weight: 0.35
    }
  ]
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-system-test-"));
}

async function writeApprovalEvent(eventPath: string): Promise<void> {
  await fs.writeFile(
    eventPath,
    `${JSON.stringify({
      repository: { full_name: "acme/repo" },
      pull_request: {
        number: 42,
        body: "Test PR body",
        user: { login: "repo-owner", type: "User" }
      },
      review: {
        id: 9,
        body: "Looks good to me",
        user: { login: "human-reviewer", type: "User" }
      }
    })}\n`,
    "utf8"
  );
}

test("extractTargetsFromEvent includes review and PR body when configured", () => {
  const targets = extractTargetsFromEvent(
    "pull_request_review",
    {
      repository: {
        full_name: "acme/repo"
      },
      review: {
        id: 3,
        body: "Great work team.",
        user: { login: "someone", type: "User" }
      },
      pull_request: {
        number: 9,
        body: "PR body text",
        user: { login: "owner", type: "User" }
      }
    },
    basePolicy
  );

  assert.equal(targets.length, 2);
  assert.equal(targets[0]?.source, "pr_body");
  assert.equal(targets[1]?.source, "review");
});

test("evaluateTargets blocks bot authors by policy", () => {
  const result = evaluateTargets(basePolicy, [
    {
      source: "review",
      referenceId: "review:1",
      authorLogin: "some-bot[bot]",
      authorType: "Bot",
      body: "Looks good"
    }
  ]);

  const codes = result.findings.map((item) => item.code);
  assert.equal(codes.includes("GUARD_BOT_BLOCKED"), true);
});

test("evaluateTargets rejects unsafe regex patterns", () => {
  const unsafePolicy = GuardPolicySchema.parse({
    ...basePolicy,
    rules: [
      {
        name: "unsafe",
        pattern: "(a+)+$",
        action: "score",
        weight: 0.3
      }
    ]
  });

  assert.throws(() => {
    evaluateTargets(unsafePolicy, [
      {
        source: "review",
        referenceId: "review:unsafe",
        authorLogin: "human",
        authorType: "User",
        body: "aaaa"
      }
    ]);
  }, /E_UNSAFE_RULE_REGEX/);
});

test("runSevenShadowSystem blocks malformed payloads", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    await fs.writeFile(policyPath, `${JSON.stringify(basePolicy, null, 2)}\n`, "utf8");
    await fs.writeFile(eventPath, `${JSON.stringify({ foo: "bar" })}\n`, "utf8");

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      { ...process.env, GITHUB_TOKEN: "" }
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_MALFORMED_EVENT"), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem blocks unsupported events by default", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    await fs.writeFile(policyPath, `${JSON.stringify(basePolicy, null, 2)}\n`, "utf8");
    await fs.writeFile(
      eventPath,
      `${JSON.stringify({ repository: { full_name: "acme/repo" }, pull_request: { number: 1, body: "x" } })}\n`,
      "utf8"
    );

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "push",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_UNSUPPORTED_EVENT"), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem blocks oversized event payloads", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const constrainedPolicy = {
      ...basePolicy,
      runtime: {
        ...basePolicy.runtime,
        maxEventBytes: 1024
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(constrainedPolicy, null, 2)}\n`, "utf8");
    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: {
          number: 99,
          body: "x".repeat(4000),
          user: { login: "owner", type: "User" }
        }
      })}\n`,
      "utf8"
    );

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_EVENT_TOO_LARGE"), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem truncation limit is deterministic", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const truncationPolicy = {
      ...basePolicy,
      runtime: {
        ...basePolicy.runtime,
        maxBodyChars: 32
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(truncationPolicy, null, 2)}\n`, "utf8");
    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: { number: 11, body: "PR body", user: { login: "owner", type: "User" } },
        review: {
          id: 8,
          body: "0123456789abcdef0123456789abcdef0123456789",
          user: { login: "human", type: "User" }
        }
      })}\n`,
      "utf8"
    );

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
      findings: Array<{ code: string }>;
      targets: Array<{ body?: string; bodyExcerpt?: string }>;
    };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_BODY_TRUNCATED"), true);
    assert.equal(report.targets.every((item) => item.body === undefined), true);
    assert.equal(report.targets.every((item) => item.bodyExcerpt === undefined), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem blocks when human approvals cannot be verified", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 1
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: {
          number: 42,
          body: "Test PR body",
          user: { login: "repo-owner", type: "User" }
        },
        review: {
          id: 9,
          body: "Looks good to me",
          user: { login: "human-reviewer", type: "User" }
        }
      })}\n`,
      "utf8"
    );

    const code = await runSevenShadowSystem(
      ["--policy", policyPath, "--event", eventPath, "--event-name", "pull_request_review"],
      { ...process.env, GITHUB_TOKEN: "" }
    );

    assert.equal(code, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem converts provider fetch errors into deterministic findings", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 1
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await writeApprovalEvent(eventPath);

    globalThis.fetch = async () => {
      throw new Error("network down");
    };

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      { ...process.env, GITHUB_TOKEN: "token" }
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_APPROVALS_FETCH_ERROR"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem retries on 429 and succeeds when approval fetch later recovers", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 1,
        retry: {
          ...basePolicy.approvals.retry,
          maxAttempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0
        }
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await writeApprovalEvent(eventPath);

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: {
            "retry-after": "0"
          }
        });
      }

      return new Response(
        JSON.stringify([
          {
            state: "APPROVED",
            user: {
              login: "reviewer-ok",
              type: "User"
            }
          }
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    };

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      { ...process.env, GITHUB_TOKEN: "token" }
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 0);
    assert.equal(callCount, 2);
    assert.equal(report.findings.some((item) => item.code === "GUARD_APPROVALS_RATE_LIMITED"), false);
    assert.equal(report.findings.some((item) => item.code === "GUARD_APPROVALS_RETRY_EXHAUSTED"), false);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem blocks with GUARD_APPROVALS_RETRY_EXHAUSTED after repeated 429 responses", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 1,
        retry: {
          ...basePolicy.approvals.retry,
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0
        }
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await writeApprovalEvent(eventPath);

    globalThis.fetch = async () =>
      new Response("rate limited", {
        status: 429,
        headers: {
          "retry-after": "0"
        }
      });

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      { ...process.env, GITHUB_TOKEN: "token" }
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_APPROVALS_RETRY_EXHAUSTED"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem blocks with GUARD_APPROVALS_TIMEOUT after timeout retries are exhausted", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 1,
        fetchTimeoutMs: 250,
        retry: {
          ...basePolicy.approvals.retry,
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0
        }
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await writeApprovalEvent(eventPath);

    globalThis.fetch = async () => {
      const timeoutError = new Error("aborted");
      timeoutError.name = "AbortError";
      throw timeoutError;
    };

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      { ...process.env, GITHUB_TOKEN: "token" }
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_APPROVALS_TIMEOUT"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem maps non-retryable provider 4xx errors to GUARD_APPROVALS_FETCH_ERROR", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 1,
        retry: {
          ...basePolicy.approvals.retry,
          maxAttempts: 3,
          baseDelayMs: 1,
          maxDelayMs: 1,
          jitterRatio: 0
        }
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await writeApprovalEvent(eventPath);

    globalThis.fetch = async () =>
      new Response("forbidden", {
        status: 403
      });

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      { ...process.env, GITHUB_TOKEN: "token" }
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { findings: Array<{ code: string }> };

    assert.equal(code, 1);
    assert.equal(report.findings.some((item) => item.code === "GUARD_APPROVALS_FETCH_ERROR"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem writes all report formats", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportBase = path.join(tempDir, "report");

    await fs.writeFile(policyPath, `${JSON.stringify(basePolicy, null, 2)}\n`, "utf8");

    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: { number: 42, body: "Body", user: { login: "repo-owner", type: "User" } },
        review: { id: 101, body: "Great work [AI-ASSISTED]", user: { login: "human-reviewer", type: "User" } }
      })}\n`,
      "utf8"
    );

    await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportBase,
        "--report-format",
        "all"
      ],
      process.env
    );

    const jsonExists = await fs
      .access(`${reportBase}.json`)
      .then(() => true)
      .catch(() => false);

    const markdownExists = await fs
      .access(`${reportBase}.md`)
      .then(() => true)
      .catch(() => false);

    const sarifExists = await fs
      .access(`${reportBase}.sarif`)
      .then(() => true)
      .catch(() => false);

    assert.equal(jsonExists, true);
    assert.equal(markdownExists, true);
    assert.equal(sarifExists, true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem report meets accessibility contract markers", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const policy = {
      ...basePolicy,
      approvals: {
        ...basePolicy.approvals,
        minHumanApprovals: 0
      }
    };

    await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: { number: 1, body: "Human body", user: { login: "owner", type: "User" } },
        review: { id: 2, body: "Looks solid", user: { login: "reviewer", type: "User" } }
      })}\n`,
      "utf8"
    );

    await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
      accessibilitySummary: {
        plainLanguageDecision: string;
        statusWords: { pass: string; warn: string; block: string };
        nonColorStatusSignals: boolean;
        screenReaderFriendly: boolean;
      };
    };

    assert.equal(report.accessibilitySummary.nonColorStatusSignals, true);
    assert.equal(report.accessibilitySummary.screenReaderFriendly, true);
    assert.equal(report.accessibilitySummary.statusWords.pass, "Pass");
    assert.equal(report.accessibilitySummary.statusWords.warn, "Warn");
    assert.equal(report.accessibilitySummary.statusWords.block, "Block");
    assert.equal(
      /(Pass|Warn|Block):/.test(report.accessibilitySummary.plainLanguageDecision),
      true
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runSevenShadowSystem accepts legacy v1 policy input", async () => {
  const tempDir = await makeTempDir();

  try {
    const policyPath = path.join(tempDir, "policy-v1.json");
    const eventPath = path.join(tempDir, "event.json");
    const reportPath = path.join(tempDir, "report.json");

    const legacyPolicy = {
      version: 1,
      enforcement: "block",
      blockBotAuthors: true,
      blockedAuthors: [],
      allowedAuthors: [],
      scanPrBody: true,
      scanReviewBody: true,
      scanCommentBody: true,
      maxAiScore: 0.8,
      disclosureTag: "[AI-ASSISTED]",
      disclosureRequiredScore: 0.7,
      minHumanApprovals: 0,
      rules: [
        {
          name: "legacy-template",
          pattern: "great work",
          action: "score",
          weight: 0.2
        }
      ]
    };

    await fs.writeFile(policyPath, `${JSON.stringify(legacyPolicy, null, 2)}\n`, "utf8");
    await fs.writeFile(
      eventPath,
      `${JSON.stringify({
        repository: { full_name: "acme/repo" },
        pull_request: { number: 1, body: "PR body", user: { login: "owner", type: "User" } },
        review: { id: 2, body: "Looks good", user: { login: "reviewer", type: "User" } }
      })}\n`,
      "utf8"
    );

    const code = await runSevenShadowSystem(
      [
        "--policy",
        policyPath,
        "--event",
        eventPath,
        "--event-name",
        "pull_request_review",
        "--report",
        reportPath
      ],
      process.env
    );

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as { policyVersion: number };

    assert.equal(code, 0);
    assert.equal(report.policyVersion, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("wire-submodule script does not overwrite workflow unless --force", async () => {
  const tempDir = await makeTempDir();

  try {
    const targetRepo = path.join(tempDir, "target");
    const submodulePath = "local-submodule";
    const scriptPath = path.join(process.cwd(), "scripts", "wire-submodule.sh");

    await fs.mkdir(targetRepo, { recursive: true });
    await execFileAsync("git", ["init"], { cwd: targetRepo });

    const embeddedConfigPath = path.join(targetRepo, submodulePath, "config");
    const embeddedWorkflowTemplatePath = path.join(targetRepo, submodulePath, "templates", "workflows");
    await fs.mkdir(embeddedConfigPath, { recursive: true });
    await fs.mkdir(embeddedWorkflowTemplatePath, { recursive: true });

    await fs.writeFile(
      path.join(embeddedConfigPath, "seven-shadow-system.policy.json"),
      `${JSON.stringify(basePolicy, null, 2)}\n`,
      "utf8"
    );

    await fs.writeFile(
      path.join(embeddedWorkflowTemplatePath, "seven-shadow-system.yml"),
      "name: NEW TEMPLATE\n",
      "utf8"
    );

    const existingWorkflowPath = path.join(targetRepo, ".github", "workflows", "seven-shadow-system.yml");
    await fs.mkdir(path.dirname(existingWorkflowPath), { recursive: true });
    await fs.writeFile(existingWorkflowPath, "name: EXISTING WORKFLOW\n", "utf8");

    await execFileAsync("bash", [scriptPath, targetRepo, submodulePath], { cwd: process.cwd() });
    const unchanged = await fs.readFile(existingWorkflowPath, "utf8");
    assert.equal(unchanged.includes("EXISTING WORKFLOW"), true);

    await execFileAsync("bash", [scriptPath, "--force", targetRepo, submodulePath], { cwd: process.cwd() });
    const overwritten = await fs.readFile(existingWorkflowPath, "utf8");
    assert.equal(overwritten.includes("NEW TEMPLATE"), true);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
