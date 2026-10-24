import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    exclude: ["**/render.spec.ts", "**/node_modules/**"],
  },
});