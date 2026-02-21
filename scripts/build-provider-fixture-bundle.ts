import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function parseArgs(argv: string[]): { output?: string } {
  const args: { output?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --output");
      }
      args.output = value;
      index += 1;
      continue;
    }

    throw new Error(`E_ARG_INVALID: unknown option '${token}'`);
  }

  return args;
}

async function resolvePackageVersion(): Promise<string> {
  const packagePath = path.join(process.cwd(), "package.json");
  const packageRaw = await fs.readFile(packagePath, "utf8");
  const parsed = JSON.parse(packageRaw) as { version?: unknown };

  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("E_PACKAGE_VERSION_INVALID: package.json version must be a non-empty string");
  }

  return parsed.version;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const version = await resolvePackageVersion();
  const output = args.output ?? `seven-shadow-provider-contract-fixtures-v${version}.zip`;
  const fixtureRoot = path.join(process.cwd(), "conformance", "provider-contract");

  await fs.access(fixtureRoot);
  await fs.rm(path.join(process.cwd(), output), { force: true });

  await execFile("zip", ["-r", output, "conformance/provider-contract"], {
    cwd: process.cwd()
  });

  console.log(output);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Provider fixture bundle build failed: ${message}`);
  process.exit(1);
});
