import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  beatToSeconds,
  type MusicalScore,
  type GuitarNote,
} from "../packages/contracts";
import { compareNotes } from "../packages/music/evaluation";
import {
  arrangeScore,
  soundEvents,
  validatePerformance,
  type GuitarOptions,
} from "../plugins/guitar/performance";
import {
  defaultPreferences,
  calibratedPreferences,
} from "../plugins/guitar/fingering";
import { chordIntervals } from "../plugins/harmony";

interface Reference {
  id: string;
  source: Record<string, unknown>;
  score: MusicalScore;
  reference: GuitarNote[];
}
function slice(reference: Reference, from: number, to: number) {
  const seconds = beatToSeconds(reference.score, from);
  const score: MusicalScore = {
    ...structuredClone(reference.score),
    durationBeats: to - from,
    tempo: [{ beat: 0, bpm: reference.score.tempo[0].bpm }],
    sections: [],
    events: reference.score.events
      .filter((e) => e.beat >= from && e.beat < to)
      .map((e) => ({
        ...e,
        beat: e.beat - from,
        durationBeats: Math.min(e.durationBeats, to - e.beat),
      })),
    chords: reference.score.chords
      .filter((c) => c.beat >= from && c.beat < to)
      .map((c) => ({
        ...c,
        beat: c.beat - from,
        durationBeats: Math.min(c.durationBeats, to - c.beat),
      })),
  };
  return {
    score,
    notes: reference.reference
      .filter(
        (n) =>
          n.start >= seconds && n.start < beatToSeconds(reference.score, to),
      )
      .map((n) => ({ ...n, start: n.start - seconds })),
  };
}
function texture(notes: GuitarNote[], score: MusicalScore) {
  return Array.from(
    { length: Math.ceil(score.durationBeats / 4) },
    (_, index) => {
      const start = beatToSeconds(score, index * 4),
        end = beatToSeconds(
          score,
          Math.min(score.durationBeats, index * 4 + 4),
        );
      const group = notes.filter((n) => n.start >= start && n.start < end);
      // Tiny strum offsets belong to a single right-hand gesture.
      const attacks: number[] = [];
      for (const n of [...group].sort((a, b) => a.start - b.start))
        if (!attacks.length || n.start - attacks.at(-1)! > 0.06)
          attacks.push(n.start);
      const frames = attacks.map((t) =>
        group.filter((n) => Math.abs(n.start - t) <= 0.06),
      );
      return {
        bar: index + 1,
        notes: group.length,
        gestures: attacks.length,
        maxChordSize: Math.max(0, ...frames.map((f) => f.length)),
        legato: group.filter(
          (n) => n.attack === "hammer" || n.attack === "pull",
        ).length,
      };
    },
  );
}
function harmonicFit(notes: GuitarNote[], score: MusicalScore) {
  let correct = 0,
    total = 0;
  for (const n of notes)
    for (const c of score.chords) {
      const start = beatToSeconds(score, c.beat),
        end = beatToSeconds(score, c.beat + c.durationBeats);
      const overlap = Math.max(
        0,
        Math.min(end, n.start + n.duration) - Math.max(start, n.start),
      );
      total += overlap;
      if (
        chordIntervals[c.quality].some(
          (i) => (c.root + i) % 12 === n.pitch.midi % 12,
        )
      )
        correct += overlap;
    }
  return {
    soundingSeconds: total,
    chordToneFraction: total ? correct / total : null,
  };
}
export async function evaluateReference(input: string, output: string) {
  const bytes = await readFile(input),
    reference = JSON.parse(bytes.toString()) as Reference;
  const riff = slice(reference, 0, 16),
    comp = slice(reference, 16, 32);
  const evaluate = (weights: typeof defaultPreferences) => {
    const options: GuitarOptions = {
      difficulty: "hard",
      goal: "melody",
      capo: 0,
      transpose: 0,
      pattern: "strum",
      preferences: weights,
    };
    const plan = arrangeScore(riff.score, options),
      notes = soundEvents(plan, riff.score),
      matched = compareNotes(riff.notes, notes, 0.025);
    const positionHits = matched.pairs.filter(
      (pair) =>
        riff.notes.find((n) => n.id === pair.reference)?.string ===
        notes.find((n) => n.id === pair.prediction)?.string,
    ).length;
    return {
      notes,
      summary: {
        ...matched,
        pairs: undefined,
        referenceStringAgreement: matched.matched
          ? positionHits / matched.matched
          : 0,
        hardErrors: validatePerformance(plan, options).filter(
          (i) => i.severity === "error",
        ).length,
        referenceLegato: riff.notes.filter(
          (n) => n.attack === "hammer" || n.attack === "pull",
        ).length,
        generatedLegato: notes.filter(
          (n) => n.attack === "hammer" || n.attack === "pull",
        ).length,
        texture: texture(notes, riff.score),
      },
    };
  };
  const baseline = evaluate(defaultPreferences),
    learned = evaluate(calibratedPreferences);
  const dailyOptions: GuitarOptions = {
    difficulty: "normal",
    goal: "accompaniment",
    capo: 0,
    transpose: 0,
    pattern: "strum",
  };
  const daily = arrangeScore(comp.score, dailyOptions),
    dailyNotes = soundEvents(daily, comp.score);
  const report = {
    version: 1,
    source: reference.source,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    task: "Published tablature comparison, not recording recognition; tempo is an illustrative beat projection",
    riff: {
      baseline: baseline.summary,
      learned: learned.summary,
      referenceTexture: texture(riff.notes, riff.score),
    },
    accompaniment: {
      comparisonMode:
        "harmonic/texture reference; daily simplification is not required to duplicate the arranger's exact rhythm",
      referenceTexture: texture(comp.notes, comp.score),
      generatedTexture: texture(dailyNotes, comp.score),
      harmonicFit: harmonicFit(dailyNotes, comp.score),
      hardErrors: validatePerformance(daily, dailyOptions).filter(
        (i) => i.severity === "error",
      ).length,
      warnings: daily.issues,
    },
    limitations: [
      "Single-pass visual annotation needs independent review",
      "Only bars 1-8 of this specific arranger version; verse/chorus alignment still pending",
      "String agreement is not a unique definition of a good fingering",
      "No audio recognition or listening-quality claim from this symbolic comparison",
    ],
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      riff: {
        baseline: baseline.summary.f1,
        learned: learned.summary.f1,
        baselineString: baseline.summary.referenceStringAgreement,
        learnedString: learned.summary.referenceStringAgreement,
        referenceLegato: learned.summary.referenceLegato,
        generatedLegato: learned.summary.generatedLegato,
      },
      accompaniment: report.accompaniment.harmonicFit,
      hardErrors: learned.summary.hardErrors + report.accompaniment.hardErrors,
    }),
  );
}
