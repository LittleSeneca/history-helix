import { defineConfig } from "vite";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const here = import.meta.dirname;

// The app fetches /data/*.json at runtime (demographics + events). Vite only
// bundles files reachable from index.html, so the generated datasets never
// reach dist/ on their own — copy them in verbatim after the bundle is written.
function copyData() {
  return {
    name: "copy-data",
    closeBundle() {
      const from = resolve(here, "data");
      if (!existsSync(from)) return;
      cpSync(from, resolve(here, "dist/data"), { recursive: true });
    },
  };
}

export default defineConfig({
  root: ".",
  plugins: [copyData()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    exclude: ["**/*.spec.ts", "**/node_modules/**"],
  },
});