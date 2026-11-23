import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  defaultPreferences,
  fingeringPath,
  type FretPreferences,
} from "../plugins/guitar/fingering";
interface Track {
  id: string;
  player: number;
  split: "train" | "validation" | "test";
  notes: { midi: number; string: number; fret: number }[];
}
export async function calibrate(input: string, output: string) {
  const bytes = await readFile(input),
    corpus = JSON.parse(bytes.toString()) as {
      tracks: Track[];
      source: string;
      splitContract: string;
      projection: string;
      audit: unknown;
    };
  const sets = {
    train: corpus.tracks.filter((t) => t.split === "train"),
    validation: corpus.tracks.filter((t) => t.split === "validation"),
    test: corpus.tracks.filter((t) => t.split === "test"),
  };
  if (Object.values(sets).some((s) => !s.length))
    throw new Error("All three performer splits are required");
  const players = Object.values(sets).map(
    (s) => new Set(s.map((t) => t.player)),
  );
  if (
    players.some((s, i) =>
      players.some((other, j) => i !== j && [...s].some((p) => other.has(p))),
    )
  )
    throw new Error("Performer leakage across splits");
  function evaluate(tracks: Track[], weights: FretPreferences) {
    let correct = 0,
      total = 0,
      covered = 0;
    const perTrack = [];
    for (const track of tracks) {
      const path = fingeringPath(
        track.notes.map((n) => n.midi),
        weights,
      );
      let hits = 0;
      for (let i = 0; i < track.notes.length; i++)
        if (path[i]?.string === track.notes[i].string) hits++;
      correct += hits;
      total += track.notes.length;
      covered += path.length;
      perTrack.push({
        id: track.id,
        notes: track.notes.length,
        stringAgreement: track.notes.length ? hits / track.notes.length : null,
      });
    }
    return {
      notes: total,
      coverage: total ? covered / total : 0,
      stringAgreement: total ? correct / total : 0,
      perTrack,
    };
  }
  const candidates: FretPreferences[] = [];
  for (const movement of [0, 2, 5, 8.125, 12])
    for (const stringChange of [0, 2, 5, 10])
      for (const open of [-4, 0, 4])
        candidates.push({ fret: 1, movement, stringChange, open });
  const training = candidates
    .map((weights) => ({
      weights,
      train: evaluate(sets.train, weights).stringAgreement,
    }))
    .sort((a, b) => b.train - a.train);
  // Validation only ranks the preregistered top ten train candidates. Test is read once below.
  const validation = training
    .slice(0, 10)
    .map((c) => ({
      ...c,
      validation: evaluate(sets.validation, c.weights).stringAgreement,
    }))
    .sort((a, b) => b.validation - a.validation || b.train - a.train);
  const selected = validation[0].weights;
  const baseline = {
    train: evaluate(sets.train, defaultPreferences),
    validation: evaluate(sets.validation, defaultPreferences),
    test: evaluate(sets.test, defaultPreferences),
  };
  const learned = {
    train: evaluate(sets.train, selected),
    validation: evaluate(sets.validation, selected),
    test: evaluate(sets.test, selected),
  };
  const report = {
    version: 1,
    source: corpus.source,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    splitContract: corpus.splitContract,
    projection: corpus.projection,
    audit: corpus.audit,
    search: {
      candidates: candidates.length,
      validationCandidates: 10,
      selectionMetric:
        "reference string agreement; alternatives may also be playable",
      hardConstraints:
        "unchanged; no fret limit, span or finger rule is fitted",
    },
    baselineWeights: defaultPreferences,
    selectedWeights: selected,
    baseline,
    learned,
    testDelta: learned.test.stringAgreement - baseline.test.stringAgreement,
    accepted:
      learned.validation.stringAgreement >=
        baseline.validation.stringAgreement &&
      learned.test.stringAgreement >= baseline.test.stringAgreement,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      selected,
      testDelta: report.testDelta,
      accepted: report.accepted,
      baseline: baseline.test.stringAgreement,
      learned: learned.test.stringAgreement,
      notes: learned.test.notes,
    }),
  );
}
