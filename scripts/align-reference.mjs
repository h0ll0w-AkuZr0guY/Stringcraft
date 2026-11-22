import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
// Diagnostic affine beat-grid fit. Detector onsets are NOT human alignment truth.
const [referencePath, projectPath, outputPath] = process.argv.slice(2);
if (!referencePath || !projectPath || !outputPath)
  throw new Error(
    "Usage: node scripts/align-reference.mjs private-reference.json private-recording-project.json report.json",
  );
const refBytes = await readFile(referencePath),
  projectBytes = await readFile(projectPath);
const reference = JSON.parse(refBytes),
  project = JSON.parse(projectBytes);
const events = reference.score.events.filter(
  (e) =>
    e.midi !== null &&
    !e.tieFrom &&
    e.beat < 16 &&
    (e.role === "melody" || e.voice === "melody"),
);
if (
  events.length < 8 ||
  !Array.isArray(project.notes) ||
  project.sourceKind !== "audio"
)
  throw new Error(
    "Need an authored first-four-bar riff and an actual recording candidate cache",
  );
const train = events.filter((e) => e.beat < 8),
  held = events.filter((e) => e.beat >= 8);
const byPitch = new Map();
for (const note of project.notes) {
  const group = byPitch.get(note.pitch.midi) ?? [];
  group.push(note.start);
  byPitch.set(note.pitch.midi, group);
}
for (const starts of byPitch.values()) starts.sort((a, b) => a - b);
function evaluate(notes, bpm, offset) {
  // This is coverage only. The sparse riff does not label every sound in a mix.
  const candidates = notes.map((e) =>
    (byPitch.get(e.midi) ?? [])
      .map((start, i) => ({
        key: `${e.midi}/${i}`,
        error: Math.abs(start - offset - (e.beat * 60) / bpm),
      }))
      .filter((c) => c.error <= 0.05)
      .sort((a, b) => a.error - b.error),
  );
  const owner = new Map();
  function assign(index, visited) {
    for (const candidate of candidates[index]) {
      if (visited.has(candidate.key)) continue;
      visited.add(candidate.key);
      if (
        !owner.has(candidate.key) ||
        assign(owner.get(candidate.key), visited)
      ) {
        owner.set(candidate.key, index);
        return true;
      }
    }
    return false;
  }
  notes.forEach((_, i) => assign(i, new Set()));
  const matched = owner.size,
    error = [...owner].reduce(
      (sum, [key, index]) =>
        sum + candidates[index].find((c) => c.key === key).error,
      0,
    );
  return {
    referenceAttacks: notes.length,
    matched,
    coverage: matched / notes.length,
    matchedOnsetMae: matched ? error / matched : null,
  };
}
const candidates = [];
// Fixed before looking at this recording: 60–180 BPM, 0–4 s offset, exact pitch, 50 ms.
for (let bpm = 60; bpm <= 180; bpm += 0.25)
  for (let index = 0; index <= 200; index++) {
    const offset = index * 0.02,
      metric = evaluate(train, bpm, offset);
    candidates.push({ bpm, offset, train: metric });
  }
candidates.sort(
  (a, b) =>
    b.train.matched - a.train.matched ||
    (a.train.matchedOnsetMae ?? Infinity) -
      (b.train.matchedOnsetMae ?? Infinity),
);
const selected = candidates[0],
  report = {
    version: 1,
    task: "Detector-based riff grid alignment diagnostic, not verified recording ground truth",
    source: reference.source,
    referenceSha256: createHash("sha256").update(refBytes).digest("hex"),
    recordingCacheSha256: createHash("sha256")
      .update(projectBytes)
      .digest("hex"),
    workbenchProposal: {
      bpm: project.bpm,
      beatOffset: project.beatOffset,
      timing: project.score?.timing,
    },
    search: {
      bpm: [60, 180],
      bpmStep: 0.25,
      offsetSeconds: [0, 4],
      offsetStep: 0.02,
      onsetTolerance: 0.05,
      matching: "maximum one-to-one exact pitch/onset coverage",
      selectionBeats: [0, 8],
      checkBeats: [8, 16],
    },
    selected: {
      ...selected,
      check: evaluate(held, selected.bpm, selected.offset),
    },
    alternatives: candidates.slice(1, 6),
    status: "unconfirmed",
    limitations: [
      "Arranger score and commercial recording may differ",
      "Selection on detector output can fit detector errors; this does not establish transcription accuracy",
      "Repeat-pattern check is within one recording, not independent cross-song validation",
      "Needs independent beat/section annotation before use as evaluation truth",
    ],
  };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.selected));
