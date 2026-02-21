import fs from "node:fs/promises";
import path from "node:path";

type Severity = "low" | "moderate" | "high" | "critical";

interface SecurityGates {
  dependencyReview?: {
    failOnSeverity?: Severity;
  };
}

function parseSeverityFromDependencyReviewConfig(raw: string): Severity {
  const match = raw.match(/^\s*fail-on-severity\s*:\s*([a-z]+)\s*$/m);
  if (!match || !match[1]) {
    throw new Error("E_DEP_REVIEW_CONFIG: fail-on-severity not found in .github/dependency-review-config.yml");
  }

  const severity = match[1] as Severity;
  if (!["low", "moderate", "high", "critical"].includes(severity)) {
    throw new Error(`E_DEP_REVIEW_CONFIG: invalid fail-on-severity '${severity}'`);
  }

  return severity;
}

async function run(): Promise<void> {
  const repoRoot = process.cwd();
  const securityGatesPath = path.join(repoRoot, "config", "security-gates.json");
  const dependencyReviewConfigPath = path.join(repoRoot, ".github", "dependency-review-config.yml");

  const securityRaw = await fs.readFile(securityGatesPath, "utf8");
  const dependencyReviewRaw = await fs.readFile(dependencyReviewConfigPath, "utf8");

  const security = JSON.parse(securityRaw) as SecurityGates;
  const securitySeverity = security.dependencyReview?.failOnSeverity;

  if (!securitySeverity) {
    throw new Error("E_SECURITY_GATES_CONFIG: dependencyReview.failOnSeverity missing from config/security-gates.json");
  }

  const dependencyReviewSeverity = parseSeverityFromDependencyReviewConfig(dependencyReviewRaw);

  if (securitySeverity !== dependencyReviewSeverity) {
    throw new Error(
      `E_SECURITY_GATES_MISMATCH: config/security-gates.json is '${securitySeverity}' but .github/dependency-review-config.yml is '${dependencyReviewSeverity}'`
    );
  }

  console.log(`Security gate alignment passed: dependency-review fail-on-severity=${securitySeverity}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Security gate validation failed: ${message}`);
  process.exit(1);
});
