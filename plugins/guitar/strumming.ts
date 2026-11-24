import {
  beatToSeconds,
  secondsToBeat,
  type MusicalScore,
} from "../../packages/contracts";
import { measureGrid } from "../../packages/music/structure";
import { rightFinger } from "./hands";
import type { GuitarAction, GuitarGrip, GuitarOptions } from "./types";
type Stroke = {
  beat: number;
  up: boolean;
  velocity: number;
  strings: number;
  damp?: boolean;
};

function strokes(
  numerator: number,
  denominator: number,
  easy: boolean,
  gentle: boolean,
  phrasing: boolean,
): Stroke[] {
  if (numerator === 3 && denominator === 4)
    return [
      { beat: 0, up: false, velocity: 0.62, strings: 3 },
      { beat: 1, up: false, velocity: 0.38, strings: 3 },
      { beat: 2, up: !phrasing, velocity: 0.3, strings: 2 },
    ];
  if (numerator === 6 && denominator === 8)
    return easy || gentle
      ? [
          { beat: 0, up: false, velocity: 0.56, strings: 3 },
          { beat: 1.5, up: false, velocity: 0.46, strings: 4 },
        ]
      : [
          { beat: 0, up: false, velocity: 0.64, strings: 4 },
          { beat: 1, up: true, velocity: 0.3, strings: 2 },
          { beat: 1.5, up: false, velocity: 0.57, strings: 5 },
          { beat: 2.5, up: true, velocity: 0.34, strings: 3 },
        ];
  if (numerator !== 4 || denominator !== 4)
    return Array.from({ length: numerator }, (_, i) => ({
      beat: (i * 4) / denominator,
      up: false,
      velocity: i === 0 ? 0.58 : 0.38,
      strings: i === 0 ? 3 : 4,
    }));
  if (easy || gentle)
    return [
      { beat: 0, up: false, velocity: 0.55, strings: easy ? 6 : 3 },
      { beat: 2, up: false, velocity: 0.44, strings: 4 },
      ...(!easy ? [{ beat: 3.5, up: true, velocity: 0.25, strings: 2 }] : []),
    ];
  return [
    { beat: 0, up: false, velocity: 0.68, strings: 4 },
    { beat: 1, up: false, velocity: 0.52, strings: 5 },
    { beat: 1.5, up: true, velocity: 0.3, strings: 2 },
    { beat: 2.5, up: true, velocity: 0.43, strings: 3 },
    { beat: 3, up: false, velocity: 0.62, strings: 5 },
    { beat: 3.5, up: true, velocity: 0.28, strings: 2 },
  ];
}

/** One physical brush with an accent/voicing/gesture, rather than independent equal notes. */
export function naturalStrumming(
  score: MusicalScore,
  options: GuitarOptions,
  grips: GuitarGrip[],
): GuitarAction[] {
  const actions: GuitarAction[] = [];
  const phrasing = options.profile === "phrasing";
  const add = (
    grip: GuitarGrip,
    p: Stroke,
    beat: number,
    energy: string,
    end = grip.endBeat,
  ) => {
    const all = grip.shape.frets
      .map((f, i) => ({ f, string: i + 1 }))
      .filter((n) => n.f >= 0)
      .sort((a, b) => b.string - a.string);
    let selected = p.up
      ? [...all].reverse().slice(0, p.strings)
      : all.slice(0, p.strings);
    // A light downstroke still states the third when the shape supplies one.
    if (!p.up && !phrasing) {
      const third =
        (grip.shape.root +
          (grip.shape.quality === "minor" || grip.shape.quality === "m7"
            ? 3
            : 4)) %
        12;
      const tuning = [64, 59, 55, 50, 45, 40];
      if (!selected.some((n) => (tuning[n.string - 1] + n.f) % 12 === third)) {
        const guide = all.find(
          (n) => (tuning[n.string - 1] + n.f) % 12 === third,
        );
        if (guide && !selected.includes(guide)) selected.push(guide);
      }
      selected.sort((a, b) => b.string - a.string);
    }
    const durationMs = phrasing
      ? (p.up ? 14 : 23) + selected.length * (p.up ? 3 : 5)
      : p.up
        ? 22 + (1 - p.velocity) * 15
        : 32 + (1 - p.velocity) * 32;
    const strokeId = `brush-${grip.chordId}-${beat.toFixed(4)}`;
    selected.forEach((n, i) => {
      const spread =
        selected.length > 1 ? (i / (selected.length - 1)) ** 0.82 : 0;
      const start = secondsToBeat(
        score,
        beatToSeconds(score, beat) + (durationMs / 1000) * spread,
      );
      if (start >= end - 0.001) return;
      const envelope =
        energy === "emphatic" ? 1.08 : energy === "gentle" ? 0.9 : 1;
      actions.push({
        id: `${strokeId}-${n.string}`,
        beat: start,
        durationBeats: end - start,
        string: n.string,
        fret: n.f,
        finger: grip.shape.fingers[n.string - 1],
        rightFinger: rightFinger(n.string),
        kind: "strum",
        stroke: p.up ? "up" : "down",
        strokeId,
        velocity: Math.min(0.9, p.velocity * envelope * (1 - i * 0.025)),
        role: n.string === all[0].string ? "bass" : "harmony",
        sourceIds: [],
        articulation: { releaseSeconds: p.damp ? 0.025 : 0.06, damp: p.damp },
      });
    });
  };
  for (const bar of measureGrid(score)) {
    const phrase = options.phrases?.find(
      (p) => p.beat <= bar.beat && p.endBeat > bar.beat,
    );
    const energy =
      score.sections.find((s) => s.beat <= bar.beat && s.endBeat > bar.beat)
        ?.energy ??
      phrase?.energy ??
      "steady";
    const pattern = strokes(
      bar.numerator,
      bar.denominator,
      options.difficulty === "easy",
      energy === "gentle",
      phrasing,
    );
    const length = (bar.numerator * 4) / bar.denominator,
      origin = bar.pickup ? bar.endBeat - length : bar.beat;
    const phraseEnding = !!phrase && bar.endBeat >= phrase.endBeat - 0.001;
    for (const p of pattern) {
      const beat = origin + p.beat;
      if (beat < bar.beat - 0.001 || beat >= bar.endBeat - 0.001) continue;
      if (phraseEnding && p.up && beat > bar.endBeat - 0.75) continue;
      const grip = grips.find(
        (g) => g.beat <= beat + 0.001 && g.endBeat > beat + 0.001,
      );
      if (!grip) continue;
      const phraseEnd =
        phrasing && phraseEnding && phrase
          ? Math.min(grip.endBeat, phrase.endBeat)
          : grip.endBeat;
      if (beat < phraseEnd - 0.001) add(grip, p, beat, energy, phraseEnd);
    }
  }
  // Short legitimate changes receive one deliberate landing, never a dense fill.
  for (const grip of grips)
    if (
      grip.endBeat - grip.beat >= 0.5 &&
      !actions.some(
        (a) => a.beat >= grip.beat - 0.001 && a.beat < grip.endBeat - 0.001,
      )
    )
      add(
        grip,
        { beat: 0, up: false, velocity: 0.42, strings: 3 },
        grip.beat,
        "gentle",
      );
  return actions;
}
