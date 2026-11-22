import type { GuitarNote } from "../../packages/contracts";
import { compareNotes } from "../../packages/music/evaluation";

/** Score reconstruction metrics. These are separate from recording transcription accuracy. */
export function compareGuitarPerformance(
  reference: GuitarNote[],
  prediction: GuitarNote[],
  tolerance = 0.025,
) {
  const pitchedReference = reference.filter((n) => !n.dead);
  const pitchedPrediction = prediction.filter((n) => !n.dead);
  const pitched = compareNotes(pitchedReference, pitchedPrediction, tolerance);
  const ref = new Map(reference.map((n) => [n.id, n]));
  const pred = new Map(prediction.map((n) => [n.id, n]));
  const positionMatches = pitched.pairs.filter((p) => {
    const a = ref.get(p.reference)!,
      b = pred.get(p.prediction)!;
    return a.string === b.string && a.fret === b.fret;
  }).length;
  const articulation = (n: GuitarNote) => n.attack ?? "pluck";
  const isLegato = (n: GuitarNote) =>
    ["hammer", "pull", "slide"].includes(articulation(n));
  const articulationMatches = pitched.pairs.filter(
    (p) =>
      articulation(ref.get(p.reference)!) ===
      articulation(pred.get(p.prediction)!),
  ).length;
  // For percussion the class label is the string, never the nominal MIDI projection.
  const percussion = (notes: GuitarNote[]) =>
    notes
      .filter((n) => n.dead)
      .map((n) => ({ ...n, pitch: { midi: n.string } }));
  const dead = compareNotes(
    percussion(reference),
    percussion(prediction),
    tolerance,
  );
  return {
    pitched: { ...pitched, pairs: undefined },
    percussion: { ...dead, pairs: undefined },
    positions: {
      matched: positionMatches,
      total: pitched.matched,
      agreement: pitched.matched ? positionMatches / pitched.matched : null,
    },
    articulation: {
      matched: articulationMatches,
      total: pitched.matched,
      agreement: pitched.matched ? articulationMatches / pitched.matched : null,
      referenceLegato: pitchedReference.filter(isLegato).length,
      predictedLegato: pitchedPrediction.filter(isLegato).length,
      correctLegato: pitched.pairs.filter(
        (p) =>
          isLegato(ref.get(p.reference)!) &&
          articulation(ref.get(p.reference)!) ===
            articulation(pred.get(p.prediction)!),
      ).length,
    },
    roles: Object.fromEntries(
      (["melody", "bass", "harmony"] as const).map((role) => [
        role,
        {
          ...compareNotes(
            pitchedReference.filter((n) => n.role === role),
            pitchedPrediction.filter((n) => n.role === role),
            tolerance,
          ),
          pairs: undefined,
        },
      ]),
    ),
  };
}
