import type { MusicalScore } from "../../packages/contracts";
import type { GuitarAction, GuitarGrip, GuitarOptions } from "./types";
import { tuning } from "./voicings";
import { hasWrittenSupportingVoice } from "./written-voices";

/** Sparse chordal guide tones. A fill must leave the existing melody and bass intact. */
export function addInnerVoice(
  score: MusicalScore,
  grips: GuitarGrip[],
  initial: GuitarAction[],
  options: GuitarOptions,
  tryAdd: (
    current: GuitarAction[],
    candidate: GuitarAction,
  ) => GuitarAction[] | null,
): GuitarAction[] {
  if (
    !["hard", "expert"].includes(options.difficulty) ||
    hasWrittenSupportingVoice(score)
  )
    return initial;
  let actions = initial,
    lastPitch = 55;
  for (const grip of grips) {
    const meter =
        score.meter.findLast((m) => m.beat <= grip.beat) ?? score.meter[0],
      length = (meter.numerator * 4) / meter.denominator;
    for (let bar = grip.beat; bar < grip.endBeat; bar += length) {
      const melody = actions.filter(
        (a) =>
          a.role === "melody" &&
          a.beat >= bar &&
          a.beat < Math.min(bar + length, grip.endBeat),
      );
      if (!melody.length || melody.length > 4) continue;
      const section = score.sections.find(
          (s) => s.beat <= bar && s.endBeat > bar,
        ),
        beats = section?.energy === "gentle" ? [1] : [1, 3];
      for (const offset of beats) {
        const beat = bar + offset;
        if (beat >= grip.endBeat - 0.01 || beat >= bar + length - 0.01)
          continue;
        const top = actions.filter(
          (a) =>
            a.role === "melody" &&
            a.beat <= beat &&
            a.beat + a.durationBeats > beat,
        );
        if (!top.length) continue;
        const melodyPitch = Math.min(
          ...top.map((a) => tuning[a.string - 1] + options.capo + a.fret),
        );
        const bass = actions.filter(
          (a) =>
            a.role === "bass" &&
            a.beat <= beat &&
            a.beat + a.durationBeats > beat,
        );
        const bassPitch = Math.max(
          35,
          ...bass.map((a) => tuning[a.string - 1] + options.capo + a.fret),
        );
        const choices = grip.shape.frets
          .map((fret, i) => ({
            string: i + 1,
            fret,
            midi: tuning[i] + options.capo + fret,
          }))
          .filter(
            (p) =>
              p.string >= 2 &&
              p.string <= 4 &&
              p.fret >= 0 &&
              p.midi <= melodyPitch - 3 &&
              p.midi >= bassPitch + 5,
          )
          .sort((a, b) => {
            const third =
              (grip.shape.root +
                (grip.shape.quality === "minor" || grip.shape.quality === "m7"
                  ? 3
                  : 4)) %
              12;
            const rank = (p: typeof a) =>
              Math.abs(p.midi - lastPitch) * 0.2 +
              (p.midi % 12 === (third + options.capo) % 12 ? -1 : 0) +
              (p.midi % 12 === melodyPitch % 12 ? 1.5 : 0);
            return rank(a) - rank(b);
          });
        for (const choice of choices) {
          const durationBeats = Math.min(
            1,
            grip.endBeat - beat,
            bar + length - beat,
          );
          // Do not steal or prematurely damp any existing voice on this string.
          if (
            actions.some(
              (a) =>
                a.string === choice.string &&
                a.beat < beat + durationBeats &&
                a.beat + a.durationBeats > beat,
            )
          )
            continue;
          const candidate: GuitarAction = {
            id: `inner-${grip.chordId}-${beat}`,
            beat,
            durationBeats,
            string: choice.string,
            fret: choice.fret,
            finger: 0,
            rightFinger: "i",
            kind: "pluck",
            velocity: section?.energy === "gentle" ? 0.25 : 0.33,
            role: "harmony",
            sourceIds: [],
          };
          const accepted = tryAdd(actions, candidate);
          if (accepted) {
            actions = accepted;
            lastPitch = choice.midi;
            break;
          }
        }
      }
    }
  }
  return actions;
}
