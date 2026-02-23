import fs from "node:fs/promises";
import path from "node:path";

import { parseShadowDoctrine } from "../shadows/engine";
import type { ShadowDoctrine, ShadowDomain } from "../shadows/types";

interface DoctrineArgs {
  quickstart: boolean;
  format: "md" | "json";
  doctrinePath?: string;
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

export function parseDoctrineArgs(argv: string[]): DoctrineArgs {
  const args: DoctrineArgs = {
    quickstart: false,
    format: "md"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SHADOW_HELP",
        "Usage: 7s doctrine [--quickstart] [--format md|json] [--doctrine <path>]"
      );
    }

    if (token === "--quickstart") {
      args.quickstart = true;
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

    if (token === "--doctrine") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--doctrine");
      }
      args.doctrinePath = value;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SHADOW_ARG_UNKNOWN", token);
    }
  }

  return args;
}

function extractQuickstartSection(markdown: string): string {
  const start = "<!-- quickstart:start -->";
  const end = "<!-- quickstart:end -->";

  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return markdown;
  }

  return markdown.slice(startIndex + start.length, endIndex).trim();
}

function renderDoctrineMarkdownFromJson(doctrine: ShadowDoctrine, quickstart: boolean): string {
  const lines: string[] = [];

  lines.push("# Seven Shadows Doctrine");
  lines.push("");

  const domains: ShadowDomain[] = ["Security", "Access", "Testing", "Execution", "Scales", "Value", "Aesthetics"];

  for (const domain of domains) {
    const item = doctrine.shadows[domain];
    lines.push(`## ${item.name}`);
    lines.push("");
    lines.push(`Belief: ${item.belief}`);
    lines.push("");

    if (!quickstart) {
      lines.push(item.doctrine);
      lines.push("");
      lines.push("Principles:");
      for (const principle of item.principles) {
        lines.push(`- ${principle}`);
      }
      lines.push("");
      lines.push("Anti-patterns:");
      for (const antiPattern of item.antiPatterns) {
        lines.push(`- ${antiPattern}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function loadDoctrineJson(filePath: string): Promise<ShadowDoctrine> {
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SHADOW_DOCTRINE_READ", message.slice(0, 220));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SHADOW_DOCTRINE_JSON", message.slice(0, 220));
  }

  return parseShadowDoctrine(parsed);
}

export async function runDoctrineCommand(
  argv: string[] = process.argv.slice(2),
  _env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseDoctrineArgs(argv);

  const doctrinePath = path.resolve(
    process.cwd(),
    args.doctrinePath ?? (args.format === "json" ? "config/shadow-doctrine.sample.json" : "references/seven-shadow-doctrine.md")
  );

  if (args.format === "json") {
    const doctrine = await loadDoctrineJson(doctrinePath);

    if (args.quickstart) {
      const quickstart = {
        version: doctrine.version,
        shadows: Object.fromEntries(
          Object.entries(doctrine.shadows).map(([domain, entry]) => [
            domain,
            {
              name: entry.name,
              belief: entry.belief,
              principles: entry.principles
            }
          ])
        )
      };
      process.stdout.write(`${JSON.stringify(quickstart, null, 2)}\n`);
      return 0;
    }

    process.stdout.write(`${JSON.stringify(doctrine, null, 2)}\n`);
    return 0;
  }

  const ext = path.extname(doctrinePath).toLowerCase();
  if (ext === ".json") {
    const doctrine = await loadDoctrineJson(doctrinePath);
    process.stdout.write(`${renderDoctrineMarkdownFromJson(doctrine, args.quickstart)}\n`);
    return 0;
  }

  let markdown = "";
  try {
    markdown = await fs.readFile(doctrinePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SHADOW_DOCTRINE_READ", message.slice(0, 220));
  }

  const output = args.quickstart ? extractQuickstartSection(markdown) : markdown.trimEnd();
  process.stdout.write(`${output}\n`);
  return 0;
}
