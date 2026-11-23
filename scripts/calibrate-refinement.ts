import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { NoteEvent } from "../packages/contracts";
import { compareNotes } from "../packages/music/evaluation";
import {
  identityParameters,
  refineNotes,
  type RefinementParameters,
} from "../plugins/note-refinement";
interface Record {
  id: string;
  reference: NoteEvent[];
  detected: NoteEvent[];
}
export async function calibrate(
  development: string,
  heldout: string,
  output: string,
) {
  const devBytes = await readFile(development),
    testBytes = await readFile(heldout);
  const dev = JSON.parse(devBytes.toString()).records as Record[],
    test = JSON.parse(testBytes.toString()).records as Record[];
  const train = dev.filter((r) => r.id.startsWith("00_")),
    validation = dev.filter((r) => r.id.startsWith("04_"));
  if (
    train.length !== 6 ||
    validation.length !== 6 ||
    test.length !== 6 ||
    test.some((r) => !r.id.startsWith("05_"))
  )
    throw new Error(
      "Expected frozen 00/04/05 performer split, six tracks each",
    );
  function evaluate(records: Record[], parameters: RefinementParameters) {
    const tracks = records.map((r) => {
      const result = refineNotes(r.detected, parameters);
      const metric = compareNotes(r.reference, result.notes, 0.05);
      return {
        id: r.id,
        f1: metric.f1,
        precision: metric.precision,
        recall: metric.recall,
        kept: result.notes.length,
        raw: r.detected.length,
      };
    });
    return {
      macroF1: tracks.reduce((s, r) => s + r.f1, 0) / tracks.length,
      tracks,
    };
  }
  const baseline = {
    train: evaluate(train, identityParameters),
    validation: evaluate(validation, identityParameters),
    test: evaluate(test, identityParameters),
  };
  const candidates: RefinementParameters[] = [identityParameters];
  for (const activationCeiling of [0.25, 0.35, 0.45, 0.55, 0.65])
    for (const relativeFloor of [0.4, 0.55, 0.7, 0.85, 1])
      for (const minimumDuration of [0.04, 0.08, 0.12])
        candidates.push({ activationCeiling, relativeFloor, minimumDuration });
  const ranked = candidates
    .map((parameters) => ({ parameters, train: evaluate(train, parameters) }))
    .sort((a, b) => b.train.macroF1 - a.train.macroF1);
  const finalists = ranked
    .slice(0, 10)
    .map((r) => ({ ...r, validation: evaluate(validation, r.parameters) }));
  finalists.push({
    parameters: identityParameters,
    train: baseline.train,
    validation: baseline.validation,
  });
  const safe = finalists
    .filter((r) =>
      r.validation.tracks.every(
        (t, i) => t.f1 >= baseline.validation.tracks[i].f1 - 0.03,
      ),
    )
    .sort((a, b) => b.validation.macroF1 - a.validation.macroF1);
  const selected = safe[0],
    learned = {
      train: selected.train,
      validation: selected.validation,
      test: evaluate(test, selected.parameters),
    };
  const report = {
    version: 1,
    source: "https://zenodo.org/records/3371780",
    developmentSha256: createHash("sha256").update(devBytes).digest("hex"),
    heldoutSha256: createHash("sha256").update(testBytes).digest("hex"),
    split:
      "00 train / 04 validation / 05 held-out; six pure-guitar microphone recordings each",
    objective: "macro one-to-one MIDI/onset F1 at 50ms",
    selection:
      "76 preregistered candidates; top ten train plus identity; validation per-track drop no worse than 0.03",
    parameters: selected.parameters,
    baseline,
    learned,
    heldoutDelta: learned.test.macroF1 - baseline.test.macroF1,
    heldoutRegression: learned.test.tracks
      .filter((t, i) => t.f1 < baseline.test.tracks[i].f1 - 0.03)
      .map((t) => t.id),
    promotion: "pending cross-domain and synthetic repeated/soft-note checks",
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      parameters: report.parameters,
      baseline: baseline.test.macroF1,
      learned: learned.test.macroF1,
      delta: report.heldoutDelta,
      regressions: report.heldoutRegression,
    }),
  );
}
