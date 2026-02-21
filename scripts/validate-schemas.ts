import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { runSevenShadowSystem } from "../src/sevenShadowSystem";

function loadJson(filePath: string): Promise<unknown> {
  return fs.readFile(filePath, "utf8").then((raw) => JSON.parse(raw) as unknown);
}

async function validateSchemaInstance(
  schemaPath: string,
  dataPath: string,
  schemaLabel: string,
  dataLabel: string
): Promise<void> {
  const schema = await loadJson(schemaPath);
  const data = await loadJson(dataPath);

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema as Record<string, unknown>);
  const valid = validate(data);

  if (valid) {
    return;
  }

  const issues = (validate.errors ?? []).map((item) => `${item.instancePath || "/"} ${item.message ?? "invalid"}`).join("; ");
  throw new Error(`Schema validation failed: ${schemaLabel} against ${dataLabel}: ${issues}`);
}

async function generateReportFixture(tempDir: string): Promise<string> {
  const reportPath = path.join(tempDir, "report.json");
  const policyPath = path.join(process.cwd(), "config", "seven-shadow-system.policy.json");
  const eventPath = path.join(process.cwd(), "examples", "pr_review_event.json");

  await runSevenShadowSystem(
    [
      "--policy",
      policyPath,
      "--event",
      eventPath,
      "--event-name",
      "pull_request_review",
      "--report",
      reportPath,
      "--redact"
    ],
    { ...process.env, GITHUB_TOKEN: "" }
  );

  return reportPath;
}

async function run(): Promise<void> {
  const policySchemaPath = path.join(process.cwd(), "schemas", "policy-v2.schema.json");
  const reportSchemaPath = path.join(process.cwd(), "schemas", "report-v2.schema.json");
  const overrideConstraintsSchemaPath = path.join(process.cwd(), "schemas", "override-constraints-v1.schema.json");
  const policyPath = path.join(process.cwd(), "config", "seven-shadow-system.policy.json");
  const overrideConstraintsPath = path.join(process.cwd(), "config", "policy-override-constraints.json");

  await validateSchemaInstance(policySchemaPath, policyPath, "policy-v2.schema.json", "config/seven-shadow-system.policy.json");
  await validateSchemaInstance(
    overrideConstraintsSchemaPath,
    overrideConstraintsPath,
    "override-constraints-v1.schema.json",
    "config/policy-override-constraints.json"
  );

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seven-shadow-schema-"));

  try {
    const reportPath = await generateReportFixture(tempDir);
    await validateSchemaInstance(reportSchemaPath, reportPath, "report-v2.schema.json", "generated GuardReportV2");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  console.log("Schema validation checks passed.");
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Schema validation failed: ${message}`);
  process.exit(1);
});
