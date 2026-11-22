import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const [manifestPath, outputDirectory] = process.argv.slice(2);
if (!manifestPath || !outputDirectory)
  throw new Error(
    "Usage: node scripts/evaluate-reference-suite.mjs private-manifest.json output-directory",
  );
const manifestBytes = await readFile(manifestPath),
  manifest = JSON.parse(manifestBytes);
if (
  manifest.version !== 1 ||
  !Array.isArray(manifest.cases) ||
  !manifest.cases.length
)
  throw new Error("Reference manifest requires version=1 and nonempty cases");
const ids = new Set();
for (const entry of manifest.cases) {
  if (
    !/^[a-z0-9-]+$/.test(entry.id) ||
    ids.has(entry.id) ||
    typeof entry.input !== "string" ||
    !["development", "validation", "heldout"].includes(entry.split)
  )
    throw new Error("Invalid or duplicate reference case");
  ids.add(entry.id);
}
const bundle = await build({
  entryPoints: ["scripts/evaluate-reference.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
await mkdir("artifacts/tools", { recursive: true });
const toolPath = resolve("artifacts/tools/evaluate-reference.mjs");
await writeFile(toolPath, bundle.outputFiles[0].contents);
const { evaluateReference } = await import(pathToFileURL(toolPath).href);
await mkdir(outputDirectory, { recursive: true });
const records = [];
for (const entry of manifest.cases) {
  const input = resolve(dirname(manifestPath), entry.input),
    bytes = await readFile(input);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (entry.sha256 && entry.sha256 !== hash)
    throw new Error(
      `Frozen reference changed: ${entry.id}. Review annotation separately before changing its hash.`,
    );
  const output = join(outputDirectory, `${entry.id}.json`);
  await evaluateReference(input, output);
  const report = JSON.parse(await readFile(output, "utf8"));
  const actual = {
    pitchedF1: report.pitched?.f1 ?? report.riff?.baseline.f1,
    percussionF1: report.percussion?.f1,
    durationMae:
      report.pitched?.durationMae ?? report.riff?.baseline.durationMae,
    positionAgreement: report.positions?.agreement,
    articulationAgreement: report.articulation?.agreement,
    hardErrors: Array.isArray(report.hardErrors)
      ? report.hardErrors.length
      : (report.riff?.baseline.hardErrors ?? 0) +
        (report.accompaniment?.hardErrors ?? 0),
    dropped: report.dropped?.length,
  };
  const checks = Object.entries(entry.gates ?? {}).map(([name, target]) => {
    const operation = name.startsWith("min")
      ? "min"
      : name.startsWith("max")
        ? "max"
        : undefined;
    const key = operation ? name.slice(3, 4).toLowerCase() + name.slice(4) : "";
    if (
      !operation ||
      !(key in actual) ||
      typeof target !== "number" ||
      !Number.isFinite(target)
    )
      throw new Error(`Invalid reference gate: ${name}`);
    const value = actual[key];
    return {
      name,
      target,
      actual: value ?? null,
      passed:
        typeof value === "number" &&
        (operation === "min" ? value >= target : value <= target),
    };
  });
  records.push({
    id: entry.id,
    split: entry.split,
    inputSha256: hash,
    actual,
    checks,
    passed: checks.length > 0 && checks.every((c) => c.passed),
  });
}
const summary = {
  version: 1,
  task: "Frozen known-score regression; no recording accuracy or listening claim",
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  passed: records.every((r) => r.passed),
  records,
};
await writeFile(
  join(outputDirectory, "summary.json"),
  JSON.stringify(summary, null, 2),
);
console.log(
  JSON.stringify({
    cases: records.length,
    passed: summary.passed,
    failures: records.filter((r) => !r.passed).map((r) => r.id),
  }),
);
if (!summary.passed) process.exitCode = 1;
