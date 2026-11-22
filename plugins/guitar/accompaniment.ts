import type { MusicalScore } from "../../packages/contracts";
import type { GuitarAction, GuitarGrip, GuitarOptions } from "./types";
import { rightFinger } from "./hands";

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
    const beatSeconds = 60 / score.tempo[0].bpm;
    const meter =
      score.meter.findLast((m) => m.beat <= grip.beat) ?? score.meter[0];
    const bar = (meter.numerator * 4) / meter.denominator;
    // Beginner uses two deliberate downstrokes per 4/4 bar. Daily has a stable pattern.
    const pattern =
      options.difficulty === "easy"
        ? [
            { beat: 0, up: false },
            { beat: 2, up: false },
          ]
        : [
            { beat: 0, up: false },
            { beat: 1, up: false },
            { beat: 1.5, up: true },
            { beat: 2.5, up: true },
            { beat: 3, up: false },
            { beat: 3.5, up: true },
          ];
    if (options.pattern === "strum") {
      for (let base = grip.beat; base < grip.endBeat - 0.01; base += bar)
        for (const p of pattern) {
          const beat = base + p.beat;
          if (beat >= Math.min(base + bar, grip.endBeat) - 0.01) continue;
          const order = p.up
            ? [...strings].reverse().filter((n) => n.string <= 3)
            : strings;
          const strokeId = `${grip.chordId}-${beat}`;
          order.forEach((n, i) => {
            const start = beat + (i * 0.009) / beatSeconds;
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
    } else {
      const bass = strings[0].string;
      const picked =
        options.difficulty === "easy"
          ? [bass, 3, 2, 1]
          : [bass, 3, 2, 3, 1, 3, 2, 3];
      const step = options.difficulty === "easy" ? 1 : 0.5;
      for (
        let beat = grip.beat, i = 0;
        beat < grip.endBeat - 0.01;
        beat += step, i++
      ) {
        const string = picked[i % picked.length];
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
  return actions;
}
