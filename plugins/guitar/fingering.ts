/** Soft preferences may be calibrated from real tablature. Physical limits remain independent. */
import profile from "./preferences.json";
export interface FretPreferences {
  fret: number;
  movement: number;
  stringChange: number;
  open: number;
}
export const calibratedPreferences: FretPreferences = profile.weights;
export const defaultPreferences: FretPreferences = {
  fret: 1,
  movement: 8.125,
  stringChange: 5,
  open: 0,
};
/** Cross-corpus published-score comparison regressed; calibration remains opt-in. */
export const activePreferences: FretPreferences = defaultPreferences;
export interface FingerPosition {
  string: number;
  fret: number;
}
const tuning = [64, 59, 55, 50, 45, 40];
export function pitchPositions(
  midi: number,
  capo = 0,
  maxFret = 20,
): FingerPosition[] {
  return tuning
    .map((open, i) => ({ string: i + 1, fret: midi - open - capo }))
    .filter((p) => p.fret >= 0 && p.fret <= Math.min(maxFret, 24 - capo));
}
export function positionCost(
  previous: FingerPosition | undefined,
  next: FingerPosition,
  weights: FretPreferences,
) {
  return (
    next.fret * weights.fret +
    (next.fret === 0 ? weights.open : 0) +
    (previous
      ? Math.abs(previous.fret - next.fret) * weights.movement +
        (previous.string !== next.string ? weights.stringChange : 0)
      : 0)
  );
}
/** Sequence-level shortest path; alternatives are retained until the phrase ends. */
export function fingeringPath(
  pitches: number[],
  weights: FretPreferences = defaultPreferences,
  capo = 0,
  maxFret = 20,
): FingerPosition[] {
  type State = { position: FingerPosition; cost: number; previous: number };
  const layers: State[][] = [];
  for (const [index, midi] of pitches.entries()) {
    const candidates = pitchPositions(midi, capo, maxFret);
    if (!candidates.length) return [];
    const previous = layers.at(-1);
    layers.push(
      candidates.map((position) => {
        if (!previous)
          return {
            position,
            cost: positionCost(undefined, position, weights),
            previous: -1,
          };
        const ranked = previous
          .map((p, i) => ({
            i,
            cost: p.cost + positionCost(p.position, position, weights),
          }))
          .sort((a, b) => a.cost - b.cost);
        return { position, cost: ranked[0].cost, previous: ranked[0].i };
      }),
    );
  }
  if (!layers.length) return [];
  let cursor = layers
    .at(-1)!
    .reduce((best, s, i, all) => (s.cost < all[best].cost ? i : best), 0);
  const result: FingerPosition[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const state = layers[i][cursor];
    result.push(state.position);
    cursor = state.previous;
  }
  return result.reverse();
}
