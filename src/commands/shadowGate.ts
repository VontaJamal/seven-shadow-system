import fs from "node:fs/promises";
import path from "node:path";

import { evaluateShadowGate, renderShadowGateMarkdown } from "../shadows/engine";
import type { ShadowGateReportV3 } from "../shadows/types";

interface ShadowGateArgs {
  policyPath: string;
  doctrinePath: string;
  exceptionsPath?: string;
  eventPath?: string;
  eventName?: string;
  providerName: string;
  format: "md" | "json";
  noColor: boolean;
  forceColor: boolean;
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

export function parseShadowGateArgs(argv: string[]): ShadowGateArgs {
  const args: ShadowGateArgs = {
    policyPath: "config/seven-shadow-system.policy.v3.sample.json",
    doctrinePath: "config/shadow-doctrine.sample.json",
    providerName: "github",
    format: "md",
    noColor: false,
    forceColor: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SHADOW_HELP",
        "Usage: 7s shadow-gate [--policy <path>] [--doctrine <path>] [--exceptions <path>] [--event <path>] [--event-name <name>] [--provider github|gitlab|bitbucket] [--format md|json] [--no-color]"
      );
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

    if (token === "--doctrine") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--doctrine");
      }
      args.doctrinePath = value;
      index += 1;
      continue;
    }

    if (token === "--exceptions") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--exceptions");
      }
      args.exceptionsPath = value;
      index += 1;
      continue;
    }

    if (token === "--event") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--event");
      }
      args.eventPath = value;
      index += 1;
      continue;
    }

    if (token === "--event-name") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--event-name");
      }
      args.eventName = value;
      index += 1;
      continue;
    }

    if (token === "--provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SHADOW_ARG_REQUIRED", "--provider");
      }
      args.providerName = value.trim().toLowerCase();
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

    if (token === "--no-color") {
      args.noColor = true;
      continue;
    }

    if (token === "--color") {
      args.forceColor = true;
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

function shouldUseColor(args: ShadowGateArgs, env: NodeJS.ProcessEnv): boolean {
  if (args.noColor || env.NO_COLOR === "1" || env.NO_COLOR === "true") {
    return false;
  }

  if (args.forceColor) {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

export async function buildShadowGateReport(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ args: ShadowGateArgs; report: ShadowGateReportV3 }> {
  const args = parseShadowGateArgs(argv);

  const policyPath = path.resolve(process.cwd(), args.policyPath);
  const doctrinePath = path.resolve(process.cwd(), args.doctrinePath);
  const exceptionsPath = args.exceptionsPath ? path.resolve(process.cwd(), args.exceptionsPath) : null;

  const eventPath = path.resolve(process.cwd(), args.eventPath ?? env.GITHUB_EVENT_PATH ?? "");
  const eventName = args.eventName ?? env.GITHUB_EVENT_NAME ?? "pull_request_review";

  if (!eventPath || eventPath === process.cwd()) {
    throw makeError("E_SHADOW_EVENT_REQUIRED", "Provide --event <path> or set GITHUB_EVENT_PATH.");
  }

  let policyRaw: unknown;
  let doctrineRaw: unknown;
  let eventPayload: unknown;
  let exceptionsRaw: unknown = undefined;

  try {
    policyRaw = await loadJson(policyPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SHADOW_POLICY_READ", message.slice(0, 220));
  }

  try {
    doctrineRaw = await loadJson(doctrinePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SHADOW_DOCTRINE_READ", message.slice(0, 220));
  }

  try {
    eventPayload = await loadJson(eventPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw makeError("E_SHADOW_EVENT_READ", message.slice(0, 220));
  }

  if (exceptionsPath) {
    try {
      exceptionsRaw = await loadJson(exceptionsPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw makeError("E_SHADOW_EXCEPTIONS_READ", message.slice(0, 220));
    }
  }

  const evaluation = evaluateShadowGate({
    providerName: args.providerName,
    eventName,
    eventPayload,
    policyRaw,
    doctrineRaw,
    exceptionsRaw
  });

  return {
    args,
    report: evaluation.report
  };
}

export async function runShadowGateCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const { args, report } = await buildShadowGateReport(argv, env);

  if (args.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderShadowGateMarkdown(report, { useColor: shouldUseColor(args, env) })}\n`);
  }

  return report.decision === "block" ? 1 : 0;
}
