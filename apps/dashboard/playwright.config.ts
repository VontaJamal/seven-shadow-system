import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:4173"
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    cwd: currentDir,
    url: "http://127.0.0.1:4173",
    timeout: 30_000,
    reuseExistingServer: false
  }
});
