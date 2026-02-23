import fs from "node:fs/promises";
import path from "node:path";

import { parseShadowDoctrine, parseShadowPolicy } from "../shadows/engine";

interface DoctrineLintArgs {
  doctrinePath?: string;
  policyPath?: string;
  format: "md" | "json";
}

interface DoctrineLintResult {
  valid: boolean;
  doctrinePath: string;
  policyPath: string;
  policyVersion: 2 | 3 | null;
  warnings: string[];
  errors: string[];
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function parseFormat(value: string): "md" | "json" {
  if (value === "md" || value === "json") {
    return value;
  }

  throw makeError("E_SHADOW_ARG_INVALID", "--format must be md|json");
}

export function parseDoctrineLintArgs(argv: string[]): DoctrineLintArgs {
  const args: DoctrineLintArgs = {
    format: "md"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SHADOW_HELP",
        "Usage: 7s doctrine-lint [--doctrine <path>] [--policy <path>] [--format md|json]"
      );
    }

    if (token === "--doctrine") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--doctrine");
      }
      args.doctrinePath = value;
      index += 1;
      continue;
    }

    if (token === "--policy") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--policy");
      }
      args.policyPath = value;
      index += 1;
      continue;
    }

    if (token === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--format");
      }
      args.format = parseFormat(value.trim().toLowerCase());
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SHADOW_ARG_UNKNOWN", token);
    }
  }

  return args;
}

async function loadJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

function renderMarkdown(result: DoctrineLintResult): string {
  const lines: string[] = [];

  lines.push("## Doctrine Lint");
  lines.push("");
  lines.push(`Result: ${result.valid ? "PASS" : "FAIL"}`);
  lines.push(`Doctrine: ${result.doctrinePath}`);
  lines.push(`Policy: ${result.policyPath}`);
  lines.push(`Policy version: ${result.policyVersion === null ? "unknown" : result.policyVersion}`);
  lines.push("");

  lines.push("### Errors");
  if (result.errors.length === 0) {
    lines.push("- none");
  } else {
    for (const error of result.errors) {
      lines.push(`- ${error}`);
    }
  }
  lines.push("");

  lines.push("### Warnings");
  if (result.warnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of result.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push("");

  return lines.join("\n");
}

export async function runDoctrineLintCommand(
  argv: string[] = process.argv.slice(2),
  _env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseDoctrineLintArgs(argv);

  const doctrinePath = path.resolve(process.cwd(), args.doctrinePath ?? "config/shadow-doctrine.sample.json");
  const policyPath = path.resolve(process.cwd(), args.policyPath ?? "config/seven-shadow-system.policy.v3.sample.json");

  const result: DoctrineLintResult = {
    valid: false,
    doctrinePath,
    policyPath,
    policyVersion: null,
    warnings: [],
    errors: []
  };

  if (path.extname(doctrinePath).toLowerCase() !== ".json") {
    result.errors.push("Doctrine lint expects a machine-readable JSON doctrine file.");
  }

  let doctrineRaw: unknown;
  try {
    doctrineRaw = await loadJson(doctrinePath);
    const doctrine = parseShadowDoctrine(doctrineRaw);

    const accessDoctrine = doctrine.shadows.Access;
    const joined = `${accessDoctrine.belief}\n${accessDoctrine.doctrine}\n${accessDoctrine.checkIntent.join("\n")}`.toLowerCase();

    if (!/aria|alt text|keyboard|screen reader|contrast|focus|wcag|lang/.test(joined)) {
      result.errors.push("Access doctrine must explicitly target accessibility (ARIA, keyboard, screen-reader, contrast, focus, WCAG). ");
    }

    if (/code clarity|readable output|plain language output/.test(joined)) {
      result.errors.push("Access doctrine must not be framed as code clarity/readability output checks.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Doctrine parse failed: ${message}`);
  }

  try {
    const policyRaw = await loadJson(policyPath);
    const policy = parseShadowPolicy(policyRaw);
    result.policyVersion = policy.inputVersion;

    if (policy.inputVersion === 2) {
      result.warnings.push("Policy version 2 loaded. Doctrine-grade controls (stage/coverage/shadow rules) are using compatibility defaults.");
    }

    const tieBreak = policy.coveragePolicy.tieBreakOrder;
    const requiredDomains = ["Security", "Access", "Testing", "Execution", "Scales", "Value", "Aesthetics"];

    for (const domain of requiredDomains) {
      if (!tieBreak.includes(domain as never)) {
        result.errors.push(`Coverage tie-break order missing domain '${domain}'.`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`Policy parse failed: ${message}`);
  }

  result.valid = result.errors.length === 0;

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderMarkdown(result)}\n`);
  }

  return result.valid ? 0 : 1;
}
