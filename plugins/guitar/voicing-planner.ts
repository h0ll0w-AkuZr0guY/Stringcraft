import { eventRole, type MusicalScore } from "../../packages/contracts";
import { limits, type GuitarOptions, type GuitarGrip } from "./types";
import { tuning, voicings, transitionCost, chordName } from "./voicings";

export function selectGrips(
  score: MusicalScore,
  options: GuitarOptions,
): GuitarGrip[] {
  const limit = limits[options.difficulty];
  type State = { cost: number; grips: GuitarGrip[] };
  let beam: State[] = [{ cost: 0, grips: [] }];
  for (const chord of [...score.chords].sort((a, b) => a.beat - b.beat)) {
    const root =
      (((chord.root + options.transpose - options.capo) % 12) + 12) % 12;
    const candidates = voicings(root, chord.quality, limit.barre).filter(
      (v) =>
        Math.max(...v.frets) <= limit.fret &&
        (chord.bass === undefined ||
          (tuning[v.frets.findLastIndex((f) => f >= 0)] +
            v.frets[v.frets.findLastIndex((f) => f >= 0)] +
            options.capo) %
            12 ===
            (chord.bass + options.transpose) % 12),
    );
    if (!candidates.length) continue;
    const next: State[] = [];
    for (const state of beam)
      for (const v of candidates) {
        const prev = state.grips.at(-1),
          cost = transitionCost(prev?.shape, v);
        let melodicCost = 0;
        if (options.goal !== "accompaniment") {
          const phrase = score.events.filter(
            (e) =>
              e.midi !== null &&
              eventRole(e) === "melody" &&
              e.beat >= chord.beat &&
              e.beat < chord.beat + chord.durationBeats &&
              !e.tieFrom,
          );
          const gripFrets = v.frets.filter((f) => f > 0);
          for (const event of phrase) {
            const possible = tuning
              .map((open, i) => ({
                fret: event.midi! + options.transpose - options.capo - open,
                string: i + 1,
              }))
              .filter((p) => p.fret >= 0 && p.fret <= limit.fret);
            const fitting = possible.some((p) => {
              const frets = [...gripFrets, ...(p.fret ? [p.fret] : [])];
              return (
                !frets.length ||
                Math.max(...frets) - Math.min(...frets) <= limit.span
              );
            });
            if (!fitting) melodicCost += Math.min(2, event.durationBeats) * 4;
          }
        }
        const available = prev ? chord.beat - prev.beat : Infinity;
        if (
          prev &&
          cost >
            Math.max(2, available * limits[options.difficulty].shiftPerBeat)
        )
          continue;
        next.push({
          cost: state.cost + cost + melodicCost,
          grips: [
            ...state.grips,
            {
              beat: chord.beat,
              endBeat: chord.beat + chord.durationBeats,
              chordId: chord.id,
              shape: v,
              name: chordName(v),
              transition: cost,
            },
          ],
        });
      }
    if (next.length) beam = next.sort((a, b) => a.cost - b.cost).slice(0, 16);
  }
  return beam[0].grips;
}
