import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

interface ParsedArgs {
  outputPath: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    outputPath: path.join(process.cwd(), "sbom.cdx.json")
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";

    if (token === "--output") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("E_ARG_VALUE_REQUIRED: --output");
      }

      parsed.outputPath = path.isAbsolute(value) ? value : path.join(process.cwd(), value);
      i += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`E_UNKNOWN_ARG: ${token}`);
    }
  }

  return parsed;
}

function runNpmSbom(): Promise<string> {
  return new Promise((resolve, reject) => {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(
      npmCommand,
      ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--package-lock-only"],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`npm sbom failed with exit code ${code ?? -1}: ${stderr.trim().slice(0, 240)}`));
    });
  });
}

async function validateSbom(outputPath: string): Promise<void> {
  const raw = await fs.readFile(outputPath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  if (parsed.bomFormat !== "CycloneDX") {
    throw new Error("E_SBOM_INVALID: bomFormat must equal 'CycloneDX'");
  }

  if (typeof parsed.specVersion !== "string" || parsed.specVersion.length === 0) {
    throw new Error("E_SBOM_INVALID: specVersion missing");
  }

  if (!Array.isArray(parsed.components)) {
    throw new Error("E_SBOM_INVALID: components array missing");
  }
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sbomJson = await runNpmSbom();

  await fs.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fs.writeFile(args.outputPath, `${sbomJson.trim()}\n`, "utf8");

  await validateSbom(args.outputPath);
  console.log(`SBOM generated at ${args.outputPath}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`SBOM generation failed: ${message}`);
  process.exit(1);
});
