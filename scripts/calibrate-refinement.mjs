import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [development, heldout, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    "Usage: node scripts/calibrate-refinement.mjs development-predictions.json heldout-predictions.json report.json",
  );
const result = await build({
  entryPoints: ["scripts/calibrate-refinement.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
await mkdir("artifacts/tools", { recursive: true });
const path = resolve("artifacts/tools/calibrate-refinement.mjs");
await writeFile(path, result.outputFiles[0].contents);
const { calibrate } = await import(pathToFileURL(path).href);
await calibrate(development, heldout, output);
