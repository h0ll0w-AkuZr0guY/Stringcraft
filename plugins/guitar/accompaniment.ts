import type { MusicalScore } from "../../packages/contracts";
import { beatToSeconds, secondsToBeat } from "../../packages/contracts";
import { measureGrid } from "../../packages/music/structure";
import type { GuitarAction, GuitarGrip, GuitarOptions } from "./types";
import { rightFinger } from "./hands";
import { strumPattern } from "./patterns";

export function accompaniment(
  score: MusicalScore,
  options: GuitarOptions,
  grips: GuitarGrip[],
): GuitarAction[] {
  const actions: GuitarAction[] = [];
  for (const grip of grips) {
    const strings = grip.shape.frets
      .map((f, i) => ({ f, string: i + 1 }))
      .filter((x) => x.f >= 0)
      .sort((a, b) => b.string - a.string);
    const bars = measureGrid(score).filter(
      (b) => b.beat < grip.endBeat && b.endBeat > grip.beat,
    );
    if (options.pattern === "strum") {
      for (const bar of bars) {
        const pattern = strumPattern(
          bar.numerator,
          bar.denominator,
          options.difficulty,
        );
        const nominalLength = (bar.numerator * 4) / bar.denominator;
        const origin = bar.pickup ? bar.endBeat - nominalLength : bar.beat;
        for (const p of pattern) {
          const beat = origin + p.beat;
          if (
            beat < bar.beat - 0.001 ||
            beat < grip.beat - 0.001 ||
            beat >= Math.min(bar.endBeat, grip.endBeat) - 0.001
          )
            continue;
          const order = p.up
            ? [...strings].reverse().filter((n) => n.string <= 3)
            : strings;
          const strokeId = `${grip.chordId}-${beat}`;
          order.forEach((n, i) => {
            const start = secondsToBeat(
              score,
              beatToSeconds(score, beat) + i * 0.009,
            );
            if (start >= grip.endBeat) return;
            actions.push({
              id: `${strokeId}-s${n.string}`,
              beat: start,
              durationBeats: grip.endBeat - start,
              string: n.string,
              fret: n.f,
              finger: grip.shape.fingers[n.string - 1],
              rightFinger: rightFinger(n.string),
              kind: "strum",
              stroke: p.up ? "up" : "down",
              strokeId,
              velocity: (p.beat === 0 ? 0.62 : 0.5) * (1 - i * 0.035),
              role: n.string === strings[0].string ? "bass" : "harmony",
              sourceIds: [],
            });
          });
        }
      }
    } else {
      const bass = strings[0].string;
      const picked =
        options.difficulty === "easy"
          ? [bass, 3, 2, 1]
          : [bass, 3, 2, 3, 1, 3, 2, 3];
      for (const bar of bars) {
        const compound = bar.numerator === 6 && bar.denominator === 8;
        const step = compound ? 0.5 : options.difficulty === "easy" ? 1 : 0.5;
        const nominalLength = (bar.numerator * 4) / bar.denominator,
          origin = bar.pickup ? bar.endBeat - nominalLength : bar.beat;
        for (
          let beat = origin, i = 0;
          beat < Math.min(bar.endBeat, grip.endBeat) - 0.001;
          beat += step, i++
        ) {
          if (beat < bar.beat - 0.001 || beat < grip.beat - 0.001) continue;
          const string =
            Math.abs(beat - grip.beat) < 0.001 || (compound && i % 3 === 0)
              ? bass
              : picked[i % picked.length];
          if (grip.shape.frets[string - 1] < 0) continue;
          actions.push({
            id: `${grip.chordId}-${beat}-s${string}`,
            beat,
            durationBeats: grip.endBeat - beat,
            string,
            fret: grip.shape.frets[string - 1],
            finger: grip.shape.fingers[string - 1],
            rightFinger: rightFinger(string),
            kind: "pluck",
            velocity: string === bass ? 0.6 : 0.42,
            role: string === bass ? "bass" : "harmony",
            sourceIds: [],
          });
        }
      }
    }
  }
  return actions;
}
