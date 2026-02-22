import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/test/**/*.test.ts", "src/test/**/*.test.tsx"]
  }
});
