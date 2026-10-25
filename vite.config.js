import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    exclude: ["**/*.spec.ts", "**/node_modules/**"],
  },
});