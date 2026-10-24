import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "npx vite --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    cwd: ".",
  },
});