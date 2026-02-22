import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await execFileAsync(command, args, {
    cwd,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
}

async function run(): Promise<void> {
  const root = process.cwd();
  const workspaceDir = path.join(root, "apps", "dashboard");
  const sourceDir = path.join(workspaceDir, "dist");
  const destinationDir = path.join(root, "dist", "dashboard");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  await runCommand(npmCommand, ["run", "--workspace", "apps/dashboard", "build"], root);

  await fs.rm(destinationDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destinationDir), { recursive: true });
  await fs.cp(sourceDir, destinationDir, { recursive: true });

  console.log(`Dashboard assets synced to ${destinationDir}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Dashboard asset build failed: ${message}`);
  process.exit(1);
});
