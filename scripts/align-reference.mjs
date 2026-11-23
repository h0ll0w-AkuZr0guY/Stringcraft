import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const [referencePath, projectPath, outputPath, configPath] =
  process.argv.slice(2);
if (!referencePath || !projectPath || !outputPath)
  throw new Error(
    "Usage: node scripts/align-reference.mjs reference.json recording-project.json report.json [search.json]",
  );
const refBytes = await readFile(referencePath),
  projectBytes = await readFile(projectPath),
  configBytes = configPath ? await readFile(configPath) : null;
const reference = JSON.parse(refBytes),
  project = JSON.parse(projectBytes);
if (
  project.sourceKind !== "audio" ||
  !Array.isArray(project.notes) ||
  !Number.isFinite(project.sourceOffset) ||
  !Number.isFinite(project.duration)
)
  throw new Error(
    "Need an actual recording candidate cache with source bounds",
  );
const config = configBytes ? JSON.parse(configBytes) : {};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (config.referenceSha256 && config.referenceSha256 !== hash(refBytes))
  throw new Error("Frozen reference digest mismatch");
if (
  config.recordingCacheSha256 &&
  config.recordingCacheSha256 !== hash(projectBytes)
)
  throw new Error("Frozen recording cache digest mismatch");
const search = {
  bpm: [60, 180, 0.25],
  offsetSeconds: [0, 4, 0.02],
  transpose: [0],
  selectionBeats: [0, 8],
  checkBeats: [8, 16],
  onsetTolerance: 0.05,
  ...config.search,
  recordingBounds: [
    project.sourceOffset,
    project.sourceOffset + project.duration,
  ],
};
const events = reference.score.events
  .filter(
    (e) =>
      e.midi !== null &&
      !e.unpitched &&
      !e.tieFrom &&
      (e.role ?? e.voice) === (config.role ?? "melody"),
  )
  .map((e) => ({ beat: e.beat, midi: e.midi }));
const bundle = await build({
  entryPoints: ["packages/music/reference-alignment.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
await mkdir("artifacts/tools", { recursive: true });
const toolPath = resolve("artifacts/tools/reference-alignment.mjs");
await writeFile(toolPath, bundle.outputFiles[0].contents);
const { fitReferenceGrid } = await import(pathToFileURL(toolPath).href);
const result = fitReferenceGrid(
  events,
  project.notes.map((n) => ({
    start: n.start + project.sourceOffset,
    pitch: n.pitch,
  })),
  search,
);
const report = {
  version: 2,
  task: "Detector-based disjoint-phrase alignment diagnostic, not recording ground truth",
  source: reference.source,
  referenceSha256: hash(refBytes),
  recordingCacheSha256: hash(projectBytes),
  recordingFileSha256: project.sourceAudioSha256 ?? null,
  searchConfigSha256: configBytes ? hash(configBytes) : null,
  workbenchProposal: {
    bpm: project.bpm,
    beatOffset: project.beatOffset,
    timing: project.score?.timing,
  },
  search,
  ...result,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    status: result.status,
    evaluated: result.evaluated,
    selected: result.selected,
  }),
);
