import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "./node_modules/.bin/vite --port 4173",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    cwd: ".",
  },
});