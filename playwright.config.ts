import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:5199",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: true,
    cwd: ".",
  },
});