import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    "Usage: node scripts/evaluate-reference.mjs private-reference.json report.json",
  );
const result = await build({
  entryPoints: ["scripts/evaluate-reference.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
await mkdir("artifacts/tools", { recursive: true });
const path = resolve("artifacts/tools/evaluate-reference.mjs");
await writeFile(path, result.outputFiles[0].contents);
const { evaluateReference } = await import(pathToFileURL(path).href);
await evaluateReference(input, output);
