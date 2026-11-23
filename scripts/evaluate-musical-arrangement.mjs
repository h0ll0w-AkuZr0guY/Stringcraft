import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir("artifacts", { recursive: true });
await build({
  entryPoints: ["scripts/evaluate-musical-arrangement.ts"],
  outfile: "artifacts/evaluate-musical-arrangement.mjs",
  platform: "node",
  format: "esm",
  bundle: true,
});
const result = spawnSync(
  process.execPath,
  ["artifacts/evaluate-musical-arrangement.mjs", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
