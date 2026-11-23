import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
let buildSha = "local";
try {
  buildSha =
    execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
    }).trim() +
    (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
      ? "-dirty"
      : "");
} catch {}
const buildInfo = { appVersion, buildSha, builtAt: new Date().toISOString() };
export default defineConfig({
  plugins: [
    react(),
    {
      name: "build-identity",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-info.json",
          source: JSON.stringify(buildInfo),
        });
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_SHA__: JSON.stringify(buildSha),
  },
  base: "./",
  worker: { format: "es" },
  build: { chunkSizeWarningLimit: 1500 },
  test: { include: ["tests/**/*.test.ts"] },
});
